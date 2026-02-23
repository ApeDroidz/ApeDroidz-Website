const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const dbUrl = process.env.SUPABASE_DB_URL || "postgresql://postgres.jpbalgwwwalofynoaavv:" + process.env.SUPABASE_DB_PASS + "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

async function get() {
  const client = new Client({ connectionString: dbUrl });
  try {
     await client.connect();
     // Use the information schema if pg_get_functiondef is failing silently
     const res = await client.query("SELECT routine_definition FROM information_schema.routines WHERE routine_name = 'reserve_inventory_item';");
     console.log(res.rows[0]?.routine_definition);
  } catch (e) {
     console.log(e);
  } finally {
     await client.end();
  }
}
get();
