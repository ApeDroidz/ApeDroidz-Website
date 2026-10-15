# Droidz Survival — co-op relay

Rooms and the in-run relay for co-op (game: `Droidz Survival on Ape/game/docs/COOP.md`).
A Cloudflare Worker with two Durable Objects:

- **Room** — one per room: the lobby (seats, READY, KICK, START), then the run's relay. It never
  reads the fight — the host's browser simulates it; the room passes frames along and hands the
  fight to the next player when the host goes quiet for 3 s (or asks to: a tab sent to the background).
- **Directory** — the list of open public rooms for the CO-OP screen.

At START the room asks the site to open every member's run at once (`POST {SITE_URL}/api/survival/coop/start`
with the shared secret) — all or nothing; nothing is spent before.

## Deploy (once)

```bash
cd workers/coop-relay
npm install
npx wrangler login                       # the Cloudflare account that holds apedroidz R2
npx wrangler secret put COOP_SECRET      # a long random string — the SAME value as the site's SURVIVAL_COOP_SECRET
npx wrangler deploy                      # prints https://droidz-coop-relay.<account>.workers.dev
```

Then on the site (Vercel → Environment Variables, Production), and redeploy:

| Variable | Value |
|---|---|
| `SURVIVAL_COOP_SECRET` | the same random string as `COOP_SECRET` above |
| `SURVIVAL_COOP_RELAY` | the URL `wrangler deploy` printed (or a custom domain, e.g. `https://coop.apedroidz.com`) |
| `SURVIVAL_COOP_PUBLIC` | leave unset — co-op is for the beta testers (`survival_allowlist`); `1` opens it to everyone |

And the database: `node --env-file=.env.local scripts/apply-survival-coop.mjs --commit`.

Cost: Durable Objects are on the Workers Free plan (SQLite-backed). A room is awake only while
someone is in it; a 20-minute run of four is about 1 200 inbound messages a minute.

## Local

```bash
printf 'DEV=1\nSITE_URL=\n' > .dev.vars   # dev tokens (`dev:<wallet>`) accepted; START spends nothing
npx wrangler dev --port 8787
node test/relay.test.mjs                  # 21 protocol checks
```

The game's dev build talks to `http://localhost:8787` (`VITE_COOP_RELAY` to change it); its
`tools/qa-coop.mjs` plays two-player runs against it.
