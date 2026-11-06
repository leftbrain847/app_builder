/**
 * Invite-mode client. You (the host) start a room with your host key; the page
 * gives you a link to send friends. Friends open it, type a name and wait for
 * you to let them in. Nobody logs in: a random seat token kept on each device
 * reclaims the seat after a reload. The invite secret rides in the link's
 * #fragment, which browsers never send to the server.
 */
import { WsTransport, type RoomInfo, type Snapshot } from '@app-builder/client-sdk/turn';
import config from '../../app.config.json';
import { el, render } from './ui';

const base = `/${config.id}`;
const ROOM_PATH = new RegExp(`^${base}/r/([0-9a-f]{32}\\.[A-Za-z0-9_-]{22})$`);

interface View { total: number; turn: string; mySecret: number | null; winner: string | null }
type Snap = Snapshot<View, unknown, { target: number }>;

const randomToken = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const seatKey = (cap: string): string => `seat:${config.id}:${cap}`;

function field(type: string, placeholder: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.placeholder = placeholder;
  i.autocomplete = 'off';
  return i;
}

function home(message = ''): void {
  const key = field('password', 'Host key');
  const name = field('text', 'Your name');
  render(
    el('main', {}, [
      el('h1', { text: config.title }),
      el('p', { className: 'muted', text: 'Start a room, then send the link to friends. They join without logging in; you approve each one.' }),
      key,
      name,
      el('button', { text: 'Start a room', onClick: () => void create(key.value, name.value) }),
      el('p', { className: 'muted', text: message }),
    ]),
  );
}

async function create(hostKey: string, name: string): Promise<void> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { Authorization: `Bearer ${hostKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
  if (!res?.ok) return home(res?.status === 403 ? 'That host key is not right.' : 'Could not start a room (offline, or the daily limit was reached).');
  const r = (await res.json()) as { cap: string; invite: string; hostToken: string };
  localStorage.setItem(seatKey(r.cap), r.hostToken);
  history.replaceState(null, '', `${base}/r/${r.cap}`);
  play(r.cap, null, r.invite);
}

function play(cap: string, join: { invite: string; name: string } | null, invite: string | null): void {
  let token = localStorage.getItem(seatKey(cap));
  if (!token) {
    token = randomToken();
    localStorage.setItem(seatKey(cap), token);
  }
  const t = new WsTransport<View, unknown, { target: number }>({ url: `${location.origin.replace(/^http/, 'ws')}${base}/ws/${cap}`, token, ...(join ? { join } : {}) });
  let room: RoomInfo = t.room;
  let snap: Snap | null = null;
  const draw = (): void => {
    const link = invite ?? room.invite?.secret ?? null;
    const lobby = room.lobby;
    const parts: Node[] = [el('h1', { text: config.title })];
    if (room.status === 'pending') parts.push(el('p', { text: 'Waiting for the host to let you in…' }));
    else if (room.status !== 'joined') parts.push(el('p', { text: room.error ?? room.status }));
    if (room.host && link) parts.push(el('p', { className: 'muted', text: `Invite link: ${location.origin}${base}/r/${cap}#k=${link}` }));
    if (room.host && lobby?.phase === 'lobby') {
      for (const p of lobby.pending ?? []) {
        parts.push(el('div', { className: 'row' }, [
          el('span', { text: `${p.name}${p.dupName ? ' (name already used!)' : ''} wants to join` }),
          el('button', { text: 'Let in', onClick: () => t.hostCmd({ c: 'approve', request: p.id }) }),
          el('button', { text: 'No', onClick: () => t.hostCmd({ c: 'reject', request: p.id }) }),
        ]));
      }
      parts.push(el('button', { text: `Start (${lobby.seats.length} players${lobby.bots ? ` + ${lobby.bots} bot` : ''})`, onClick: () => t.hostCmd({ c: 'start' }) }));
    }
    if (lobby && lobby.phase === 'lobby' && !room.host) parts.push(el('p', { text: `In the lobby: ${lobby.seats.map((s) => s.name).join(', ')}` }));
    const v = snap?.view;
    if (v) {
      const mine = v.turn === room.seat && !v.winner;
      parts.push(el('p', { text: `Total ${v.total} of ${snap!.cfg.target}. ${v.winner ? (v.winner === room.seat ? 'You won.' : 'You lost.') : mine ? 'Your turn.' : 'Their turn.'}` }));
      parts.push(el('p', { className: 'muted', text: `Your secret number: ${v.mySecret ?? '-'}` }));
      if (mine) parts.push(el('div', { className: 'row' }, [1, 2, 3].map((n) => el('button', { text: `+${n}`, onClick: () => t.send('add', { n }) }))));
    }
    if (snap?.error) parts.push(el('p', { className: 'muted', text: snap.error }));
    render(el('main', {}, parts));
  };
  t.onRoom((r) => {
    room = r;
    draw();
  });
  t.subscribe((s) => {
    snap = s;
    draw();
  });
  t.start();
}

function askName(cap: string, invite: string): void {
  const name = field('text', 'Your name');
  render(el('main', {}, [el('h1', { text: config.title }), el('p', { text: 'You were invited to a game.' }), name, el('button', { text: 'Ask to join', onClick: () => play(cap, { invite, name: name.value }, null) })]));
}

const m = ROOM_PATH.exec(location.pathname);
const invite = /^#k=([0-9a-f]{32})$/.exec(location.hash)?.[1] ?? null;
if (!m) home();
else if (localStorage.getItem(seatKey(m[1]!))) play(m[1]!, null, null);
else if (invite) {
  // Drop the secret from the address bar (and from history) once it has been read.
  history.replaceState(null, '', location.pathname);
  askName(m[1]!, invite);
} else home('This link is missing its invite. Ask the host to send it again.');
