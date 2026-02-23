const { Client } = require("pg");

const dbUrl = "postgres://postgres.jpbalgwwwalofynoaavv:1M141L30v4aH8Z6Y@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

async function get() {
  const client = new Client({ connectionString: dbUrl });
  try {
     await client.connect();
     console.log("Connected to 5432...");
     const { rows } = await client.query(`
        SELECT p.proname, pg_get_functiondef(p.oid) as def 
        FROM pg_proc p 
        WHERE p.proname ILIKE '%reserve_inventory%'
     `);
     console.log("Functions found:", rows.length);
     rows.forEach(r => console.log(r.proname, "\n", r.def, "\n---"));
  } catch (e) {
     console.log(e);
  } finally {
     await client.end();
  }
}
get();
