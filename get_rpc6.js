const { Client } = require("pg");
const dbUrl = "postgres://postgres.jpbalgwwwalofynoaavv:1M141L30v4aH8Z6Y@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

async function get() {
  const client = new Client({ connectionString: dbUrl });
  try {
     await client.connect();
     const { rows } = await client.query("SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'reserve_inventory_item';");
     console.log(rows[0]?.def);
  } catch (e) {
     console.log(e);
  } finally {
     await client.end();
  }
}
get();
