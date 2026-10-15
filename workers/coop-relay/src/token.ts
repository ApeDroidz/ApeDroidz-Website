/**
 * Room tokens. The site signs them (api/survival/coop/token, lib/survivalCoop.ts) after its own
 * checks — the wallet session, the play cookie, the co-op gate — so the relay never talks to the
 * database to know who is connecting: `base64url(json).base64url(hmac-sha256(json))`.
 *
 *   { w: wallet (lowercase), n: the name shown in the room, exp: ms since epoch }
 */
export interface Claims {
  w: string;
  n: string;
  exp: number;
}

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
}

/** The claims of a good, unexpired token — or null. `dev:<wallet>` passes only when `dev` is on. */
export async function readToken(token: string | null, secret: string | undefined, dev: boolean): Promise<Claims | null> {
  if (!token) return null;
  if (dev && token.startsWith('dev:')) {
    const w = token.slice(4).toLowerCase().slice(0, 64);
    return w ? { w, n: w.length > 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w, exp: Date.now() + 3600_000 } : null;
  }
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), b64urlToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as Partial<Claims>;
    if (typeof claims.w !== 'string' || typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
    return { w: claims.w.toLowerCase(), n: typeof claims.n === 'string' ? claims.n.slice(0, 24) : claims.w.slice(0, 10), exp: claims.exp };
  } catch {
    return null;
  }
}
