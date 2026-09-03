import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { droidStaticUrl, droidAnimatedWebpUrl, droid3dPfpUrl, droidOthersideMmlUrl, batteryUrl } from '@/lib/media'
import { buildHonoraryDisplay } from '@/lib/droidDisplay'
import { lmntItem, buildLmntMetadata } from '@/lib/lmnt'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    // Token ids arrive in whatever shape the contract's URI template produces:
    //   /42          plain decimal
    //   /42.json     when the template ends in {id}.json
    //   /00…002a     ERC-1155 spec form — lowercase hex, zero-padded to 64
    // Honorary is 1155, so the padded-hex form must resolve or marketplaces
    // would 404 on every token past #9.
    const raw = params.id.trim().replace(/\.json$/i, '');

    // === CONTRACT-LEVEL METADATA (contractURI) ===
    // Collection card on marketplaces: name, blurb, avatar, banner. This is a
    // different thing from token metadata — contractURI describes the whole
    // collection, uri()/tokenURI() describes one NFT.
    // Royalties are intentionally omitted: this contract exposes EIP-2981
    // on-chain, which marketplaces prefer over anything declared here.
    if (raw.toLowerCase() === 'collection') {
      const site = 'https://apedroidz.com';

      // LMNT — отдельная коллекция предметов, не дроиды. Её карточка описывает
      // каталог вещей, а не персонажей, поэтому ветка своя.
      if (type === 'lmnt') {
        return NextResponse.json({
          name: 'LMNT\u2122 by ApeDroidz',
          description:
            'Limited item drops for ApeDroidz. Every LMNT item lives in the droid\u2019s own on-chain inventory, so it changes hands with the droid and never on its own.',
          image: `${site}/collection-avatar.png`,
          banner_image_url: `${site}/og-image.png`,
          external_link: site,
        }, { headers: corsHeaders });
      }

      const isHonoraryCollection = type === 'honorary';
      return NextResponse.json({
        name: isHonoraryCollection ? 'ApeDroidz Honorary' : 'ApeDroidz',
        description: isHonoraryCollection
          ? 'Honorary ApeDroidz — 1/1 droids handed to the people who built and carried the Droidz Network.'
          : '3333 glitch-born Droidz built on ApeChain. Each one is a living fragment of the closed Droidz Network.',
        image: `${site}/collection-avatar.png`,
        banner_image_url: `${site}/og-image.png`,
        external_link: site,
      }, { headers: corsHeaders });
    }

    const tokenId = /^[0-9a-fA-F]{64}$/.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);

    if (isNaN(tokenId) || tokenId < 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400, headers: corsHeaders });
    }

    // === HONORARY DROIDZ (ERC-1155) ===
    // Served from our own mirror rather than the on-chain uri(): the collection
    // is 1155 (there is no tokenURI), and the site owns two things the static
    // source JSON does not know about — which tokens actually have a gif, and the
    // holder's saved default view.
    if (type === 'honorary') {
      const { data: row } = await supabaseAdmin!
        .from('honorary_droidz')
        .select('token_id, name, description, external_url, traits, has_gif, has_png, display_pref, display_pref_updated_at')
        .eq('token_id', tokenId)
        .maybeSingle()

      if (!row) {
        return NextResponse.json({ error: 'Honorary droid not found' }, { status: 404, headers: corsHeaders })
      }

      const d = buildHonoraryDisplay(row)
      const origin = new URL(request.url).origin

      return NextResponse.json({
        name: d.name,
        description: d.description,
        image: d.image,
        // Interactive previewer — same switcher as the base collection, minus
        // the level/3D views that do not apply here.
        animation_url: `${origin}/api/viewer/${tokenId}?collection=honorary&v=${d.display_view}`,
        external_url: d.external_url || 'https://x.com/ApeDroidz',
        attributes: d.attributes,
      }, { headers: corsHeaders })
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

      // snake_case like every other trait value in the collection
      // ("apechain_blue", "iron_angel") — keeps the level layer readable to
      // marketplace filters without a space or capitals of its own.
      let levelString = `lvl_${currentLevel}`;
      if (currentLevel >= 2) {
        levelString = isSuper ? "lvl_2_super" : "lvl_2";
      }

      const cleanAttributes = (droid.traits || []).filter((attr: any) => {
        const tType = attr.trait_type?.toLowerCase() || "";
        return !['level', 'upgraded', 'upgrade level', 'upgraded level', 'rank', 'rank value'].includes(tType);
      });

      // ── Display preference (holder-saved default view) ──────────────────
      // 'pixel' | 'animated' | 'pfp3d' saved on the site dashboard; NULL →
      // level-based default (L2+ animated, L1 pixel). Read defensively so
      // metadata keeps working before the display_pref migration is applied.
      const displayPref = ['pixel', 'animated', 'pfp3d'].includes(droid.display_pref) ? droid.display_pref : null;
      // The 3D bust exists for every token, so only 'animated' is level-gated.
      const effectiveView: 'pixel' | 'animated' | 'pfp3d' =
        displayPref === 'pfp3d' ? 'pfp3d'
          : displayPref === 'animated' && currentLevel >= 2 ? 'animated'
            : displayPref === 'pixel' ? 'pixel'
              : currentLevel >= 2 ? 'animated' : 'pixel';

      // Variant assets live on Cloudflare R2 (assets.apedroidz.com), addressed
      // by token id. Pixel = STATIC png, animated = GIF. See lib/media.
      const pixelUrl = droidStaticUrl(tokenId, currentLevel, isSuper);
      // WebP, not GIF: marketplaces autoplay animated WebP in the image slot,
      // whereas a GIF there shows a frozen frame that only animates on hover.
      const animatedUrl = droidAnimatedWebpUrl(tokenId, isSuper);
      // 3D bust render — blue background for L1 and standard L2, orange for SUPER.
      const url3d = droid3dPfpUrl(tokenId, currentLevel, isSuper);

      // Cache-bust HTTP image URLs by level/super-state AND chosen view.
      // Marketplaces (OpenSea, Magic Eden) cache assets by absolute URL — the
      // query param changes exactly when the visual changes, so caches re-pull.
      // Include when the preference was saved: switching back to a previous
      // variant would otherwise reuse a URL the marketplace already cached, and
      // it would keep serving the old thumbnail.
      const prefMs = Date.parse(droid.display_pref_updated_at || '');
      const prefTag = Number.isFinite(prefMs) ? `-${Math.floor(prefMs / 1000).toString(36)}` : '';
      const viewTag = effectiveView === 'animated' ? 'a' : effectiveView === 'pfp3d' ? 'd' : 'p';
      const bustVersion = `${currentLevel}${isSuper ? 's' : ''}${viewTag}${prefTag}`;
      const bustImage = (url: string | undefined | null): string => {
        if (!url) return '';
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}v=${bustVersion}`;
      };

      // The interactive HTML previewer (animation_url) — lets marketplaces
      // render the Pixel/Animated/3D switcher; opens on the saved default.
      const origin = new URL(request.url).origin;
      const viewerUrl = `${origin}/api/viewer/${tokenId}?v=${bustVersion}`;

      // Standard marketplace shape — nothing beyond what OpenSea reads.
      //   image         → the variant the holder chose (thumbnails, grids, mobile;
      //                   a marketplace cannot render an HTML page here)
      //   animation_url → the interactive previewer, opening on that same choice
      // Both therefore reflect the saved default; the extra image_pixel /
      // image_animated / display_view fields the site used to publish were
      // non-standard noise and moved to /api/owned-droids.
      // Permanently locked droids say so in the name and description.
      //
      // Deliberately NOT a trait: marketplace rarity engines score the `attributes` array, so a
      // "Locked" trait held by part of the collection would rewrite every droid's rarity rank.
      // Name and description are not scored, so the status is visible to a buyer without moving
      // anyone's rank.
      const { data: lock } = await supabaseAdmin
        .from('locker_locks')
        .select('token_id')
        .eq('token_id', tokenId)
        .maybeSingle();
      const isLockedForever = Boolean(lock);

      const baseDescription = droid.description || "3333 glitch-born Droidz on ApeChain.";

      const metadata: Record<string, any> = {
        name: isLockedForever ? `ApeDroid #${droid.token_id} — Locked Forever` : `ApeDroid #${droid.token_id}`,
        description: isLockedForever
          ? `${baseDescription}\n\nThis droid has been permanently locked by its holder. It can never be transferred or sold again — any listing for it will fail.`
          : baseDescription,
        image: bustImage(
          effectiveView === 'animated' ? animatedUrl
            : effectiveView === 'pfp3d' ? url3d
              : pixelUrl,
        ),
        animation_url: viewerUrl,
        external_url: "https://apedroidz.com/dashboard",
        // Otherside читает это поле. Адрес один на токен и навсегда: документ
        // собирается на запрос из трейтов и уровня, поэтому апгрейд до level 2
        // сам добавляет кроссовки. Старое droid.mml_url вело на запечённую
        // модель целиком на GCS — она отстала от переработанных трейтов.
        mml: droidOthersideMmlUrl(tokenId),
        attributes: [
          ...cleanAttributes,
          { trait_type: "level", value: levelString }
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

      // Art is served from our own storage — no IPFS anywhere in the pipeline.
      const HTTP_LINKS = {
        standard: batteryUrl(false),
        super: batteryUrl(true)
      };

      // Fallback логика
      const bType = battery?.type || 'Standard';
      const isSuper = bType === 'Super';

      return NextResponse.json({
        name: `Energy Battery #${tokenId}`,
        description: isSuper
          ? "Super Battery used for ApeDroid evolution."
          : "Standard Battery used for ApeDroid evolution.",
        image: isSuper ? HTTP_LINKS.super : HTTP_LINKS.standard,
        external_url: "https://apedroidz.com/dashboard",
        attributes: [
          { trait_type: "Type", value: bType }
        ]
      }, { headers: corsHeaders });
    }

    // === LMNT — предметы (ERC-1155) ===
    // Каталог статический и живёт в src/lib/lmnt.ts: у вещи нет состояния,
    // которое стоило бы держать в БД. Уровень дроида здесь ни при чём — вещь
    // одинакова у всех, кто ею владеет.
    if (type === 'lmnt') {
      const item = lmntItem(tokenId);
      if (!item) {
        return NextResponse.json({ error: `Unknown LMNT item: ${tokenId}` }, { status: 404, headers: corsHeaders });
      }
      return NextResponse.json(buildLmntMetadata(item), { headers: corsHeaders });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 404, headers: corsHeaders });

  } catch (err: any) {
    console.error("API Error:", err);
    return NextResponse.json({ error: "Server Error" }, { status: 500, headers: corsHeaders });
  }
}