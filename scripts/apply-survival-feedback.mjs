/**
 * Applies 20260920_survival_beta_feedback.sql (the beta review and its Ape Mini payout).
 *
 * Additive — one table, one function. But it PAYS, so the dry run does not stop at «таблица
 * появилась»: inside the transaction it makes a throwaway wallet, walks it through the whole
 * route a tester walks, and checks the four things that would cost real currency if wrong:
 *
 *   1. under three finished runs the door is shut;
 *   2. stars alone pay exactly the rating award, and a second identical submit pays 0;
 *   3. adding a long enough comment tops up by the comment award and no more;
 *   4. deleting the comment afterwards claws nothing back;
 *
 * and, throughout, that the server profile's coins and state->>'coins' move by the same
 * amount — the game reads the second one at boot and the panel reads the first.
 *
 *   node --env-file=.env.local scripts/apply-survival-feedback.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-feedback.mjs --commit  # actually apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260920_survival_beta_feedback.sql'
const WALLET = '0xfeed' + 'b'.repeat(36)
const RATING_AWARD = 200
const COMMENT_AWARD = 800
const LONG = 'x'.repeat(60)

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const one = async (sql, params) => (await client.query(sql, params)).rows[0]
const submit = async (rating, comment) =>
    (await one('select survival_submit_feedback($1,$2,$3,$4) as r', [WALLET, rating, comment, 'test'])).r

const checks = []
const expect = (name, actual, wanted) => {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted)
    checks.push([name, ok, ok ? '' : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`])
}

await client.query('begin')
try {
    await client.query(readFileSync(SQL_PATH, 'utf8'))

    const t = await one("select 1 from information_schema.tables where table_name='survival_feedback'")
    if (!t) throw new Error('survival_feedback did not land')
    const rls = await one("select relrowsecurity from pg_class where relname='survival_feedback'")
    if (!rls?.relrowsecurity) throw new Error('RLS not enabled on survival_feedback')

    // ---- a throwaway tester ------------------------------------------------
    const season = await one("select id from survival_seasons where status='live' limit 1")
    if (!season) throw new Error('no live season to attach test runs to')
    await client.query('insert into survival_players (wallet) values ($1)', [WALLET])
    await client.query(
        `insert into survival_profiles (wallet, state, coins) values ($1, '{"coins":0}'::jsonb, 0)`, [WALLET])

    // 1. the gate
    expect('под 3 забега дверь закрыта', (await submit(5, null)).error, 'not_eligible')

    for (let i = 0; i < 3; i++) {
        await client.query(
            `insert into survival_runs (season_id, wallet, status, finished_at, score, wave, kills)
             values ($1, $2, 'finished', now(), 100, 1, 10)`, [season.id, WALLET])
    }

    // 2. stars alone, then the same submit again
    let r = await submit(5, null)
    expect('звёзды платят ставку', [r.ok, r.awarded, r.total_awarded, r.mirrored], [true, RATING_AWARD, RATING_AWARD, true])
    r = await submit(5, null)
    expect('повтор не платит второй раз', r.awarded, 0)

    // 3. the comment tops up, and only by its own award
    r = await submit(4, LONG)
    expect('комментарий доплачивает', [r.awarded, r.total_awarded], [COMMENT_AWARD, RATING_AWARD + COMMENT_AWARD])
    r = await submit(4, LONG)
    expect('правка того же текста не платит', r.awarded, 0)
    r = await submit(4, 'коротко')
    expect('короткий комментарий не платит', r.awarded, 0)

    // 4. nothing is taken back
    const row = await one('select rating, comment, coins_awarded, runs_at_submit, edited_count from survival_feedback where wallet=$1', [WALLET])
    expect('выданное не отзывается', Number(row.coins_awarded), RATING_AWARD + COMMENT_AWARD)
    expect('последняя правка сохранена', [row.rating, row.comment], [4, 'коротко'])
    expect('забеги на момент отправки записаны', Number(row.runs_at_submit), 3)

    // the two places the total lives must agree
    const prof = await one(`select coins, (state->>'coins')::int as state_coins from survival_profiles where wallet=$1`, [WALLET])
    expect('колонка и state сошлись', [Number(prof.coins), Number(prof.state_coins)],
        [RATING_AWARD + COMMENT_AWARD, RATING_AWARD + COMMENT_AWARD])

    // a bad rating is refused before anything is written
    expect('оценка вне 1..5 отвергнута', (await submit(9, null)).error, 'bad_rating')

    for (const [name, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
    const failed = checks.filter(([, ok]) => !ok).length
    if (failed) throw new Error(`${failed} invariant(s) failed`)

    // The tester and its runs exist only to prove the above; they never reach the real data.
    await client.query('delete from survival_feedback where wallet=$1', [WALLET])
    await client.query('delete from survival_profiles where wallet=$1', [WALLET])
    await client.query('delete from survival_season_best where wallet=$1', [WALLET])
    await client.query('delete from survival_runs where wallet=$1', [WALLET])
    await client.query('delete from survival_players where wallet=$1', [WALLET])

    if (COMMIT) { await client.query('commit'); console.log('\n✓ committed') }
    else { await client.query('rollback'); console.log('\nDry run OK — rolled back.') }
} catch (e) {
    await client.query('rollback')
    console.error('✗', e.message)
    process.exit(1)
} finally {
    await client.end()
}
