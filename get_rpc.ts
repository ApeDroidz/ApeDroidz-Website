import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function get() {
  const { data, error } = await supabase.rpc("reserve_inventory_item", { p_prize_slug: "test", p_wallet_address: "test" });
  console.log("TEST CALL:", data, error);
}
get();
