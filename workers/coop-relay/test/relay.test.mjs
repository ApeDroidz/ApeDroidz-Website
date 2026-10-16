// Protocol test for the co-op relay against `wrangler dev` (DEV=1, no SITE_URL: a start spends nothing).
//   npx wrangler dev --port 8787   then   node test/relay.test.mjs
import WebSocket from 'ws';

const BASE = process.env.RELAY ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(wallet, room, extra = '') {
  const ws = new WebSocket(`${WS}/ws?room=${room}&token=dev:${wallet}${extra}`);
  const c = { ws, wallet, inbox: [], slot: null, room: null };
  ws.on('message', (d) => {
    const s = d.toString();
    c.inbox.push(s);
    if (s.startsWith('L|')) {
      const m = JSON.parse(s.slice(2));
      if (m.t === 'welcome') { c.slot = m.slot; c.room = m.room; }
      if (m.t === 'room') c.room = m.room;
    }
  });
  c.open = new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  c.send = (s) => ws.send(s);
  c.ctl = (m) => ws.send(`L|${JSON.stringify(m)}`);
  c.find = (pred) => c.inbox.find(pred);
  c.ctlOf = (t) => c.inbox.filter((s) => s.startsWith('L|')).map((s) => JSON.parse(s.slice(2))).filter((m) => m.t === t);
  return c;
}

async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(30); }
  return false;
}

const tag = Math.random().toString(36).slice(2, 7);
// 1. create
const a = client(`0xaaa${tag}`, 'new', `&create=1&name=Test%20room&max=3&vis=public`);
await a.open;
ok(await waitFor(() => a.slot === 0 && a.room?.id), 'creator gets slot 0 and a room id');
const roomId = a.room.id;
a.ctl({ t: 'hello', hero: 'volt', weapon: 'sword_0', ver: 'test' });

// 2. it is listed
await sleep(200);
const list = await (await fetch(`${BASE}/rooms`)).json();
ok(list.rooms.some((r) => r.id === roomId), 'room shows in /rooms');

// 3. join two more, a fourth is refused (max 3)
const b = client(`0xbbb${tag}`, roomId); await b.open;
const c = client(`0xccc${tag}`, roomId); await c.open;
ok(await waitFor(() => b.slot === 1 && c.slot === 2), 'joiners get slots 1 and 2');
b.ctl({ t: 'hello', hero: 'goblin', weapon: 'staff', ver: 'test' });
c.ctl({ t: 'hello', hero: 'geez', weapon: 'fists', ver: 'test' });
const d = client(`0xddd${tag}`, roomId); await d.open;
ok(await waitFor(() => d.ctlOf('refused').some((m) => m.why === 'full')), 'fourth refused: full');

// 4. start refused until everyone is ready
a.ctl({ t: 'ready', on: true });
b.ctl({ t: 'ready', on: true });
await sleep(150);
a.ctl({ t: 'start' });
ok(await waitFor(() => a.ctlOf('startFail').length > 0), 'start refused while one is not ready');

// 5. only the host may kick — anyone but himself, READY or not (17.10.2026: everyone is READY on entering)
b.ctl({ t: 'kick', slot: 2 });
await sleep(150);
ok(a.room.members.length === 3, 'a non-host cannot kick');
a.ctl({ t: 'kick', slot: 0 });
await sleep(150);
ok(a.room.members.length === 3, 'the host cannot kick himself');
c.ctl({ t: 'ready', on: true });
await sleep(150);
a.ctl({ t: 'kick', slot: 2 });
ok(await waitFor(() => c.ctlOf('kicked').length > 0 && a.room.members.length === 2), 'host kicks a READY player');
const c2 = client(`0xccc${tag}`, roomId); await c2.open;
ok(await waitFor(() => c2.ctlOf('refused').some((m) => m.why === 'kicked')), 'a kicked wallet cannot come back');

// 6. start
a.ctl({ t: 'start' });
ok(await waitFor(() => a.ctlOf('start').length > 0 && b.ctlOf('start').length > 0), 'both get start');
const st = a.ctlOf('start')[0];
ok(st.host === 0 && st.players.length === 2, 'start names the host and the players');
const list2 = await (await fetch(`${BASE}/rooms`)).json();
ok(!list2.rooms.some((r) => r.id === roomId), 'a started room leaves the list');

// 7. relay: A| to others, H| to the host, slot-addressed
b.send('A|{"t":"st","x":1}');
ok(await waitFor(() => a.find((s) => s === 'R1|{"t":"st","x":1}')), 'A| from slot 1 reaches slot 0 as R1|');
b.send('H|{"t":"rpc"}');
ok(await waitFor(() => a.find((s) => s === 'R1|{"t":"rpc"}')), 'H| reaches the host');
a.send('1|{"t":"you"}');
ok(await waitFor(() => b.find((s) => s === 'R0|{"t":"you"}')), 'slot-addressed reaches that slot');
ok(!a.find((s) => s === 'R0|{"t":"you"}'), 'nothing echoes back to the sender');

// 8. host goes silent → the fight moves to slot 1
const t0 = Date.now();
ok(await waitFor(() => b.ctlOf('host').some((m) => m.slot === 1), 6000), `silent host hands over (${Date.now() - t0} ms)`);
// 9. the old host's frames now go to the new host on H|
a.send('H|{"t":"rpc2"}');
ok(await waitFor(() => b.find((s) => s === 'R0|{"t":"rpc2"}')), 'H| follows the new host');

// 10. handoff on request + disconnect of the host
b.ctl({ t: 'handoff' });
ok(await waitFor(() => a.ctlOf('host').some((m) => m.slot === 0 && m.why === 'handoff')), 'handoff on request');
// 11. rejoin mid-run gets the start again
b.ws.close();
await sleep(300);
const b2 = client(`0xbbb${tag}`, roomId); await b2.open;
ok(await waitFor(() => b2.ctlOf('start').some((m) => m.rejoin)), 'rejoin mid-run gets start(rejoin)');
ok(await waitFor(() => a.ctlOf('joined').some((m) => m.slot === 1)), 'the others are told who came back');

for (const x of [a, b2, d, c2]) { try { x.ws.close(); } catch { /* */ } }
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
