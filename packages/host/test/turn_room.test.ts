import { describe, expect, it } from 'vitest';
import { HOST_CONFIG } from '../src/turn/config.ts';
import { newToken, signRoomId, verifyRoomCap, sanitizeName } from '../src/turn/crypto.ts';
import { parseC2S } from '../src/turn/protocol.ts';
import { Net } from '../src/turn/testing.ts';
import { counterGame } from './turn_fixture.ts';

async function twoPlayerGame(opts: { bots?: number } = {}) {
  const net = await Net.make(counterGame);
  const host = await net.host();
  const friend = await net.friend(host, 'Sam');
  await host.send({ t: 'host', cmd: { c: 'settings', settings: { target: 10 }, bots: opts.bots ?? 0 } });
  await host.send({ t: 'host', cmd: { c: 'start' } });
  return { net, host, friend };
}

describe('turn rooms: invite links, no login', () => {
  it('a friend with the invite waits for the host, then gets a seat', async () => {
    const net = await Net.make(counterGame);
    const host = await net.host();
    const c = net.connect();
    await c.send({ t: 'join', name: 'Sam', invite: net.invite, token: c.token });
    expect(c.last('pending')).toBeTruthy();
    expect(c.last('joined')).toBeUndefined();
    const req = host.last('lobby')!.pending![0]!;
    await host.send({ t: 'host', cmd: { c: 'approve', request: req.id } });
    expect(c.last('joined')!.seat).toBe('p2');
  });

  it('a wrong or expired invite is refused and the socket closed', async () => {
    const net = await Net.make(counterGame);
    await net.host();
    const bad = net.connect();
    await bad.send({ t: 'join', name: 'Eve', invite: newToken(), token: bad.token });
    expect(bad.errors()).toContain('invite_invalid');
    expect(bad.closed?.code).toBe(1008);

    net.now += HOST_CONFIG.inviteTtlMs + 1;
    const late = net.connect();
    await late.send({ t: 'join', name: 'Late', invite: net.invite, token: late.token });
    expect(late.errors()).toContain('invite_invalid');
  });

  it('a socket that never authenticates is closed on its first other message', async () => {
    const net = await Net.make(counterGame);
    const c = net.connect();
    await c.send({ t: 'action', type: 'add', params: { n: 1 } });
    expect(c.closed?.code).toBe(1008);
  });

  it('only the host can run host commands', async () => {
    const net = await Net.make(counterGame);
    const host = await net.host();
    const friend = await net.friend(host, 'Sam');
    await friend.send({ t: 'host', cmd: { c: 'start' } });
    expect(friend.errors()).toContain('forbidden');
    expect(net.core.phase).toBe('lobby');
  });

  it('moves out of turn are refused; the seat, not the client, is the player', async () => {
    const { host, friend } = await twoPlayerGame();
    await friend.send({ t: 'action', type: 'add', params: { n: 1, player_id: 'p1' } });
    expect(friend.errors()).toContain('illegal');
    await host.send({ t: 'action', type: 'add', params: { n: 2 } });
    expect((friend.last('state')!.view as { total: number }).total).toBe(2);
  });

  it('nobody ever receives another player\'s hidden information', async () => {
    const { net, host, friend } = await twoPlayerGame();
    const hostSecret = (host.last('state')!.view as { mySecret: number }).mySecret;
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    await friend.send({ t: 'action', type: 'add', params: { n: 1 } });
    const friendSaw = friend.inbox.map((m) => JSON.stringify(m)).join('\n');
    expect(friendSaw).not.toContain(String(hostSecret));
    expect(net.everySent.length).toBeGreaterThan(0);
  });

  it('bot seats move on the alarm, then the game ends and records a result', async () => {
    const { net, host } = await twoPlayerGame({ bots: 1 });
    expect(net.core.meta.seats.map((s) => s.bot)).toEqual(['none', 'none', 'ai']);
    for (let i = 0; i < 30 && net.core.phase === 'playing'; i++) {
      const s = host.last('state')!.view as { turn: string };
      if (s.turn === 'p1') await host.send({ t: 'action', type: 'add', params: { n: 3 } });
      else if (s.turn === 'p2') await net.clients.get('c2')!.send({ t: 'action', type: 'add', params: { n: 3 } });
      else await net.alarm();
    }
    expect(net.core.phase).toBe('finished');
  });

  it('a player who misses the turn timer is handed to a bot, and takes it back by playing', async () => {
    const { net, host, friend } = await twoPlayerGame();
    await host.send({ t: 'host', cmd: { c: 'turn_timer', seconds: 30 } });
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    net.now += 31_000;
    await net.alarm();
    expect(net.core.meta.seats.find((s) => s.id === 'p2')!.bot).toBe('afk');
    await net.alarm();
    expect((host.last('state')!.view as { turn: string }).turn).toBe('p1');
    // Any move from the player takes the seat back.
    await friend.send({ t: 'action', type: 'add', params: { n: 1 } });
    expect(net.core.meta.seats.find((s) => s.id === 'p2')!.bot).toBe('none');
    // ...and every client is told, not just the server's own state
    expect(host.last('lobby')!.seats.find((s) => s.id === 'p2')!.bot).toBe('none');
    // switching autopilot on and off is shown to everyone too
    await friend.send({ t: 'autopilot', on: true });
    expect(host.last('lobby')!.seats.find((s) => s.id === 'p2')!.bot).toBe('self');
    await friend.send({ t: 'autopilot', on: false });
    expect(host.last('lobby')!.seats.find((s) => s.id === 'p2')!.bot).toBe('none');
  });

  it('a player who takes their seat back mid-turn gets a fresh turn timer, so the game cannot stall on them', async () => {
    const { net, host, friend } = await twoPlayerGame();
    await host.send({ t: 'host', cmd: { c: 'turn_timer', seconds: 30 } });
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    net.now += 31_000;
    await net.alarm();
    expect(net.core.meta.seats.find((s) => s.id === 'p2')!.bot).toBe('afk');
    // still p2's turn (the bot has not moved yet): p2 comes back without making a move
    await friend.send({ t: 'autopilot', on: false });
    expect(net.core.meta.seats.find((s) => s.id === 'p2')!.bot).toBe('none');
    expect(net.core.meta.waitDeadline).toBe(net.now + 30_000);
    // and if they go quiet again, the timer hands the seat back to a bot
    net.now += 31_000;
    await net.alarm();
    expect(net.core.meta.seats.find((s) => s.id === 'p2')!.bot).toBe('afk');
  });

  it('oversized and flooding messages are dropped, then the socket is closed', async () => {
    const net = await Net.make(counterGame);
    const host = await net.host();
    await host.send('x'.repeat(HOST_CONFIG.maxMsgBytes + 1));
    expect(host.closed?.code).toBe(1009);
    const h2 = net.connect();
    h2.token = net.hostToken;
    for (let i = 0; i < HOST_CONFIG.maxMsgsPerSec * (HOST_CONFIG.abuseStrikesBeforeClose + 1); i++) await h2.send({ t: 'profile_stats' });
    expect(h2.closed?.code).toBe(1008);
  });

  it('handing a seat to a newcomer disconnects whoever held it', async () => {
    const { net, host, friend } = await twoPlayerGame();
    await friend.send({ t: 'autopilot', on: true });
    await host.send({ t: 'host', cmd: { c: 'lock', on: false } });
    const late = net.connect();
    await late.send({ t: 'join', name: 'Kim', invite: net.invite, token: late.token });
    const req = host.last('lobby')!.pending![0]!;
    await host.send({ t: 'host', cmd: { c: 'approve', request: req.id, seat: 'p2' } });
    expect(late.last('joined')!.seat).toBe('p2');
    expect(friend.closed?.code).toBe(4000);
    expect(friend.last('replaced')).toBeTruthy();
    const before = friend.inbox.length;
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    expect(friend.inbox.length).toBe(before);
  });

  it('a socket that never authenticates is dropped after a short wait', async () => {
    const net = await Net.make(counterGame);
    await net.host();
    const idle = net.connect();
    net.now += HOST_CONFIG.authTimeoutMs;
    await net.alarm();
    expect(idle.closed?.code).toBe(1008);
  });

  it('a room accepts only so many sockets at once', async () => {
    const net = await Net.make(counterGame);
    for (let i = 0; i < HOST_CONFIG.maxConnections; i++) expect(net.core.connect(`x${i}`, undefined, net.now)).toBe(true);
    expect(net.core.connect('one-too-many', undefined, net.now)).toBe(false);
  });

  it('a bot whose moves keep failing pauses instead of waking the room forever', async () => {
    const broken = { ...counterGame, create: (s: never, h: never) => {
      const g = counterGame.create(s, h);
      return { ...g, bots: { plan: (st: never, seats: string[]) => (g.bots.plan(st, seats) as { player_id: string }[]).map((a) => ({ ...a, n: 99 })), delayMs: () => 500 } };
    } } as typeof counterGame;
    const net = await Net.make(broken);
    const host = await net.host();
    await host.send({ t: 'host', cmd: { c: 'settings', settings: { target: 10 }, bots: 1 } });
    await host.send({ t: 'host', cmd: { c: 'start' } });
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    for (let i = 0; i < HOST_CONFIG.maxBotFailures + 1; i++) await net.alarm();
    expect(net.core.meta.botAt).toBeNull();
  });

  it('an idle lobby deletes itself', async () => {
    const net = await Net.make(counterGame);
    net.now += HOST_CONFIG.lobbyIdleTtlMs + 2;
    expect(await net.alarm()).toBe(false);
  });
});

describe('turn rooms: capabilities and parsing', () => {
  const key = 'k'.repeat(40);
  it('room capabilities verify, and any change to them fails', async () => {
    const id = 'ab'.repeat(16);
    const cap = await signRoomId(key, id);
    expect(await verifyRoomCap(key, cap)).toBe(id);
    expect(await verifyRoomCap('x'.repeat(40), cap)).toBeNull();
    expect(await verifyRoomCap(key, `${'cd'.repeat(16)}${cap.slice(32)}`)).toBeNull();
    expect(await verifyRoomCap(key, `${cap.slice(0, -1)}${cap.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
  });

  it('client messages are parsed strictly', () => {
    expect(parseC2S('{"t":"join","name":"x","invite":"zz","token":"zz"}')).toBeNull();
    expect(parseC2S('{"t":"host","cmd":{"c":"turn_timer","seconds":99999}}')).toBeNull();
    expect(parseC2S('not json')).toBeNull();
    expect(parseC2S('{"t":"nope"}')).toBeNull();
    expect(parseC2S('{"t":"autopilot","on":true}')).toEqual({ t: 'autopilot', on: true });
  });

  it('display names are plain text', () => {
    expect(sanitizeName('<b>Sam</b>‮', 16)).toBe('bSam/b');
    expect(sanitizeName('   ', 16, 'Player')).toBe('Player');
  });
});
