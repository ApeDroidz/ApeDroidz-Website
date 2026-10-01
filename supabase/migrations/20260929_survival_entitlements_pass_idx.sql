-- Droidz Survival, 29.09.2026 — the season-pass lookup gets its own index.
--
-- «Does this wallet hold the pass» runs on every economy read (lib/survivalEconomyStore.ts loadEcon:
-- profile GET/PUT, every POST /economy, run/finish, entitlements), and on the board and the
-- standings. The only index by wallet on survival_entitlements was partial (claimed_at is null), so
-- the planner scanned the whole table — which grows by a row per lucky ticket (a pack of 50 is 50).
-- A partial index holding only the passes. Not CONCURRENTLY: the runner works in a transaction and
-- the table is small. APPLY ONLY WITH THE OWNER'S WORD.

create index if not exists survival_entitlements_pass
    on survival_entitlements (wallet, season_id) where kind = 'season_pass';
