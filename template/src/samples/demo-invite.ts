/**
 * Sprint demo entry (invite): the platform's real room (RoomCore, through its in-memory harness) runs inside the
 * page and you play against bots. Same rules, same screens and same protocol as the deployed app; only the
 * socket is a loopback. Built into one self-contained page by `npm run build:demo`.
 */
import { configureTurn, turnConfig } from '@app-builder/host/turn/config';
import { LoopbackSocket, Net } from '@app-builder/host/turn/testing';
import config from '../../app.config.json';
import { app } from '../app';
import { play } from './main';

/** How often the page wakes the room for bots and timers, in ms (the Durable Object alarm, in the real app). */
const PUMP_MS = 50;

async function start(): Promise<void> {
  configureTurn(config.host);   // the same room settings the deployed Worker uses
  const net = await Net.make(app, turnConfig());
  // The harness keeps its own clock; advance it with real time so bot pacing and turn timers run as they would live.
  const t0 = Date.now();
  const base = net.now;
  let busy = false;
  setInterval(() => {
    if (busy) return;
    net.now = base + (Date.now() - t0);
    const next = net.core.nextAlarm(net.now);
    if (next === null || next > net.now + 1) return;
    busy = true;
    void net.alarm().finally(() => { busy = false; });
  }, PUMP_MS);
  play('local', null, null, { token: net.hostToken, makeSocket: () => new LoopbackSocket(net), local: true });
}

void start();
