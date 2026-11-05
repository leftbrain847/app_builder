/**
 * This app's Worker (invite mode): register the game, then hand everything to
 * the shared invite host (host key, room capabilities, invite approval, rooms).
 * Nothing else goes here. Set the one secret with `wrangler secret put HOST_KEY`.
 */
import { inviteWorker, registerTurn } from '@app-builder/host/turn';
import config from '../app.config.json';
import { app } from '../src/app';

registerTurn([app], { host: config.host });

export { ProfileStore, TurnRoom } from '@app-builder/host/turn';
export default inviteWorker;
