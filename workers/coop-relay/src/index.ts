import { readToken } from './token';
export { Room } from './room';
export { Directory } from './directory';

export interface Env {
  ROOM: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  SITE_URL: string;
  COOP_SECRET?: string;
  DEV?: string;
}

/**
 * Droidz Survival co-op relay.
 *
 *   GET /rooms                       the open public rooms (the CO-OP screen's list)
 *   GET /room/<id>                   one room's summary (the invite link checks it before joining)
 *   GET /ws?room=<id>&token=<t>      the room's websocket; `&create=1&name=&max=&vis=` opens a new one
 *   GET /health
 *
 * The token is the site's (api/survival/coop/token): who the player is, signed. A new room's id is
 * made here when the game asks for `room=new`.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const ROOM_ID = /^[a-z0-9]{6,12}$/;

function newRoomId(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health') return new Response('ok', { headers: CORS });

    if (url.pathname === '/rooms') {
      const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('rooms'));
      const r = await dir.fetch('https://directory/list');
      return new Response(r.body, { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    const info = url.pathname.match(/^\/room\/([a-z0-9]{6,12})$/);
    if (info) {
      const stub = env.ROOM.get(env.ROOM.idFromName(info[1]));
      const r = await stub.fetch('https://room/info');
      return new Response(r.body, { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const claims = await readToken(url.searchParams.get('token'), env.COOP_SECRET, env.DEV === '1');
      if (!claims) return new Response('bad token', { status: 401 });
      let id = (url.searchParams.get('room') ?? '').toLowerCase();
      const create = url.searchParams.get('create') === '1';
      if (create && (id === 'new' || !id)) id = newRoomId();
      if (!ROOM_ID.test(id)) return new Response('bad room', { status: 400 });
      const fwd = new URL('https://room/ws');
      fwd.searchParams.set('room', id);
      fwd.searchParams.set('w', claims.w);
      fwd.searchParams.set('n', claims.n);
      for (const k of ['create', 'name', 'max', 'vis']) {
        const v = url.searchParams.get(k);
        if (v !== null) fwd.searchParams.set(k, v);
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(id));
      return stub.fetch(new Request(fwd.toString(), req));
    }

    return new Response('not found', { status: 404, headers: CORS });
  },
};
