-- Droidz Survival — Ape Mini outside the run, cut with the run pay (04.10.2026).
--
-- The run's Ape Mini went to ×0.1 of 1.5 / 0.15 / 10 (game config/economy.ts RUN_COINS: a good
-- 10-minute run, 151k / wave 15 / 612 kills, pays ~80 instead of ~825). Everything the GAME pays
-- (the daily claim, the bestiary, the season ladder, the floor coin, the continue) moved with it in
-- the game's config and reaches the server through lib/survivalEconomy.json. What lives in the
-- DATABASE is here:
--   1. the lucky ticket's Ape Mini prizes: 200 / 600 / 2 000 → 75 / 250 / 750 (one ticket is worth
--      about one good run: Ape Mini EV ~86 + x2 minutes, against ~220 + boosts before);
--   2. the ticket's fallback prize (nothing left to draw, or the droid's NFT out of stock; a test
--      ticket that drew the droid): 200 → 75 Ape Mini, in survival_settle_order and
--      survival_entitlement_test_no_nft;
--   3. the beta review's Ape Mini: 200 for the stars + 800 for a review → 50 + 150 (the site's
--      /api/survival/feedback shows the same tariff, the game's Feedback.ts falls back to it).
--
-- NOT APPLIED. Apply with the owner's word, together with the site + game build that carries the new
-- economy (the site shows the new feedback tariff and the game the new prize labels from then on).
--
-- The functions are NOT re-typed from older files: each is read back from the database
-- (pg_get_functiondef), only its constants are replaced, and it is re-created from that — so whatever
-- else is live in them stays as it is. If a constant is not found where expected, the block raises;
-- run the file as one transaction (the SQL editor runs a script as one; psql: --single-transaction)
-- and nothing changes. Grants survive CREATE OR REPLACE.
-- Ticket weights and stock are not touched (edited in spltpnl).
--
-- Rollback: the same file with the numbers swapped back (75 → 200, 250 → 600, 750 → 2000; 50 → 200,
-- 150 → 800 — see the end of this file).

-- 1. The ticket's Ape Mini prizes (ids stay: they are keys in old entitlements; labels and specs change).
update survival_ticket_prizes set label = '75 Ape Mini',  spec = '{"coins":75}',  updated_at = now() where id = 'mini_500';
update survival_ticket_prizes set label = '250 Ape Mini', spec = '{"coins":250}', updated_at = now() where id = 'mini_1500';
update survival_ticket_prizes set label = '750 Ape Mini', spec = '{"coins":750}', updated_at = now() where id = 'mini_5000';

-- 2 + 3. The constants inside the live functions.
do $$
declare
    fn  regprocedure;
    def text;
    nxt text;
begin
    -- 2a. The settlement's fallback prize (twice in the body: the empty draw and the NFT out of stock).
    fn  := 'public.survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean, int)'::regprocedure;
    def := pg_get_functiondef(fn);
    nxt := replace(replace(def, '''200 Ape Mini''', '''75 Ape Mini'''), '{"coins":200}', '{"coins":75}');
    if nxt = def or position('{"coins":200}' in nxt) > 0 or position('200 Ape Mini' in nxt) > 0 then
        raise exception 'survival_settle_order: the 200 Ape Mini fallback was not found as expected — check it by hand';
    end if;
    execute nxt;

    -- 2b. A test ticket that drew the droid gets the fallback instead.
    fn  := 'public.survival_entitlement_test_no_nft()'::regprocedure;
    def := pg_get_functiondef(fn);
    nxt := replace(def, '{"id":"fallback","label":"200 Ape Mini","kind":"coins","spec":{"coins":200}}',
                        '{"id":"fallback","label":"75 Ape Mini","kind":"coins","spec":{"coins":75}}');
    if nxt = def then
        raise exception 'survival_entitlement_test_no_nft: the 200 Ape Mini fallback was not found — check it by hand';
    end if;
    execute nxt;

    -- 3. The review's tariff.
    fn  := 'public.survival_submit_feedback(text, int, text, text)'::regprocedure;
    def := pg_get_functiondef(fn);
    -- (\1 is the captured «c_rating_award constant int := »; Postgres back-references are one digit,
    -- so '\150;' reads as \1 then «50;».)
    nxt := regexp_replace(def, '(c_rating_award\s+constant\s+int\s*:=\s*)200\s*;', '\150;');
    nxt := regexp_replace(nxt, '(c_comment_award\s+constant\s+int\s*:=\s*)800\s*;', '\1150;');
    if nxt !~ 'c_rating_award\s+constant\s+int\s*:=\s*50;' or nxt !~ 'c_comment_award\s+constant\s+int\s*:=\s*150;' then
        raise exception 'survival_submit_feedback: the 200 / 800 tariff was not found — check it by hand';
    end if;
    execute nxt;
end $$;

comment on table survival_feedback is
    'Отзывы о бете. Одна строка на кошелёк; coins_awarded — сколько Ape Mini уже выдано (тариф с 04.10.2026: 50 за звёзды + 150 за отзыв, до этого 200 + 800).';

-- ── CHECK after applying ─────────────────────────────────────────────────────────────────────────
--   select id, label, spec, weight from survival_ticket_prizes where id like 'mini_%' order by sort;
--   select position('{"coins":75}' in pg_get_functiondef('public.survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean, int)'::regprocedure)) > 0;
--   select pg_get_functiondef('public.survival_submit_feedback(text, int, text, text)'::regprocedure) ~ 'c_comment_award\s+constant\s+int\s*:=\s*150;';
--
-- ── ROLLBACK (by hand) ───────────────────────────────────────────────────────────────────────────
--   update survival_ticket_prizes set label = '200 Ape Mini',   spec = '{"coins":200}'  where id = 'mini_500';
--   update survival_ticket_prizes set label = '600 Ape Mini',   spec = '{"coins":600}'  where id = 'mini_1500';
--   update survival_ticket_prizes set label = '2 000 Ape Mini', spec = '{"coins":2000}' where id = 'mini_5000';
--   and the do-block above with 75 → 200 in 2a/2b and 50 / 150 → 200 / 800 in 3.
