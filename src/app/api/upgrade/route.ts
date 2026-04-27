import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createThirdwebClient, defineChain, getContract } from 'thirdweb';
import { ownerOf } from 'thirdweb/extensions/erc721';
import { requireWalletAuth } from '@/lib/walletAuth';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const apeChain = defineChain(33139);
const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '';
const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || '';

// === КОНФИГУРАЦИЯ ===
const UPGRADE_CONFIG = {
    standard: {
        ipfsBaseUrl: 'ipfs://bafybeicp25ylfrxcvnzve2rnvuxmggajorbvvu47ws27tiybhui5dgtip4',
        levelTrait: '',
        backgroundTrait: 'apechain_blue',
    },
    super: {
        ipfsBaseUrl: 'ipfs://bafybeicsk4upnt4jvmx3w37vcurti4pszgeqpr3s77gc74q5wdyqw6ay6m',
        levelTrait: '',
        backgroundTrait: 'apechain_orange',
    },
};

/**
 * Determine battery type. Order:
 *  1. `batteries` DB row (preferred — fast, source of truth).
 *  2. Fallback to /api/metadata/battery/{id} (proxies on-chain tokenURI).
 *  3. Default to 'Standard' as last-resort safe value.
 *
 * The third path matters because merge-created batteries do not always have a
 * `batteries` row. Without this fallback, those users lose their battery on
 * upgrade with no recovery path.
 */
async function resolveBatteryType(batteryTokenId: number): Promise<'Standard' | 'Super'> {
    const { data: row } = await supabase
        .from('batteries')
        .select('type')
        .eq('token_id', batteryTokenId)
        .maybeSingle();

    if (row?.type) {
        return String(row.type).toLowerCase() === 'super' ? 'Super' : 'Standard';
    }

    // Last-ditch: check on-chain metadata via internal route. We don't fetch
    // arbitrary IPFS — the metadata route already proxies that for us.
    try {
        const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
        const res = await fetch(`${base}/api/metadata/battery/${batteryTokenId}`, { cache: 'no-store' });
        if (res.ok) {
            const meta = await res.json();
            const typeAttr = meta?.attributes?.find?.((a: any) => String(a?.trait_type).toLowerCase() === 'type');
            if (typeAttr?.value && String(typeAttr.value).toLowerCase() === 'super') return 'Super';
        }
    } catch {/* ignore */}

    return 'Standard';
}

/** Returns true iff the token has been burned (ownerOf reverts or returns zero). */
async function isBatteryBurnedOnChain(batteryTokenId: number): Promise<boolean> {
    if (!BATTERY_CONTRACT_ADDRESS) return false;
    try {
        const contract = getContract({ client: thirdwebClient, chain: apeChain, address: BATTERY_CONTRACT_ADDRESS });
        const owner = await ownerOf({ contract, tokenId: BigInt(batteryTokenId) });
        // Some contracts return zero address instead of reverting after burn.
        if (!owner || /^0x0+$/.test(owner)) return true;
        return false;
    } catch {
        // ownerOf reverts on burned/non-existent tokens — that's our signal.
        return true;
    }
}

/** Verify the caller actually owns the droid. Fail-closed on RPC errors. */
async function isDroidOwnedBy(droidTokenId: number, expectedOwner: string): Promise<boolean> {
    if (!DROID_CONTRACT_ADDRESS) return false;
    try {
        const contract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT_ADDRESS });
        const owner = await ownerOf({ contract, tokenId: BigInt(droidTokenId) });
        return !!owner && owner.toLowerCase() === expectedOwner.toLowerCase();
    } catch (e: any) {
        console.error('[upgrade] ownerOf droid failed:', e.message);
        return false;
    }
}

/**
 * POST /api/upgrade
 *
 * Two-phase flow to prevent the "battery burns but upgrade fails" loss:
 *   - phase=precheck → validates ownership/level/battery type WITHOUT writing.
 *                       Client should call this BEFORE the on-chain burn.
 *   - phase=commit  → verifies the battery is now burned on-chain, then runs
 *                       the upgrade RPC. Idempotent — safe to retry.
 *
 * Auth: requires session cookie (wallet from session, NEVER from body).
 */
export async function POST(req: Request) {
    // ── 1. Authentication ──────────────────────────────────────────────────
    const auth = requireWalletAuth(req);
    if (auth instanceof Response) return auth;
    const wallet = auth.wallet;

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const { tokenId, batteryId, phase } = body ?? {};
    const targetId = parseInt(tokenId);
    const batteryTokenId = parseInt(batteryId);

    if (isNaN(targetId) || isNaN(batteryTokenId) || targetId < 0 || batteryTokenId < 0) {
        return NextResponse.json({ error: 'Invalid tokenId / batteryId' }, { status: 400 });
    }

    const requestedPhase = phase === 'precheck' ? 'precheck' : 'commit';
    console.log(`🚀 [Upgrade:${requestedPhase}] wallet=${wallet.slice(0, 8)} droid=${targetId} battery=${batteryTokenId}`);

    try {
        // ── 2. Verify droid ownership on-chain ─────────────────────────────
        const ownsDroid = await isDroidOwnedBy(targetId, wallet);
        if (!ownsDroid) {
            return NextResponse.json({ error: 'You do not own this droid' }, { status: 403 });
        }

        // ── 3. Verify droid level < 2 (in DB; source of truth) ─────────────
        const { data: currentDroid, error: fetchError } = await supabase
            .from('droidz')
            .select('level, traits')
            .eq('token_id', targetId)
            .single();

        if (fetchError || !currentDroid) {
            return NextResponse.json({ error: 'Droid not found in database' }, { status: 404 });
        }
        if (currentDroid.level >= 2) {
            return NextResponse.json({ error: 'Droid is already Level 2 or higher' }, { status: 400 });
        }

        // ── 4. Determine battery type (with fallback to metadata route) ────
        const batteryType = await resolveBatteryType(batteryTokenId);
        const isSuperBattery = batteryType === 'Super';
        console.log(`🔋 [Upgrade:${requestedPhase}] Battery type resolved: ${batteryType}`);

        // ── 5. PRECHECK: stop here if client only wants validation ────────
        if (requestedPhase === 'precheck') {
            return NextResponse.json({
                ok: true,
                isSuper: isSuperBattery,
                phase: 'precheck',
            });
        }

        // ── 6. COMMIT: verify battery is actually burned on-chain ─────────
        // This is the proof of right — only the owner could have burned it.
        const burned = await isBatteryBurnedOnChain(batteryTokenId);
        if (!burned) {
            return NextResponse.json(
                { error: 'Battery not burned on-chain yet — please complete the burn transaction first' },
                { status: 400 },
            );
        }
        console.log(`🔥 [Upgrade] Battery #${batteryTokenId} confirmed burned on-chain`);

        // ── 7. Mark battery burned in DB (auto-recover missing row) ───────
        // Upsert keyed on token_id ensures merge-created batteries get a row
        // here too, fixing the "batteries row missing → upgrade fails" loss.
        const { error: upsertErr } = await supabase
            .from('batteries')
            .upsert(
                { token_id: batteryTokenId, type: batteryType, is_burned: true },
                { onConflict: 'token_id' },
            );
        if (upsertErr) {
            console.error('❌ [Upgrade] battery upsert failed:', upsertErr.message);
            // Non-fatal — the on-chain proof of burn is the real source of truth.
        }

        // ── 8. Run upgrade RPC ─────────────────────────────────────────────
        const config = isSuperBattery ? UPGRADE_CONFIG.super : UPGRADE_CONFIG.standard;
        const { data: rpcData, error: rpcError } = await supabase.rpc('fission_upgrade_final', {
            target_token_id: targetId,
            new_img_base_url: config.ipfsBaseUrl,
            new_level_trait_value: config.levelTrait,
            new_background_trait_value: config.backgroundTrait,
        });

        if (rpcError) {
            console.error('❌ [Upgrade] RPC error:', rpcError.message);
            // Battery already burned on-chain. Return a clear support message.
            return NextResponse.json({
                error: 'Upgrade RPC failed. Battery was burned — please retry the upgrade or contact support with these IDs.',
                details: rpcError.message,
                droidId: targetId,
                batteryId: batteryTokenId,
            }, { status: 500 });
        }

        // ── 9. Trait sanitisation (remove any "level"/"upgrade level" leftovers) ─
        const dirtyTraits = rpcData?.traits || currentDroid.traits || [];
        const cleanTraits = dirtyTraits.filter((t: any) => {
            if (!t) return false;
            const type = String(t.trait_type || '').toLowerCase().trim();
            const val = String(t.value || '').toLowerCase().trim();
            const banned = ['level', 'upgrade level', 'upgraded', 'rank', 'rank value'];
            if (banned.includes(type)) return false;
            if (val === '' || val === 'null' || val === 'undefined' || val === 'temp_level') return false;
            return true;
        });

        // ── 10. Final write ────────────────────────────────────────────────
        const { data: finalDroid, error: updateError } = await supabase
            .from('droidz')
            .update({
                level: 2,
                is_super: isSuperBattery,
                traits: cleanTraits,
            })
            .eq('token_id', targetId)
            .select()
            .single();

        if (updateError || !finalDroid) {
            console.error('❌ [Upgrade] Final update failed:', updateError?.message);
            return NextResponse.json({
                error: 'Upgrade DB update failed — please retry. If problem persists, contact support.',
                droidId: targetId,
                batteryId: batteryTokenId,
            }, { status: 500 });
        }

        console.log(`✅ [Upgrade] Droid #${targetId} → Level 2 (Super: ${isSuperBattery})`);

        return NextResponse.json({
            updatedDroid: finalDroid,
            newLevel: finalDroid.level,
            newImage: finalDroid.image_url,
            isSuper: finalDroid.is_super,
        });

    } catch (err: any) {
        console.error('🔥 [Upgrade] Critical:', err.message);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
