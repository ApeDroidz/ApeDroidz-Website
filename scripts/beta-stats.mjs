// Read-only: aggregate beta run outcomes, no wallets, to price the continue.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n== ' + label); console.table(r.rows); }
  catch (e) { console.log('\n== ' + label + ' -> ' + e.message); }
};
await q('runs by verdict', `select verdict, count(*) from survival_runs group by 1 order by 2 desc`);
await q('finished runs: score / wave / kills', `
  select count(*) n,
         round(avg(score)) avg_score, percentile_disc(0.5) within group (order by score) med_score,
         max(score) max_score,
         round(avg(wave),1) avg_wave, max(wave) max_wave,
         round(avg(kills)) avg_kills
  from survival_runs where score is not null and score > 0`);
await q('implied Ape Mini per run (score+kills+wave*25)', `
  select round(avg(score+coalesce(kills,0)+coalesce(wave,0)*25)) avg_coins,
         percentile_disc(0.5) within group (order by score+coalesce(kills,0)+coalesce(wave,0)*25) med_coins,
         percentile_disc(0.25) within group (order by score+coalesce(kills,0)+coalesce(wave,0)*25) p25_coins,
         max(score+coalesce(kills,0)+coalesce(wave,0)*25) max_coins
  from survival_runs where score is not null and score > 0`);
await q('coins players are actually holding', `select count(*) players, round(avg(coins)) avg_coins, max(coins) max_coins from survival_profiles`);
await q('runs per player', `select count(*) players, round(avg(runs),1) avg_runs, max(runs) max_runs from survival_profiles`);
await c.end();
