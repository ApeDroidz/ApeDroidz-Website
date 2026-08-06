// Content data for the landing page. Everything here is meant to be edited by
// hand — swap ids, add partners/team members, tune stats without touching the
// section components.

// Fixed samples of main-collection token ids (valid range 1..3333) for the two
// PFP marquee rows. lvl_1_png art exists for every id.
export const MARQUEE_ROW_A = [17, 254, 389, 512, 730, 901, 1123, 1337, 1616, 1888, 2077, 2345, 2718, 3031]
export const MARQUEE_ROW_B = [42, 111, 333, 480, 666, 808, 1024, 1499, 1791, 2222, 2501, 2799, 3131, 3333]

export interface HonoraryEntry {
  id: number
  name: string
}

// Curated honoraries for the landing marquee — only ids that have png art.
// Full list lives in Supabase `honorary_droidz` / R2 metadata.
export const HONORARIES: HonoraryEntry[] = [
  { id: 1, name: "Splitf0rm" },
  { id: 40, name: "Yat Siu" },
  { id: 68, name: "Adam Weitsman" },
  { id: 3, name: "Limbo" },
  { id: 6, name: "AndreWGMI" },
  { id: 9, name: "Rida" },
  { id: 10, name: "VonDoom" },
  { id: 13, name: "Jeremy.ape" },
  { id: 14, name: "Marlyy.eth" },
  { id: 20, name: "RFDZI" },
  { id: 23, name: "Leonidas" },
  { id: 26, name: "Peter Parker" },
  { id: 32, name: "Skii.eth" },
  { id: 36, name: "CryptoGordoz" },
  { id: 46, name: "The Phoenix" },
  { id: 51, name: "MetaMatthew" },
  { id: 52, name: "Darren Tey" },
  { id: 59, name: "Trenchers On Ape" },
  { id: 63, name: "Ernest Lee" },
  { id: 84, name: "Nom de Plume" },
]

export interface Partner {
  name: string
  /** /public path of the logo */
  src: string
  url?: string
}

// EDIT ME: drop a logo into /public and add a row.
export const PARTNERS: Partner[] = [
  { name: "ApeChain", src: "/Apechain.svg", url: "https://apechain.com" },
]

export interface Stat {
  value: number
  suffix?: string
  label: string
  /** overrides number formatting (e.g. chain id without thousands separator) */
  display?: string
}

// EDIT ME: placeholder set — final numbers/labels TBD.
export const STATS: Stat[] = [
  { value: 3333, label: "Droidz" },
  { value: 100, suffix: "%", label: "Animated" },
  { value: 100, label: "Honoraries" },
  { value: 33139, display: "33139", label: "ApeChain ID" },
]

export interface TeamMember {
  name: string
  role: string
  /** /public path or full URL; placeholder silhouette when omitted */
  avatar?: string
  url?: string
}

// EDIT ME: placeholder team — replace with real people.
export const TEAM: TeamMember[] = [
  { name: "SPLITF0RM", role: "Founder / Art", url: "https://x.com/SPLITF0RM" },
  { name: "TBA", role: "Development" },
  { name: "TBA", role: "Community" },
]

export interface PlayImage {
  src: string
  alt: string
  href?: string
}

// EDIT ME: картинки в блоке "Ready to the Other Side?" — пока баннеры игр,
// сюда же можно положить 3D-рендеры дроидов, когда будут готовы.
export const PLAY_IMAGES: PlayImage[] = [
  { src: "/images/glitch-cards-banner.jpg", alt: "Glitch Cards", href: "/glitch_games/cards" },
  { src: "/images/glitch-flight-banner.jpg", alt: "Glitch Flight", href: "/glitch_games/flight" },
]

export const OTHERSIDE_URL = "https://otherside.xyz"
// TODO: confirm the honorary collection slug on OpenSea.
export const HONORARY_OPENSEA_URL = "https://opensea.io/collection/apedroidz-honorary"
