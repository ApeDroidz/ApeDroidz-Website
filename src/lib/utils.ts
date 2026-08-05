import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { batteryUrl, droidStaticUrl, droidAnimatedUrl } from "./media"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(dateParam: string | Date): string {
  if (!dateParam) return "";
  const date = typeof dateParam === 'string' ? new Date(dateParam) : dateParam;
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

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

/** token id out of an ipfs://<cid>/<id>.<ext> URL */
const tokenIdFromUrl = (url: string): string => {
  const filename = url.split('/').pop() || '';
  return filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
};

/**
 * Maps the ipfs:// URLs stored in the DB to the art actually served from
 * Cloudflare R2 (assets.apedroidz.com). Anything unknown falls through to a
 * public IPFS gateway, so third-party NFTs still resolve.
 */
export const resolveImageUrl = (url: string | undefined | null): string => {
  if (!url) return ''

  // === 1. ПОДМЕНА IPFS -> R2 ===

  // BATTERIES first: the new battery CID overlaps with the Level 2 CID space.
  const isBattery = url.includes(IPFS_CIDS.BATTERY_OLD) || url.includes(IPFS_CIDS.BATTERY_NEW);
  if (isBattery) {
    if (url.includes('standart_battery') || url.includes('standard_battery')) {
      return batteryUrl(false);
    }
    if (url.includes('super_battery')) {
      return batteryUrl(true);
    }
  }

  // LEVEL 1 -> static png
  if (url.includes(IPFS_CIDS.LEVEL1)) {
    return droidStaticUrl(tokenIdFromUrl(url), 1, false);
  }

  // Upgraded droids: the DB still points at the old animated .webp CIDs, which
  // on R2 are the GIF sets (standard = blue, super = orange).
  if (url.includes(IPFS_CIDS.LEVEL2)) {
    return droidAnimatedUrl(tokenIdFromUrl(url), false);
  }
  if (url.includes(IPFS_CIDS.SUPER)) {
    return droidAnimatedUrl(tokenIdFromUrl(url), true);
  }

  // === 2. ФОЛБЕКИ ===
  if (url.startsWith('http')) return url;

  // Cloudflare для всего остального (чужие NFT и т.д.)
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', 'https://cf-ipfs.com/ipfs/');
  }

  return url
}