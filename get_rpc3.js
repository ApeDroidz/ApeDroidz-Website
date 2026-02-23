const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const dbUrl = process.env.SUPABASE_DB_URL || "postgresql://postgres.jpbalgwwwalofynoaavv:" + process.env.SUPABASE_DB_PASS + "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

async function get() {
  const client = new Client({ connectionString: dbUrl });
  try {
     await client.connect();
     const res = await client.query("SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname = 'reserve_inventory_item';");
     console.log(res.rows[0]?.def);
  } catch (e) {
     console.log(e);
  } finally {
     await client.end();
  }
}
get();
