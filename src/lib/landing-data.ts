// Content data for the landing page. Everything here is meant to be edited by
// hand — swap ids, add partners/team members, tune stats without touching the
// section components.

export const DROID_CONTRACT = "0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3"
export const HONORARY_CONTRACT = "0x427ff4b908c4ba7bc1d689bacac280a0435b2514"

/** OpenSea item page for a single token (chain slug `ape_chain`, as used elsewhere in the app). */
export const openseaItemUrl = (contract: string, tokenId: number | string) =>
  `https://opensea.io/item/ape_chain/${contract}/${tokenId}`

export interface MarqueeDroid {
  id: number
  /** SUPER-рендер лежит в отдельном наборе и имеет оранжевый фон */
  super: boolean
}

// EDIT ME: подборка для ленты. Все показываем как LVL 2 (обычный, синий фон) —
// на сами NFT это не влияет, это только визуальная унификация лендинга.
// Порядок подобран так, чтобы у соседей не совпадали шляпа/одежда.
export const MARQUEE_ROW_A: MarqueeDroid[] = [
  { id: 2585, super: false },
  { id: 2548, super: false },
  { id: 353, super: false },
  { id: 2583, super: false },
  { id: 23, super: false },
  { id: 3204, super: false },
  { id: 1900, super: false },
  { id: 833, super: false },
  { id: 1909, super: false },
  { id: 2, super: false },
  { id: 1816, super: false },
  { id: 2742, super: false },
  { id: 2783, super: false },
  { id: 2322, super: false },
  { id: 3276, super: false },
  { id: 27, super: false },
  { id: 716, super: false },
  { id: 728, super: false },
]

export const MARQUEE_ROW_B: MarqueeDroid[] = [
  { id: 672, super: false },
  { id: 1038, super: false },
  { id: 1890, super: false },
  { id: 873, super: false },
  { id: 2778, super: false },
  { id: 1984, super: false },
  { id: 857, super: false },
  { id: 2984, super: false },
  { id: 3, super: false },
  { id: 1249, super: false },
  { id: 439, super: false },
  { id: 77, super: false },
  { id: 685, super: false },
  { id: 2701, super: false },
  { id: 1, super: false },
  { id: 841, super: false },
  { id: 4, super: false },
  { id: 2448, super: false },
]

export interface HonoraryEntry {
  id: number
  name: string
  /** owner's X profile, parsed from the token's metadata description */
  x?: string
}

// Every honorary that has art, with its owner's X handle. Generated from the
// honorary metadata; edit freely (names are display names, not handles).
export const HONORARIES: HonoraryEntry[] = [
  { id: 68, name: "Adam Weitsman", x: "https://x.com/AdamWeitsman" },
  { id: 35, name: "Hype", x: "https://x.com/morethenhype" },
  { id: 20, name: "RFDZI", x: "https://x.com/RFDZI" },
  { id: 63, name: "Ernest Lee", x: "https://x.com/ernestleedotcom" },
  { id: 47, name: "Imjameshall.eth", x: "https://x.com/imjameshall" },
  { id: 24, name: "BaronVonHustle", x: "https://x.com/TheeHustleHouse" },
  { id: 26, name: "Peter Parker", x: "https://x.com/PeterParkerNFT" },
  { id: 9, name: "Rida", x: "https://x.com/RidazLp2" },
  { id: 1, name: "Splitf0rm", x: "https://x.com/SPLITF0RM" },
  { id: 18, name: "Fade", x: "https://x.com/NeverfadeKing" },
  { id: 38, name: "Frostyz", x: "https://x.com/CryptoFrostyz" },
  { id: 58, name: "JAYISM1", x: "https://x.com/jayism1" },
  { id: 65, name: "BAKA", x: "https://x.com/prolifer4tion" },
  { id: 83, name: "ElLampo", x: "https://x.com/ellampoo" },
  { id: 81, name: "Norfilas.eth", x: "https://x.com/Norfilas" },
  { id: 25, name: "Joubrel", x: "https://x.com/iamMRJOUBREL" },
  { id: 62, name: "Allo", x: "https://x.com/dev_allo" },
  { id: 82, name: "agrawas.eth", x: "https://x.com/agrawas_eth" },
  { id: 85, name: "mjay", x: "https://x.com/mjay_cards" },
  { id: 41, name: "BloozS19", x: "https://x.com/BloozS19" },
  { id: 22, name: "Savage", x: "https://x.com/savagefks" },
  { id: 10, name: "VonDoom", x: "https://x.com/CryptoVonDoom" },
  { id: 48, name: "Jross_topshot", x: "https://x.com/Jross_topshot" },
  { id: 33, name: "Brongis", x: "https://x.com/Brongis9163" },
  { id: 17, name: "Ethdefiance.eth", x: "https://x.com/EthDeFiance" },
  { id: 51, name: "MetaMatthew", x: "https://x.com/0xMetaMatthew" },
  { id: 6, name: "AndreWGMI", x: "https://x.com/AndreWGMI" },
  { id: 34, name: "Masterkraftsmen", x: "https://x.com/MasterKraftsmen" },
  { id: 12, name: "Zubic", x: "https://x.com/zubic_eth" },
  { id: 52, name: "Darren Tey", x: "https://x.com/DarrenTeyGT" },
  { id: 5, name: "Voreio", x: "https://x.com/0xVoreio" },
  { id: 53, name: "Gt_dog", x: "https://x.com/gt_dog84" },
  { id: 31, name: "IZZY", x: "https://x.com/thelgndryizzy" },
  { id: 28, name: "Leo", x: "https://x.com/LEOgnarCRO" },
  { id: 71, name: "trenchcreek", x: "https://x.com/trenchcreek" },
  { id: 23, name: "Leonidas", x: "https://x.com/HurryToMurray" },
]

export const HONORARY_OPENSEA_URL = "https://opensea.io/collection/apedroidz-honorary" // TODO: confirm slug

export interface Partner {
  name: string
  /** /public path of the logo */
  src: string
  url?: string
  /** визуальный вес: множитель к базовой высоте (логотипы очень разные) */
  scale?: number
}

// EDIT ME: положи логотип в /public/partners и добавь строку.
export const PARTNERS: Partner[] = [
  { scale: 1.0, name: "ApeChain", src: "/Apechain.svg", url: "https://apechain.com" },
  { scale: 0.98, name: "Otherside", src: "/otherside.svg", url: "https://www.otherside.xyz" },
  { scale: 0.93, name: "ZeroBrand", src: "/partners/zerobrand.svg", url: "https://zerobrand.xyz/" },
  { scale: 1.5, name: "G's on Ape", src: "/partners/geezonape.png", url: "https://www.geezonape.com/" },
  { scale: 1.0, name: "Blever", src: "/partners/blever.svg", url: "https://app.blever.xyz/" },
  { scale: 1.25, name: "Zards", src: "/partners/zards.png", url: "http://zards.io/" },
  { scale: 1.1, name: "Sloooths", src: "/partners/sloooths.svg", url: "https://sloooths.com/" },
  { scale: 0.95, name: "JNKYZ", src: "/partners/jnkyz.png", url: "https://www.jnkyz.com/" },
  { scale: 2.59, name: "Night Glyders", src: "/partners/nightglyders.png", url: "https://www.nightglyders.com/" },
  { scale: 1.2, name: "Inceptive Studio", src: "/partners/inceptive.png", url: "https://inceptivestudio.com/" },
  { scale: 1.15, name: "Balloons", src: "/partners/balloons.png", url: "https://www.balloonsballoons.xyz/" },
  // TODO: у gobs.land и designertoshiro.com на сайте нет пригодного логотипа —
  // добавь файлы вручную, если пришлют.
]

export interface Stat {
  value: number
  suffix?: string
  label: string
  /** short line under the label; optional */
  hint?: string
  /** overrides number formatting (e.g. chain id without thousands separator) */
  display?: string
}

// EDIT ME: цифры коллекции. Total Volume и ATH подставь руками из OpenSea —
// публичного API без ключа у них нет, а страница рисует значения на клиенте.
export const STATS: Stat[] = [
  { value: 0, display: "—", label: "Total Volume", hint: "APE · all time" },
  { value: 0, display: "—", label: "ATH", hint: "APE · peak sale" },
  { value: 100, suffix: "%", label: "Animated", hint: "Every trait, every level" },
  { value: 500, suffix: "+", label: "Holders", hint: "Unique owners" },
]

export interface Creator {
  name: string
  role: string
  /** аватар-PFP (полный URL или /public путь) */
  avatar?: string
  /** /public путь к логотипу; если пусто — печатается имя */
  logo?: string
  note?: string
  url?: string
}

// EDIT ME: кто сделал коллекцию.
export const CREATORS: Creator[] = [
  {
    name: "SPLITF0RM",
    role: "Art & Direction",
    avatar: "https://assets.apedroidz.com/apedroidz_honorary/png/1.png",
    note: "Droid design, 3D and the look of everything you just scrolled through.",
    url: "https://x.com/SPLITF0RM",
  },
  {
    name: "ZeroBrand",
    role: "Studio & Development",
    logo: "/partners/zerobrand-powered.svg",
    note: "Product, contracts and the machines behind the Droidz Network.",
    url: "https://zerobrand.xyz/",
  },
]

export const OTHERSIDE_URL = "https://www.otherside.xyz"
