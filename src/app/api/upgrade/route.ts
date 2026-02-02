import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// === КОНФИГУРАЦИЯ ===
const UPGRADE_CONFIG = {
  standard: {
    ipfsBaseUrl: "ipfs://bafybeicp25ylfrxcvnzve2rnvuxmggajorbvvu47ws27tiybhui5dgtip4",
    // Оставляем пустым или ставим заглушку, так как мы все равно перезапишем трейты
    levelTrait: "",
    backgroundTrait: "apechain_blue"
  },
  super: {
    ipfsBaseUrl: "ipfs://bafybeicsk4upnt4jvmx3w37vcurti4pszgeqpr3s77gc74q5wdyqw6ay6m",
    levelTrait: "",
    backgroundTrait: "apechain_orange"
  }
};

export async function POST(req: Request) {
  try {
    const { tokenId, batteryId } = await req.json();
    const targetId = parseInt(tokenId);
    const batteryTokenId = parseInt(batteryId);

    if (isNaN(targetId) || isNaN(batteryTokenId)) {
      return NextResponse.json({ error: "Invalid request data. tokenId and batteryId required." }, { status: 400 });
    }

    console.log(`🚀 [API] Starting upgrade for Droid #${targetId} with Battery #${batteryTokenId}...`);

    // 1. ПРОВЕРЯЕМ ТИП БАТАРЕЙКИ В БД (Source of Truth)
    const { data: batteryData, error: batteryError } = await supabase
      .from('batteries')
      .select('type')
      .eq('token_id', batteryTokenId)
      .maybeSingle();

    if (batteryError || !batteryData) {
      console.error("Battery check failed:", batteryError);
      return NextResponse.json({ error: "Battery not found in database or verification failed." }, { status: 400 });
    }

    const isSuperBattery = String(batteryData.type).toLowerCase() === 'super';
    console.log(`🔋 [API] Verified Battery Type: ${batteryData.type} (Super: ${isSuperBattery})`);

    // 2. MARK BATTERY AS BURNED IN DATABASE
    const { error: burnError } = await supabase
      .from('batteries')
      .update({ is_burned: true })
      .eq('token_id', batteryTokenId);

    if (burnError) {
      console.error("❌ [API] Failed to mark battery as burned:", burnError.message);
      // Continue anyway - on-chain burn already happened
    } else {
      console.log(`🔥 [API] Battery #${batteryTokenId} marked as burned in DB`);
    }

    // 3. ПРОВЕРКА: Не апгрейдим ли мы уже улучшенного?
    const { data: currentDroid, error: fetchError } = await supabase
      .from('droidz')
      .select('level, traits')
      .eq('token_id', targetId)
      .single();

    if (fetchError || !currentDroid) {
      throw new Error("Droid not found in database");
    }

    if (currentDroid.level >= 2) {
      return NextResponse.json({ error: "Droid is already Level 2 or higher!" }, { status: 400 });
    }

    // 3. ВЫЗОВ RPC (Пусть делает свою работу с картинками)
    const config = isSuperBattery ? UPGRADE_CONFIG.super : UPGRADE_CONFIG.standard;

    const { data: rpcData, error: rpcError } = await supabase.rpc('fission_upgrade_final', {
      target_token_id: targetId,
      new_img_base_url: config.ipfsBaseUrl,
      new_level_trait_value: config.levelTrait,
      new_background_trait_value: config.backgroundTrait
    });

    if (rpcError) {
      console.error("❌ [API] RPC Error:", rpcError.message);
      throw rpcError;
    }

    console.log(`📦 [API] RPC returned data:`, JSON.stringify(rpcData, null, 2));

    // === 4. САНИТАРНАЯ ОЧИСТКА ТРЕЙТОВ (FIX ДЛЯ ЛИШНИХ АТРИБУТОВ) ===
    // RPC вернула дроида с "грязными" трейтами (добавила upgrade level).
    // Мы берем эти трейты и вырезаем мусор перед финальной записью.

    let dirtyTraits = rpcData?.traits || currentDroid.traits || [];

    // Фильтр: удаляем всё, что похоже на старые уровни
    const cleanTraits = dirtyTraits.filter((t: any) => {
      if (!t) return false;
      const type = String(t.trait_type || "").toLowerCase().trim();
      const val = String(t.value || "").toLowerCase().trim();

      const bannedTypes = ['level', 'upgrade level', 'upgraded', 'rank', 'rank value'];
      const isBanned = bannedTypes.includes(type);
      const isEmpty = val === '' || val === 'null' || val === 'undefined';

      if (isBanned || isEmpty || val === 'temp_level') {
        console.log(`🗑️ [API] Removing trait: type='${type}', value='${val}'`);
        return false;
      }
      return true;
    });

    console.log(`🧹 [API] Cleaned traits (removed upgrade level):`, JSON.stringify(cleanTraits, null, 2));
    console.log(`🔋 [API] Setting is_super to: ${isSuperBattery}`);

    // === 5. FORCE UPDATE (ФИНАЛЬНАЯ ЗАПИСЬ) ===
    // Записываем:
    // 1. is_super (точно true/false)
    // 2. traits (очищенные, без мусора)
    // 3. level (явно 2)
    const { data: finalDroid, error: updateError } = await supabase
      .from('droidz')
      .update({
        level: 2,
        is_super: isSuperBattery,
        traits: cleanTraits
      })
      .eq('token_id', targetId)
      .select()
      .single();

    if (updateError) {
      console.error("❌ [API] Force Update failed:", updateError.message);
      throw new Error(`Failed to update droid: ${updateError.message}`);
    }

    // === 6. VERIFY THE UPDATE ===
    const { data: verifyDroid } = await supabase
      .from('droidz')
      .select('level, is_super, traits')
      .eq('token_id', targetId)
      .single();

    console.log(`✅ [API] VERIFIED in DB - Level: ${verifyDroid?.level}, is_super: ${verifyDroid?.is_super}`);

    if (verifyDroid?.is_super !== isSuperBattery) {
      console.error(`⚠️ [API] MISMATCH! Expected is_super=${isSuperBattery}, got is_super=${verifyDroid?.is_super}`);
    }

    console.log(`✅ [API] Success! Droid #${targetId} updated to Level 2 (Super: ${isSuperBattery})`);

    return NextResponse.json({
      updatedDroid: finalDroid,
      newLevel: finalDroid.level,
      newImage: finalDroid.image_url,
      isSuper: finalDroid.is_super
    });

  } catch (err: any) {
    console.error("🔥 [API] Critical Error:", err.message);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}