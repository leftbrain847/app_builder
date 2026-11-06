import { describe, expect, it } from 'vitest';
import { Net } from '@app-builder/host/turn/testing';
import { app } from '../src/app';

/** Host opens the room, a friend joins from the link and is approved, the host starts. */
async function game() {
  const net = await Net.make(app);
  const host = await net.host();
  const friend = await net.friend(host, 'Sam');
  await host.send({ t: 'host', cmd: { c: 'settings', settings: { target: 10 }, bots: 0 } });
  await host.send({ t: 'host', cmd: { c: 'start' } });
  return { net, host, friend };
}

describe('app rules in a real invite room', () => {
  it('only the player whose turn it is can move', async () => {
    const { host, friend } = await game();
    await friend.send({ t: 'action', type: 'add', params: { n: 3 } });
    expect(friend.errors()).toContain('illegal');
    await host.send({ t: 'action', type: 'add', params: { n: 3 } });
    expect((friend.last('state')!.view as { total: number }).total).toBe(3);
  });

  it('never shows a player anyone else\'s secret', async () => {
    const { host, friend } = await game();
    const hostSecret = (host.last('state')!.view as { mySecret: number }).mySecret;
    await host.send({ t: 'action', type: 'add', params: { n: 1 } });
    expect(friend.inbox.map((m) => JSON.stringify(m)).join('')).not.toContain(String(hostSecret));
  });

  it('ends when the target is reached', async () => {
    const { net, host, friend } = await game();
    for (let i = 0; i < 10 && net.core.phase === 'playing'; i++) await (i % 2 ? friend : host).send({ t: 'action', type: 'add', params: { n: 3 } });
    expect(net.core.phase).toBe('finished');
  });
});
