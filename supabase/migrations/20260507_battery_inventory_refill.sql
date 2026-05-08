-- ── Std battery inventory refill (147 NFTs) ─────────────────────────────────
-- The vault drained to 1 available std_battery during testing, causing 6
-- failed merges where users transferred shards on-chain but received nothing
-- (auto-refund logic added in the same batch as this migration prevents
-- recurrence going forward — but the vault still needs stock).
--
-- These 147 token_ids were collected by the operator and confirmed to live
-- on the vault wallet on-chain. We INSERT each as a fresh row with status
-- `available`. Pre-existing rows (status `claimed` / `error` / `closed`)
-- for the same token_id are left alone — schema allows multiple rows per
-- token_id, and the merge endpoint filters by status='available' so the
-- new rows are picked up first.
--
-- Run from Supabase SQL Editor.

-- The nft_inventory.id sequence has fallen behind MAX(id) (likely a manual
-- INSERT or import bypassed the sequence at some point). Without this fix
-- INSERT below would explode with `duplicate key … nft_inventory_pkey` —
-- which is exactly what happened on the first run. Bump the sequence to
-- MAX(id) so the next nextval() lands on a free slot.
SELECT setval(
    pg_get_serial_sequence('nft_inventory', 'id'),
    COALESCE((SELECT MAX(id) FROM nft_inventory), 1)
);

INSERT INTO nft_inventory (prize_type_id, contract_address, token_id, image_url, name, status)
SELECT
    'std_battery',
    '0xd1504ca21b503fa2f5884f27fe2c8c9727a10b8d',
    tid::text,
    'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp',
    'Energy Battery #' || tid::text,
    'available'
FROM (VALUES
    -- Batch 1 (98 tokens)
    (1333),(1346),(1342),(1326),(1339),(1318),(1334),(1349),(1343),(1350),
    (110),(243),(156),(129),(224),(240),(264),(248),(180),(128),(102),(216),(225),(247),
    (166),(83),(171),(164),(157),(1794),(1892),(1793),(1775),(1878),(1869),(1868),(1893),(1891),
    (1877),(1772),(1874),(1771),(1896),(1880),(1767),(1770),(1895),(1870),(1897),
    (1885),(1916),(2138),(1888),(2232),(2141),(2235),(1195),(1279),(1198),(1238),(1142),(1537),
    (1240),(1462),(1465),(1330),(1543),(1467),(1315),(1309),(1464),(1476),(1307),(1487),(1314),(2005),
    (2314),(2319),(2312),(2226),(2228),(2320),(2244),(2305),(2240),(2243),(2230),(2316),(2304),(2242),
    (2317),(2229),(2313),(2318),(2245),(2241),(2184),(2171),
    -- Batch 2 (49 tokens)
    (2168),(2180),(2181),(2182),(2174),(2183),(2159),(2170),(2187),(2177),(2172),(2179),(2178),
    (2169),(2225),(2173),(2160),(2176),(2294),(1297),(2303),(1745),(1697),(1692),(1915),(1898),(1909),
    (2292),(1744),(1696),(2288),(1889),(1910),(2291),(1913),(2293),(1914),(1890),(2101),(2105),(2055),
    (2102),(2127),(2088),(2137),(2136),(2100),(2054),(2086)
) AS t(tid);

-- Sanity: should now report 147 fresh available rows.
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT COUNT(*) INTO n
    FROM nft_inventory
    WHERE prize_type_id = 'std_battery' AND status = 'available';
    RAISE NOTICE 'std_battery available after refill: %', n;
END $$;
