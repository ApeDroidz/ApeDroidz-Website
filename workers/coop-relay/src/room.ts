import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/**
 * One co-op room — the lobby, then the run's relay (game/docs/COOP.md, «Решения 15.10»).
 *
 * The relay decides nothing about the fight. The HOST's browser simulates it (enemies, waves,
 * damage) and sends snapshots; every other browser drives its own droid and sends its state and
 * its hits. All this object does in a run is pass messages along and notice when the host has
 * gone quiet, to hand the fight to someone else.
 *
 * Wire format (strings, one frame each):
 *   client → room   `L|{json}`   a lobby control message (hello, ready, kick, start, leave, …)
 *                   `A|payload`  to every other player in the room
 *                   `H|payload`  to the run's host
 *                   `<n>|payload` to the player in slot n (0–3)
 *   room → client   `L|{json}`   the room's own news (room, start, host, kicked, …)
 *                   `R<n>|payload` a payload relayed from slot n
 * Relayed payloads are never parsed here: a snapshot is the biggest thing on the wire and the
 * room has no business reading it.
 */

export interface Member {
  slot: number;
  w: string;
  n: string;
  hero: string;
  weapon: string;
  ver: string;
  ready: boolean;
  connected: boolean;
  /** When the socket went away in the lobby: the seat is kept LOBBY_GRACE_MS for a reconnect. */
  goneAt: number | null;
  joinedAt: number;
}

export interface RoomState {
  id: string;
  name: string;
  vis: 'public' | 'private';
  max: number;
  status: 'open' | 'starting' | 'run' | 'over' | 'closed';
  /** The slot that started the room — and, in a run, the one simulating the fight. */
  host: number;
  members: Member[];
  createdAt: number;
  activity: number;
  /** Wallets the host sent away: they cannot come back into this room. */
  kicked: string[];
  coop: { coopId: string; seed: number; runs: Record<string, string>; startedAt: number } | null;
}

/** A seat in the lobby waits this long for its player to come back. */
const LOBBY_GRACE_MS = 30_000;
/** A lobby with nothing happening for this long closes. */
const LOBBY_IDLE_MS = 15 * 60_000;
/** The host's browser silent this long in a run: the fight moves to another player. */
const HOST_SILENT_MS = 3_000;
const MAX_PLAYERS = 4;

interface Attachment { w: string; slot: number }

export class Room extends DurableObject<Env> {
  private room: RoomState | null = null;
  /** Last frame heard from the run's host (memory only: a woken room starts the clock fresh). */
  private lastHostAt = Date.now();
  /** When the room list last heard from this lobby (it forgets a room silent for 3 minutes). */
  private lastDirAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>('room')) ?? null;
    });
  }

  // ── connecting ───────────────────────────────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/info') {
      return Response.json(this.room ? this.summary(this.room) : null);
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const w = url.searchParams.get('w') ?? '';
    const n = url.searchParams.get('n') ?? w.slice(0, 10);
    const id = url.searchParams.get('room') ?? '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    const refuse = (why: string): Response => {
      server.send(`L|${JSON.stringify({ t: 'refused', why })}`);
      server.close(4000, why);
      return new Response(null, { status: 101, webSocket: client });
    };

    const now = Date.now();
    if (!this.room || this.room.status === 'closed') {
      if (url.searchParams.get('create') !== '1') return refuse('no_room');
      const name = (url.searchParams.get('name') ?? '').replace(/[^\w \-.!?'#]/g, '').trim().slice(0, 24) || `${n}'s room`;
      const max = Math.max(2, Math.min(MAX_PLAYERS, Number(url.searchParams.get('max')) || MAX_PLAYERS));
      const vis = url.searchParams.get('vis') === 'private' ? 'private' : 'public';
      this.room = { id, name, vis, max, status: 'open', host: 0, members: [], createdAt: now, activity: now, kicked: [], coop: null };
    }
    const room = this.room;
    if (room.kicked.includes(w)) return refuse('kicked');

    let me = room.members.find((m) => m.w === w);
    if (!me) {
      if (room.status !== 'open') return refuse('started');
      if (room.members.length >= room.max) return refuse('full');
      const taken = new Set(room.members.map((m) => m.slot));
      let slot = 0;
      while (taken.has(slot)) slot++;
      me = { slot, w, n, hero: '', weapon: '', ver: '', ready: false, connected: true, goneAt: null, joinedAt: now };
      room.members.push(me);
      if (room.members.length === 1) room.host = slot;
    }
    // One socket per player: a second tab takes the seat over.
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.w === w && ws !== server) {
        try { ws.send(`L|${JSON.stringify({ t: 'replaced' })}`); ws.close(4001, 'replaced'); } catch { /* gone */ }
      }
    }
    server.serializeAttachment({ w, slot: me.slot } satisfies Attachment);
    me.connected = true;
    me.goneAt = null;
    room.activity = now;
    await this.save();
    server.send(`L|${JSON.stringify({ t: 'welcome', slot: me.slot, room: this.view(room) })}`);
    this.broadcastRoom();
    // Back into a run that is going on: the others are told, and the host sends the whole fight.
    if (room.status === 'run' && room.coop) {
      server.send(`L|${JSON.stringify({ t: 'start', ...this.startPayload(room), rejoin: true })}`);
      this.control({ t: 'joined', slot: me.slot });
    }
    await this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── messages ─────────────────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (typeof msg !== 'string' || msg.length < 2 || msg.charCodeAt(1) !== 124 /* | */) return;
    const a = ws.deserializeAttachment() as Attachment | null;
    const room = this.room;
    if (!a || !room) return;
    const head = msg.charCodeAt(0);

    if (head === 76 /* L */) {
      let m: Record<string, unknown>;
      try { m = JSON.parse(msg.slice(2)) as Record<string, unknown>; } catch { return; }
      await this.onControl(ws, a, m);
      return;
    }

    // The hot path — the fight. Only while one is going on.
    if (room.status !== 'run' && room.status !== 'over') return;
    if (a.slot === room.host) this.lastHostAt = Date.now();
    const out = `R${a.slot}|${msg.slice(2)}`;
    if (head === 65 /* A */) {
      for (const s of this.ctx.getWebSockets()) if (s !== ws) this.trySend(s, out);
    } else if (head === 72 /* H */) {
      const h = this.socketOf(room.host);
      if (h && h !== ws) this.trySend(h, out);
    } else if (head >= 48 && head <= 51 /* 0–3 */) {
      const s = this.socketOf(head - 48);
      if (s && s !== ws) this.trySend(s, out);
    }
  }

  private async onControl(ws: WebSocket, a: Attachment, m: Record<string, unknown>): Promise<void> {
    const room = this.room!;
    const me = room.members.find((x) => x.slot === a.slot && x.w === a.w);
    if (!me) return;
    room.activity = Date.now();
    const str = (v: unknown, max = 32): string => (typeof v === 'string' ? v.slice(0, max) : '');
    switch (m.t) {
      case 'ping':
        ws.send(`L|${JSON.stringify({ t: 'pong', c: m.c })}`);
        return;
      case 'hello':
      case 'hero':
        me.hero = str(m.hero) || me.hero;
        me.weapon = str(m.weapon) || me.weapon;
        if (m.t === 'hello') me.ver = str(m.ver, 64);
        break;
      case 'ready':
        if (room.status !== 'open') return;
        me.ready = m.on === true;
        break;
      case 'kick': {
        if (room.status !== 'open' || a.slot !== room.host) return;
        const target = room.members.find((x) => x.slot === m.slot);
        // Anyone but the host (owner, 17.10.2026: everyone is READY the moment they are in, so «only
        // who is not ready» — the rule of 15.10 — would leave the host no one to send away).
        if (!target || target.slot === room.host) return;
        room.kicked.push(target.w);
        room.members = room.members.filter((x) => x !== target);
        const s = this.socketOf(target.slot);
        if (s) { this.trySend(s, `L|${JSON.stringify({ t: 'kicked' })}`); try { s.close(4003, 'kicked'); } catch { /* gone */ } }
        break;
      }
      case 'leave':
        await this.leave(a.slot);
        try { ws.close(1000, 'left'); } catch { /* gone */ }
        return;
      case 'start':
        if (a.slot !== room.host) return;
        await this.start();
        return;
      case 'handoff':
        // The host's own browser says it can no longer run the fight (the tab went to the background).
        if (room.status === 'run' && a.slot === room.host) await this.migrate('handoff');
        return;
      case 'over':
        // The team is down — the host says so once; the room stays up for the result screens.
        if (room.status === 'run' && a.slot === room.host) { room.status = 'over'; this.control({ t: 'over' }); }
        break;
      default:
        return;
    }
    await this.save();
    this.broadcastRoom();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  private async dropped(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    const room = this.room;
    if (!a || !room) return;
    // A replaced socket (second tab) closing is not the player leaving.
    const other = this.ctx.getWebSockets().find((s) => s !== ws && (s.deserializeAttachment() as Attachment | null)?.w === a.w);
    if (other) return;
    const me = room.members.find((x) => x.slot === a.slot && x.w === a.w);
    if (!me) return;
    me.connected = false;
    if (room.status === 'open' || room.status === 'starting') {
      me.ready = false;
      me.goneAt = Date.now();
    } else if (room.status === 'run' && a.slot === room.host) {
      await this.migrate('disconnected');
    } else if (room.status === 'run') {
      this.control({ t: 'left', slot: a.slot });
    }
    await this.save();
    this.broadcastRoom();
    await this.tick();
  }

  // ── lobby moves ──────────────────────────────────────────────────────────────────────────

  private async leave(slot: number): Promise<void> {
    const room = this.room!;
    if (room.status === 'open' || room.status === 'starting') {
      room.members = room.members.filter((x) => x.slot !== slot);
      if (room.host === slot && room.members.length) {
        // The earliest of those left becomes the host.
        room.host = [...room.members].sort((p, q) => p.joinedAt - q.joinedAt)[0].slot;
      }
    } else {
      const me = room.members.find((x) => x.slot === slot);
      if (me) me.connected = false;
      if (room.status === 'run' && room.host === slot) await this.migrate('left');
      else this.control({ t: 'left', slot });
    }
    if (!room.members.some((x) => x.connected || x.goneAt)) await this.close();
    else { await this.save(); this.broadcastRoom(); }
  }

  /**
   * START: every seat READY and here, at least two. The site spends every member's run in one
   * transaction (all or nothing — api/survival/coop/start), then everyone gets the go.
   */
  private async start(): Promise<void> {
    const room = this.room!;
    if (room.status !== 'open') return;
    const ms = room.members;
    if (ms.length < 2 || ms.some((x) => !x.ready || !x.connected || !x.hero)) {
      this.control({ t: 'startFail', why: 'not_ready' });
      return;
    }
    room.status = 'starting';
    await this.save();
    this.broadcastRoom();
    this.control({ t: 'starting' });

    const res = await this.openRun(room).catch((e: unknown) => ({ ok: false as const, state: 'no_server', detail: String(e) }));
    if (this.room !== room || room.status !== 'starting') return;
    if (!res.ok) {
      room.status = 'open';
      // The one whose run could not be spent is taken off READY, with the reason.
      const who = 'wallet' in res && res.wallet ? room.members.find((x) => x.w === res.wallet) : undefined;
      if (who) who.ready = false;
      await this.save();
      this.control({ t: 'startFail', why: res.state, slot: who?.slot ?? null });
      this.broadcastRoom();
      return;
    }
    room.coop = { coopId: res.coopId, seed: res.seed, runs: res.runs, startedAt: Date.now() };
    room.status = 'run';
    this.lastHostAt = Date.now();
    await this.save();
    this.control({ t: 'start', ...this.startPayload(room) });
    this.broadcastRoom();
    await this.tick();
  }

  private startPayload(room: RoomState): Record<string, unknown> {
    const c = room.coop!;
    return {
      coopId: c.coopId, seed: c.seed, startedAt: c.startedAt, host: room.host,
      players: room.members.map((m) => ({ slot: m.slot, w: m.w, n: m.n, hero: m.hero, weapon: m.weapon, runId: c.runs[m.w] ?? null, connected: m.connected })),
    };
  }

  /** Asks the site to open the run for every member. In local dev without a site, nothing is spent. */
  private async openRun(room: RoomState): Promise<
    { ok: true; coopId: string; seed: number; runs: Record<string, string> } | { ok: false; state: string; wallet?: string }
  > {
    if (this.env.DEV === '1' && !this.env.SITE_URL) {
      return { ok: true, coopId: crypto.randomUUID(), seed: Math.floor(Math.random() * 2 ** 31), runs: {} };
    }
    const r = await fetch(`${this.env.SITE_URL}/api/survival/coop/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-coop-secret': this.env.COOP_SECRET ?? '' },
      body: JSON.stringify({
        roomId: room.id,
        host: room.members.find((m) => m.slot === room.host)?.w ?? null,
        members: room.members.map((m) => ({ wallet: m.w, hero: m.hero, weapon: m.weapon, clientVersion: m.ver })),
      }),
    });
    const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.ok !== true) {
      return { ok: false, state: typeof body?.state === 'string' ? body.state : `http_${r.status}`, wallet: typeof body?.wallet === 'string' ? body.wallet : undefined };
    }
    return { ok: true, coopId: String(body.coopId), seed: Number(body.seed) || 0, runs: (body.runs ?? {}) as Record<string, string> };
  }

  /** The fight goes to the next player who is here (lowest slot after the old host). */
  private async migrate(why: string): Promise<void> {
    const room = this.room!;
    const here = new Set(this.ctx.getWebSockets().map((s) => (s.deserializeAttachment() as Attachment | null)?.slot));
    const order = [...room.members].sort((p, q) => ((p.slot - room.host + MAX_PLAYERS) % MAX_PLAYERS) - ((q.slot - room.host + MAX_PLAYERS) % MAX_PLAYERS));
    const next = order.find((m) => m.slot !== room.host && m.connected && here.has(m.slot));
    if (!next) return; // nobody to take it — the host keeps the seat until someone is
    const from = room.host;
    room.host = next.slot;
    this.lastHostAt = Date.now();
    await this.save();
    this.control({ t: 'host', slot: next.slot, from, why });
    this.broadcastRoom();
  }

  private async close(): Promise<void> {
    const room = this.room;
    if (!room) return;
    room.status = 'closed';
    for (const s of this.ctx.getWebSockets()) { try { s.close(1000, 'closed'); } catch { /* gone */ } }
    await this.directory('DELETE', room);
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  // ── the clock ────────────────────────────────────────────────────────────────────────────

  /** Seats past their grace, an idle lobby, a silent host — then the next tick, if one is needed. */
  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    let changed = false;
    if (room.status === 'open') {
      const gone = room.members.filter((m) => !m.connected && m.goneAt && now - m.goneAt > LOBBY_GRACE_MS);
      for (const m of gone) { await this.leave(m.slot); changed = true; }
      if (!this.room) return;
      if (now - room.activity > LOBBY_IDLE_MS) { await this.close(); return; }
      if (now - this.lastDirAt > 60_000) await this.directory('PUT', room);
    }
    if (room.status === 'run' && now - this.lastHostAt > HOST_SILENT_MS) await this.migrate('silent');
    if ((room.status === 'run' || room.status === 'over') && this.ctx.getWebSockets().length === 0) { await this.close(); return; }
    if (changed) this.broadcastRoom();
    await this.tick();
  }

  private async tick(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const need = room.status === 'run' || room.status === 'over' || room.members.some((m) => m.goneAt) || room.status === 'open';
    if (!need) return;
    const at = Date.now() + (room.status === 'run' ? 1000 : 5000);
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  private socketOf(slot: number): WebSocket | undefined {
    return this.ctx.getWebSockets().find((s) => (s.deserializeAttachment() as Attachment | null)?.slot === slot);
  }

  private trySend(ws: WebSocket, msg: string): void {
    try { ws.send(msg); } catch { /* closing */ }
  }

  private control(m: Record<string, unknown>): void {
    const s = `L|${JSON.stringify(m)}`;
    for (const ws of this.ctx.getWebSockets()) this.trySend(ws, s);
  }

  private view(room: RoomState): Record<string, unknown> {
    return {
      id: room.id, name: room.name, vis: room.vis, max: room.max, status: room.status, host: room.host,
      members: room.members.map((m) => ({ slot: m.slot, n: m.n, w: m.w, hero: m.hero, weapon: m.weapon, ready: m.ready, connected: m.connected })),
    };
  }

  private broadcastRoom(): void {
    const room = this.room;
    if (!room) return;
    this.control({ t: 'room', room: this.view(room) });
    void this.directory('PUT', room);
  }

  private summary(room: RoomState): Record<string, unknown> {
    const host = room.members.find((m) => m.slot === room.host);
    return {
      id: room.id, name: room.name, vis: room.vis, max: room.max, status: room.status,
      players: room.members.length, host: host?.n ?? '', hostHero: host?.hero ?? '', updatedAt: Date.now(),
    };
  }

  private async directory(method: 'PUT' | 'DELETE', room: RoomState): Promise<void> {
    this.lastDirAt = Date.now();
    try {
      const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('rooms'));
      await dir.fetch('https://directory/room', { method, body: JSON.stringify(this.summary(room)) });
    } catch { /* the list is a convenience; the room works without it */ }
  }

  private async save(): Promise<void> {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }
}
