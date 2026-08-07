// Content data for the landing page. Everything here is meant to be edited by
// hand — swap ids, add partners/team members, tune stats without touching the
// section components.

export const DROID_CONTRACT = "0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3"
export const HONORARY_CONTRACT = "0x427ff4b908c4ba7bc1d689bacac280a0435b2514"

/** OpenSea item page for a single token (chain slug `ape_chain`, as used elsewhere in the app). */
export const openseaItemUrl = (contract: string, tokenId: number | string) =>
  `https://opensea.io/item/ape_chain/${contract}/${tokenId}`

// Fixed samples of main-collection token ids (valid range 1..3333) for the PFP
// marquee rows. lvl_1_png art exists for every id.
export const MARQUEE_ROW_A = [17, 254, 389, 512, 730, 901, 1123, 1337, 1616, 1888, 2077, 2345, 2718, 3031, 145, 602, 1204, 1750, 2460, 2903]
export const MARQUEE_ROW_B = [42, 111, 333, 480, 666, 808, 1024, 1499, 1791, 2222, 2501, 2799, 3131, 3333, 268, 940, 1385, 1932, 2610, 3210]

export interface HonoraryEntry {
  id: number
  name: string
  /** owner's X profile, parsed from the token's metadata description */
  x?: string
}

// Every honorary that has art, with its owner's X handle. Generated from the
// honorary metadata; edit freely (names are display names, not handles).
export const HONORARIES: HonoraryEntry[] = [
  { id: 1, name: "Splitf0rm", x: "https://x.com/SPLITF0RM" },
  { id: 2, name: "Honorary", x: "https://x.com/ApeDroidz" },
  { id: 3, name: "Limbo", x: "https://x.com/purplehazedude" },
  { id: 4, name: "Benjamin", x: "https://x.com/ben1benjamin_" },
  { id: 5, name: "Voreio", x: "https://x.com/0xVoreio" },
  { id: 6, name: "AndreWGMI", x: "https://x.com/AndreWGMI" },
  { id: 7, name: "Pilot", x: "https://x.com/pilot3dm" },
  { id: 8, name: "Nature Origanal", x: "https://x.com/nature2333" },
  { id: 9, name: "Rida", x: "https://x.com/RidazLp2" },
  { id: 10, name: "VonDoom", x: "https://x.com/CryptoVonDoom" },
  { id: 11, name: "Shariq", x: "https://x.com/shariq_eth" },
  { id: 12, name: "Zubic", x: "https://x.com/zubic_eth" },
  { id: 13, name: "Jeremy.ape", x: "https://x.com/JW_DMD" },
  { id: 14, name: "Marlyy.eth", x: "https://x.com/Marly_Eth" },
  { id: 15, name: "Kelz.btc", x: "https://x.com/_CryptoKelz" },
  { id: 16, name: "RickyODonnell79", x: "https://x.com/RickyODonnell79" },
  { id: 17, name: "Ethdefiance.eth", x: "https://x.com/EthDeFiance" },
  { id: 18, name: "Fade", x: "https://x.com/NeverfadeKing" },
  { id: 19, name: "Caco Rocha", x: "https://x.com/CacoRocha_eth" },
  { id: 20, name: "RFDZI", x: "https://x.com/RFDZI" },
  { id: 21, name: "Smudger", x: "https://x.com/Smudger050483" },
  { id: 22, name: "Savage", x: "https://x.com/savagefks" },
  { id: 23, name: "Leonidas", x: "https://x.com/HurryToMurray" },
  { id: 24, name: "BaronVonHustle", x: "https://x.com/TheeHustleHouse" },
  { id: 25, name: "Joubrel", x: "https://x.com/iamMRJOUBREL" },
  { id: 26, name: "Peter Parker", x: "https://x.com/PeterParkerNFT" },
  { id: 27, name: "Spooky", x: "https://x.com/DaSpookyMan" },
  { id: 28, name: "Leo", x: "https://x.com/LEOgnarCRO" },
  { id: 29, name: "Zartash", x: "https://x.com/ZartashX" },
  { id: 30, name: "Killabeast", x: "https://x.com/killabeast_eth" },
  { id: 31, name: "IZZY", x: "https://x.com/thelgndryizzy" },
  { id: 32, name: "Skii.eth", x: "https://x.com/skiionwii" },
  { id: 33, name: "Brongis", x: "https://x.com/Brongis9163" },
  { id: 34, name: "Masterkraftsmen", x: "https://x.com/MasterKraftsmen" },
  { id: 35, name: "Hype", x: "https://x.com/morethenhype" },
  { id: 36, name: "CryptoGordoz", x: "https://x.com/samuelgord23180" },
  { id: 37, name: "MrNeff", x: "https://x.com/NefFTAdam" },
  { id: 38, name: "Frostyz", x: "https://x.com/CryptoFrostyz" },
  { id: 39, name: "ST.Roxas69md", x: "https://x.com/Roxas420Md" },
  { id: 40, name: "Yat Siu", x: "https://x.com/ysiu" },
  { id: 41, name: "BloozS19", x: "https://x.com/BloozS19" },
  { id: 42, name: "Sara", x: "https://x.com/Sara_NFTNinja" },
  { id: 43, name: "TikiTech", x: "https://x.com/tikitech_" },
  { id: 44, name: "JBL", x: "https://x.com/JBL20211" },
  { id: 45, name: "Staz", x: "https://x.com/Staz361" },
  { id: 46, name: "The Phoenix", x: "https://x.com/Biel" },
  { id: 47, name: "Imjameshall.eth", x: "https://x.com/imjameshall" },
  { id: 48, name: "Jross_topshot", x: "https://x.com/Jross_topshot" },
  { id: 49, name: "SauceBoss", x: "https://x.com/SauceBoss35" },
  { id: 50, name: "Bene", x: "https://x.com/bene_bla" },
  { id: 51, name: "MetaMatthew", x: "https://x.com/0xMetaMatthew" },
  { id: 52, name: "Darren Tey", x: "https://x.com/DarrenTeyGT" },
  { id: 53, name: "Gt_dog", x: "https://x.com/gt_dog84" },
  { id: 54, name: "Tko.thrill", x: "https://x.com/ThrillTko" },
  { id: 55, name: "ZombiE_Steve", x: "https://x.com/zombie_airmen" },
  { id: 56, name: "CHRONICDUMPER", x: "https://x.com/chronicdumper" },
  { id: 57, name: "MagnumPine", x: "https://x.com/MagnumPine" },
  { id: 58, name: "JAYISM1", x: "https://x.com/jayism1" },
  { id: 59, name: "Trenchers On Ape", x: "https://x.com/TrenchersOnApe" },
  { id: 60, name: "NFT Kid", x: "https://x.com/kokid951" },
  { id: 61, name: "Moe Spotligh", x: "https://x.com/Moe_HPO" },
  { id: 62, name: "Allo", x: "https://x.com/dev_allo" },
  { id: 63, name: "Ernest Lee", x: "https://x.com/ernestleedotcom" },
  { id: 64, name: "Moe", x: "https://x.com/Moe_HPO" },
  { id: 65, name: "BAKA", x: "https://x.com/prolifer4tion" },
  { id: 66, name: "Marly v2", x: "https://x.com/Marly_Eth" },
  { id: 67, name: "ReiNN", x: "https://x.com/randomDan28" },
  { id: 68, name: "Adam Weitsman", x: "https://x.com/AdamWeitsman" },
  { id: 69, name: "01Flow", x: "https://x.com/01FlowOS" },
  { id: 70, name: "JemP", x: "https://x.com/jemp_in_art" },
  { id: 71, name: "trenchcreek", x: "https://x.com/trenchcreek" },
  { id: 75, name: "Oliver", x: "https://x.com/oliver_pp" },
  { id: 76, name: "01Flow(2)", x: "https://x.com/01FlowOS" },
  { id: 78, name: "SSDW", x: "https://x.com/SSDsgnWrks" },
  { id: 79, name: "Vill", x: "https://x.com/silentium_eth" },
  { id: 80, name: "azbo", x: "https://x.com/azb_31" },
  { id: 81, name: "Norfilas.eth", x: "https://x.com/Norfilas" },
  { id: 82, name: "agrawas.eth", x: "https://x.com/agrawas_eth" },
  { id: 83, name: "ElLampo", x: "https://x.com/ellampoo" },
  { id: 84, name: "Nom de Plume", x: "https://x.com/N0md3plum" },
  { id: 85, name: "mjay", x: "https://x.com/mjay_cards" },
  { id: 86, name: "Dan", x: "https://x.com/Dan2DiamondHand" },]

export const HONORARY_OPENSEA_URL = "https://opensea.io/collection/apedroidz-honorary" // TODO: confirm slug

export interface Partner {
  name: string
  /** /public path of the logo */
  src: string
  url?: string
}

// EDIT ME: положи логотип в /public/partners и добавь строку.
export const PARTNERS: Partner[] = [
  { name: "ApeChain", src: "/Apechain.svg", url: "https://apechain.com" },
  { name: "Otherside", src: "/otherside.svg", url: "https://www.otherside.xyz" },
  { name: "ZeroBrand", src: "/partners/zerobrand.svg", url: "https://zerobrand.xyz/" },
  { name: "G's on Ape", src: "/partners/geezonape.png", url: "https://www.geezonape.com/" },
  { name: "Blever", src: "/partners/blever.svg", url: "https://app.blever.xyz/" },
  { name: "Zards", src: "/partners/zards.png", url: "http://zards.io/" },
  { name: "Sloooths", src: "/partners/sloooths.svg", url: "https://sloooths.com/" },
  { name: "JNKYZ", src: "/partners/jnkyz.png", url: "https://www.jnkyz.com/" },
  { name: "Night Glyders", src: "/partners/nightglyders.png", url: "https://www.nightglyders.com/" },
  { name: "Inceptive Studio", src: "/partners/inceptive.png", url: "https://inceptivestudio.com/" },
  { name: "Balloons", src: "/partners/balloons.png", url: "https://www.balloonsballoons.xyz/" },
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

export const OTHERSIDE_URL = "https://www.otherside.xyz"
