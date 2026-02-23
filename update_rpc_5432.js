const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const dbUrl = "postgresql://postgres.jpbalgwwwalofynoaavv:1M141L30v4aH8Z6Y@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

const sql = `
CREATE OR REPLACE FUNCTION public.reserve_inventory_item(p_prize_slug text, p_wallet_address text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_item record;
BEGIN
  -- 1. Grab the first available NFT of the specified type and IMMEDIATELY lock the row from other transactions
  SELECT *
  INTO v_item
  FROM nft_inventory
  WHERE prize_slug = p_prize_slug
    AND status = 'available'
  ORDER BY id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  -- 2. If no available items are found (Stockout)
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'stockout'
    );
  END IF;

  -- 3. Reserve the found row for the winner's wallet
  UPDATE nft_inventory
  SET 
    status = 'reserved',
    winner_wallet = p_wallet_address,
    updated_at = NOW()
  WHERE id = v_item.id;

  -- 4. Return the reserved NFT to the backend for the Thirdweb transfer
  RETURN json_build_object(
    'success', true,
    'data', json_build_object(
      'id', v_item.id,
      'token_id', v_item.token_id,
      'name', v_item.name,
      'amount', v_item.amount,
      'contract_address', v_item.contract_address
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$function$;
`;

async function update() {
  const client = new Client({ connectionString: dbUrl });
  try {
     await client.connect();
     await client.query(sql);
     console.log("Successfully updated reserve_inventory_item!");
  } catch (e) {
     console.error("Failed to update:", e);
  } finally {
     await client.end();
  }
}
update();
