import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
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

    // === БЛОК ДРОИДОВ (Без изменений) ===
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

      // Base metadata object
      const metadata: Record<string, any> = {
        name: `ApeDroidz #${droid.token_id}`,
        description: droid.description || "3333 glitch-born Droidz on ApeChain.",
        image: droid.image_url,
        external_url: "https://apedroidz.com/dashboard",
        attributes: [
          ...cleanAttributes,
          { trait_type: "Level", value: levelString }
        ]
      };

      // Add animation_url ONLY for level 2+ droids (from DB column)
      if (currentLevel >= 2 && droid.animation_url) {
        metadata.animation_url = droid.animation_url;
      }

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