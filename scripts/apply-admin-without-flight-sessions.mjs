// Dry run by default (rolled back); --commit applies. Needs SUPABASE_DB_URL.
import fs from 'node:fs'
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query('begin')
await c.query(fs.readFileSync('supabase/migrations/20260924_admin_without_flight_sessions.sql', 'utf8'))
console.log((await c.query('select * from admin_lifetime_totals()')).rows[0])
console.log('crash buckets rows:', (await c.query('select * from admin_flight_crash_buckets()')).rowCount)
const commit = process.argv.includes('--commit')
await c.query(commit ? 'commit' : 'rollback')
console.log(commit ? 'COMMITTED' : 'dry run — rolled back')
await c.end()
