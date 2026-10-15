import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

/**
 * The list of open rooms (the CO-OP screen's list). Each Room tells this one about itself when
 * anything changes, and says goodbye when it closes. A room not heard from for STALE_MS drops off
 * the list on its own — a room that crashed never says goodbye.
 */
interface Summary {
  id: string;
  name: string;
  vis: 'public' | 'private';
  max: number;
  status: string;
  players: number;
  host: string;
  hostHero: string;
  updatedAt: number;
}

const STALE_MS = 3 * 60_000;

export class Directory extends DurableObject<Env> {
  private rooms = new Map<string, Summary>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const all = await ctx.storage.list<Summary>({ prefix: 'r:' });
      for (const [, v] of all) this.rooms.set(v.id, v);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/room' && (req.method === 'PUT' || req.method === 'DELETE')) {
      const s = (await req.json().catch(() => null)) as Summary | null;
      if (!s?.id) return new Response('bad', { status: 400 });
      if (req.method === 'DELETE' || s.status === 'closed' || s.players === 0) {
        this.rooms.delete(s.id);
        await this.ctx.storage.delete(`r:${s.id}`);
      } else {
        this.rooms.set(s.id, s);
        await this.ctx.storage.put(`r:${s.id}`, s);
      }
      return new Response('ok');
    }
    if (url.pathname === '/list') {
      const now = Date.now();
      const out: Summary[] = [];
      for (const s of [...this.rooms.values()]) {
        if (now - s.updatedAt > STALE_MS) {
          this.rooms.delete(s.id);
          await this.ctx.storage.delete(`r:${s.id}`);
          continue;
        }
        // Only what someone can still walk into: public, waiting, a seat free.
        if (s.vis === 'public' && s.status === 'open' && s.players < s.max) out.push(s);
      }
      out.sort((a, b) => b.players - a.players || b.updatedAt - a.updatedAt);
      return Response.json({ rooms: out.slice(0, 50) });
    }
    return new Response('not found', { status: 404 });
  }
}
