import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getContract } from 'thirdweb/contract'
import { readContract } from 'thirdweb'
import { client, apeChain } from '@/lib/thirdweb'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HONORARY_CONTRACT = '0x427ff4b908c4ba7bc1d689bacac280a0435b2514'
const ASSETS_BASE = 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets'

// `force-dynamic` only stops Next.js from caching the route output. Without
// these headers any upstream CDN/edge (Vercel, Cloudflare) and consumers
// like OpenSea are free to cache the JSON for hours, which is exactly what
// caused metadata refreshes to lag after each upgrade. `no-store` tells
// every layer to refetch on demand.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Expires': '0',
}

const resolveIpfs = (url: string | undefined | null): string => {
  if (!url) return ''
  if (url.startsWith('ipfs://')) return url.replace('ipfs://', 'https://cf-ipfs.com/ipfs/')
  if (url.startsWith('http')) return url
  return url
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const params = await context.params;
    const type = params.type.toLowerCase().trim();
    const id = params.id.trim();
    const tokenId = parseInt(id);

    if (isNaN(tokenId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400, headers: corsHeaders });
    }

    // === HONORARY DROIDZ — fetch tokenURI on-chain, proxy IPFS metadata server-side ===
    if (type === 'honorary') {
      const contract = getContract({ client, chain: apeChain, address: HONORARY_CONTRACT })

      const tokenURI = await readContract({
        contract,
        method: "function tokenURI(uint256) returns (string)",
        params: [BigInt(tokenId)]
      })

      const metadataUrl = resolveIpfs(tokenURI)
      const metaRes = await fetch(metadataUrl, { next: { revalidate: 3600 } })
      if (!metaRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch IPFS metadata' }, { status: 502, headers: corsHeaders })
      }
      const metadata = await metaRes.json()

      // Resolve image URL inside metadata too
      if (metadata.image) {
        metadata.image = resolveIpfs(metadata.image)
      }

      return NextResponse.json(metadata, { headers: corsHeaders })
    }

    // === БЛОК ДРОИДОВ ===
    if (type === 'droidz' || type === 'droid') {
      const { data: droid } = await supabaseAdmin
        .from('droidz')
        .select('*')
        .eq('token_id', tokenId)
        .maybeSingle();

      if (!droid) return NextResponse.json({ error: "Droid not found" }, { status: 404, headers: corsHeaders });

      const isSuper = !!droid.is_super;
      const currentLevel = droid.level || 1;

      let levelString = String(currentLevel);
      if (currentLevel >= 2) {
        levelString = isSuper ? "2 SUPER" : "2";
      }

      const cleanAttributes = (droid.traits || []).filter((attr: any) => {
        const tType = attr.trait_type?.toLowerCase() || "";
        return !['level', 'upgraded', 'upgrade level', 'upgraded level', 'rank', 'rank value'].includes(tType);
      });

      // ── Display preference (holder-saved default view) ──────────────────
      // 'pixel' | 'animated' saved on the site dashboard; NULL → level-based
      // default (L2+ animated, L1 pixel). Read defensively so metadata keeps
      // working before the display_pref migration is applied.
      const displayPref = ['pixel', 'animated'].includes(droid.display_pref) ? droid.display_pref : null;
      const effectiveView: 'pixel' | 'animated' =
        displayPref === 'animated' && currentLevel >= 2 ? 'animated'
          : displayPref === 'pixel' ? 'pixel'
            : currentLevel >= 2 ? 'animated' : 'pixel';

      // Variant assets live in our Supabase storage, addressed by token id.
      // Pixel = STATIC png (level2-super for upgraded, level1 for L1); the .webp
      // in level2//super folders is ANIMATED, so it must NOT back the pixel view.
      const pixelUrl = currentLevel >= 2
        ? `${ASSETS_BASE}/level2-super/${tokenId}.png`
        : `${ASSETS_BASE}/level1/${tokenId}.png`;
      const animatedUrl = `${ASSETS_BASE}/${isSuper ? 'super-gif' : 'level2-gif'}/${tokenId}.gif`;

      // Cache-bust HTTP image URLs by level/super-state AND chosen view.
      // Marketplaces (OpenSea, Magic Eden) cache assets by absolute URL — the
      // query param changes exactly when the visual changes, so caches re-pull.
      const bustVersion = `${currentLevel}${isSuper ? 's' : ''}${effectiveView === 'animated' ? 'a' : 'p'}`;
      const bustImage = (url: string | undefined | null): string => {
        if (!url) return '';
        if (url.startsWith('ipfs://')) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}v=${bustVersion}`;
      };

      // The interactive HTML previewer (animation_url) — lets marketplaces
      // render the Pixel/Animated/3D switcher; opens on the saved default.
      const origin = new URL(request.url).origin;
      const viewerUrl = `${origin}/api/viewer/${tokenId}?v=${bustVersion}`;

      // Base metadata object
      const metadata: Record<string, any> = {
        name: `ApeDroid #${droid.token_id}`,
        description: droid.description || "3333 glitch-born Droidz on ApeChain.",
        image: bustImage(effectiveView === 'animated' ? animatedUrl : pixelUrl),
        // Site-internal helpers (harmless extras for marketplaces): the
        // dashboard inventory always renders the lightweight static art.
        image_pixel: bustImage(pixelUrl),
        image_animated: bustImage(animatedUrl),
        display_view: effectiveView,
        mml: droid.mml_url, // Added MML parameter from DB
        external_url: "https://apedroidz.com/dashboard",
        animation_url: viewerUrl,
        attributes: [
          ...cleanAttributes,
          { trait_type: "Level", value: levelString }
        ]
      };

      return NextResponse.json(metadata, { headers: corsHeaders });
    }

    // === БЛОК БАТАРЕЕК (ОБНОВЛЕННЫЙ) ===
    if (type === 'battery' || type === 'batteries') {
      const { data: battery } = await supabaseAdmin
        .from('batteries')
        .select('type') // Нам нужен только тип
        .eq('token_id', tokenId)
        .maybeSingle();

      const IPFS_LINKS = {
        standard: "ipfs://bafybeid4d4yfoljgoqkbwzv7lk6trdsivanfeuziq7w5m2ogsgmlra7aiy/standart_battery.webp",
        super: "ipfs://bafybeid4d4yfoljgoqkbwzv7lk6trdsivanfeuziq7w5m2ogsgmlra7aiy/super_battery.webp"
      };

      const HTTP_LINKS = {
        standard: "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp",
        super: "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/super_battery.webp"
      };

      // Fallback логика
      const bType = battery?.type || 'Standard';
      const isSuper = bType === 'Super';

      return NextResponse.json({
        name: `Energy Battery #${tokenId}`,
        description: isSuper
          ? "Super Battery used for ApeDroid evolution."
          : "Standard Battery used for ApeDroid evolution.",
        image: isSuper ? IPFS_LINKS.super : IPFS_LINKS.standard,
        animation_url: isSuper ? IPFS_LINKS.super : IPFS_LINKS.standard, // User requested identical to image
        image_http: isSuper ? HTTP_LINKS.super : HTTP_LINKS.standard, // Для сайта
        external_url: "https://apedroidz.com/dashboard",
        attributes: [
          { trait_type: "Type", value: bType }
        ]
      }, { headers: corsHeaders });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 404, headers: corsHeaders });

  } catch (err: any) {
    console.error("API Error:", err);
    return NextResponse.json({ error: "Server Error" }, { status: 500, headers: corsHeaders });
  }
}