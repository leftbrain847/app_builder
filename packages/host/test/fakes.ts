import type { Env } from '../src/env';
import { Scores, SoloRun } from '../src/solo';
import { UsageMeter } from '../src/usage';

/** Just enough of `DurableObjectState` for the objects under test: in-memory storage, alarms, ids. */
export class FakeState {
  readonly store = new Map<string, unknown>();
  alarmAt: number | null = null;
  readonly pending: Promise<unknown>[] = [];
  constructor(readonly idString: string) {}
  get id() {
    return { toString: () => this.idString } as DurableObjectId;
  }
  get storage() {
    const store = this.store;
    return {
      get: async <T>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
      deleteAll: async () => store.clear(),
      setAlarm: async (t: number) => void (this.alarmAt = t),
      deleteAlarm: async () => void (this.alarmAt = null),
    };
  }
  waitUntil(p: Promise<unknown>): void {
    this.pending.push(p);
  }
  async settle(): Promise<void> {
    while (this.pending.length) await this.pending.shift();
  }
}

type Ctor = new (state: DurableObjectState, env: Env) => DurableObject;

/** A namespace that creates real objects on fake state, and records every request they get. */
export class FakeNamespace {
  readonly objects = new Map<string, { obj: DurableObject; state: FakeState }>();
  readonly requests: { id: string; request: Request }[] = [];
  private counter = 0;
  constructor(
    private readonly ctor: Ctor,
    private readonly env: () => Env,
  ) {}
  idFromName(name: string): DurableObjectId {
    const hex = Array.from(new TextEncoder().encode(name.padEnd(32, '.').slice(0, 32)), (b) => b.toString(16).padStart(2, '0')).join('');
    return { toString: () => hex } as DurableObjectId;
  }
  newUniqueId(): DurableObjectId {
    const hex = (++this.counter).toString(16).padStart(64, 'a');
    return { toString: () => hex } as DurableObjectId;
  }
  idFromString(s: string): DurableObjectId {
    if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('bad id');
    return { toString: () => s } as DurableObjectId;
  }
  get(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    let entry = this.objects.get(key);
    if (!entry) {
      const state = new FakeState(key);
      entry = { obj: new this.ctor(state as unknown as DurableObjectState, this.env()), state };
      this.objects.set(key, entry);
    }
    const target = entry;
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        this.requests.push({ id: key, request: request.clone() });
        const res = await target.obj.fetch!(request);
        await target.state.settle();
        return res;
      },
    } as unknown as DurableObjectStub;
  }
}

/** A stand-in that records requests and answers with `respond`. */
export class StubNamespace {
  readonly requests: Request[] = [];
  constructor(private readonly respond: (r: Request) => Response) {}
  idFromName = (name: string) => ({ toString: () => name }) as DurableObjectId;
  get(): DurableObjectStub {
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        this.requests.push(request.clone());
        return this.respond(request);
      },
    } as unknown as DurableObjectStub;
  }
}

export function fakeEnv(extra: Partial<Env> = {}): { env: Env; runs: FakeNamespace; scores: FakeNamespace; usage: FakeNamespace; rooms: StubNamespace; assets: Request[] } {
  const assets: Request[] = [];
  // eslint-disable-next-line prefer-const
  let env: Env;
  const runs = new FakeNamespace(SoloRun as unknown as Ctor, () => env);
  const scores = new FakeNamespace(Scores as unknown as Ctor, () => env);
  const usage = new FakeNamespace(UsageMeter as unknown as Ctor, () => env);
  const rooms = new StubNamespace(() => new Response(null, { status: 204 }));
  env = {
    TEAM: 'friends',
    ACCESS_AUD: 'aud-tag-123',
    ASSETS: { fetch: async (r: Request) => (assets.push(r), new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })) } as unknown as Fetcher,
    RUNS: runs as unknown as DurableObjectNamespace,
    SCORES: scores as unknown as DurableObjectNamespace,
    USAGE: usage as unknown as DurableObjectNamespace,
    ROOMS: rooms as unknown as DurableObjectNamespace,
    ...extra,
  };
  return { env, runs, scores, usage, rooms, assets };
}
