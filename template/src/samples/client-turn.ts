/**
 * Turn-based client (friends host only). Creates a room or joins one from a
 * shared link (`?room=<id>`), sends moves, and draws the view the server sends.
 * The server knows you by your Access login, so a reload reclaims your seat.
 */
import { api, configureClient, RoomConnection } from '@app-builder/client-sdk';
import config from '../../app.config.json';
import type { Input, View } from '../app';
import { el, render } from './ui';

configureClient({ basePath: `/${config.id}` });

let status = 'connecting';
let view: View | null = null;
let over = false;

function shareLink(roomId: string): string {
  const url = new URL(location.href);
  url.search = `?room=${roomId}`;
  return url.toString();
}

function draw(conn: RoomConnection<View, Input> | null, roomId: string | null): void {
  const moves =
    conn && view?.yourTurn && !over
      ? [1, 2, 3].map((n) => el('button', { text: `+${n}`, onClick: () => conn.inputs.always({ add: n }) }))
      : [];
  const result = view?.youWon === true ? 'You won.' : view?.youWon === false ? 'You lost.' : null;
  render(
    el('main', {}, [
      el('h1', { text: config.title }),
      roomId
        ? el('p', { className: 'muted', text: `Room link (send it to a friend): ${shareLink(roomId)}` })
        : el('button', { text: 'Start a room', onClick: () => void start() }),
      el('p', { text: view ? `Total ${view.total} of ${view.target}. ${result ?? (view.yourTurn ? 'Your turn.' : 'Their turn.')}` : roomId ? `Waiting for players (${status}).` : '' }),
      el('div', { className: 'row' }, moves),
    ]),
  );
}

function join(roomId: string): void {
  const conn: RoomConnection<View, Input> = new RoomConnection<View, Input>(roomId, {
    onView: (v) => {
      view = v;
      draw(conn, roomId);
    },
    onOver: (v) => {
      view = v;
      over = true;
      draw(conn, roomId);
    },
    onStatus: (s) => {
      status = s;
      draw(conn, roomId);
    },
  });
  draw(conn, roomId);
}

async function start(): Promise<void> {
  const res = await api.createRoom(config.id);
  if (!res) {
    status = 'could not create a room (offline, or the daily limit was reached)';
    draw(null, null);
    return;
  }
  history.replaceState(null, '', `?room=${res.roomId}`);
  join(res.roomId);
}

const fromLink = new URLSearchParams(location.search).get('room');
if (fromLink && /^[0-9a-f-]{36}$/.test(fromLink)) join(fromLink);
else draw(null, null);
