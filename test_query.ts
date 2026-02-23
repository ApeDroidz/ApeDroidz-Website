import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
    const { data: sData, error: sError } = await supabase.from('glitch_season_1').select('*, users(username), glitch_users(x_handle)').limit(1);
    console.log('Season 1 relation test:', JSON.stringify(sData, null, 2), sError);
}

test();
