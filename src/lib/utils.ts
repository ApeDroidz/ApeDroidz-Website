import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// === КОНФИГУРАЦИЯ SUPABASE STORAGE ===
const SUPABASE_PROJECT_URL = "https://jpbalgwwwalofynoaavv.supabase.co";

// Хеши IPFS для всех уровней
const IPFS_CIDS = {
  // CID 1-го уровня (из твоей базы)
  LEVEL1: 'bafybeid3wb62bra43ncydhyzfp6jcrlbdoybp6rqdreuvqnugodncpw5ga',
  // CID 2-го уровня (Standard)
  LEVEL2: 'bafybeicp25ylfrxcvnzve2rnvuxmggajorbvvu47ws27tiybhui5dgtip4',
  // CID 2-го уровня (Super)
  SUPER: 'bafybeicsk4upnt4jvmx3w37vcurti4pszgeqpr3s77gc74q5wdyqw6ay6m',
  // Battery CIDs
  BATTERY_OLD: 'bafybeihs3psxvupwu3q5sruem6bzv5gikhljq4mju5dzelgrguplgk44fa',
  BATTERY_NEW: 'bafybeid4d4yfoljgoqkbwzv7lk6trdsivanfeuziq7w5m2ogsgmlra7aiy'
}

export const resolveImageUrl = (url: string | undefined | null): string => {
  if (!url) return ''

  // === 1. ГИБРИДНАЯ ПОДМЕНА (IPFS -> SUPABASE) ===

  // Если это LEVEL 1 -> папка level1
  // === BATTERIES (Fix for Dashboard) ===
  // Move BEFORE Level checks because Battery New CID overlaps with Level 2 CID
  const isBattery = url.includes(IPFS_CIDS.BATTERY_OLD) || url.includes(IPFS_CIDS.BATTERY_NEW);
  if (isBattery) {
    if (url.includes('standart_battery') || url.includes('standard_battery')) {
      return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/batteries/standart_battery.webp`;
    }
    if (url.includes('super_battery')) {
      return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/batteries/super_battery.webp`;
    }
  }

  // === 1. ГИБРИДНАЯ ПОДМЕНА (IPFS -> SUPABASE) ===

  // Если это LEVEL 1 -> папка level1
  if (url.includes(IPFS_CIDS.LEVEL1)) {
    let filename = url.split('/').pop() || '';
    // Если расширения нет -> добавляем .png, так как файлы в Supabase — это PNG
    if (!filename.toLowerCase().endsWith('.png')) {
      filename += '.png';
    }
    return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/level1/${filename}`;
  }

  // Если это Standard Upgrade (Level 2) -> папка level2
  if (url.includes(IPFS_CIDS.LEVEL2)) {
    const filename = url.split('/').pop() || '';
    // Force .webp extension for Level 2 (always webp in DB)
    const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/level2/${baseName}.webp`;
  }

  // Если это Super Upgrade -> папка super
  if (url.includes(IPFS_CIDS.SUPER)) {
    const filename = url.split('/').pop() || '';
    // Force .webp extension for Super (always webp in DB)
    const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/super/${baseName}.webp`;
  }



  // === 2. ФОЛБЕКИ ===
  if (url.startsWith('http')) return url;

  // Cloudflare для всего остального (чужие NFT и т.д.)
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', 'https://cf-ipfs.com/ipfs/');
  }

  return url
}