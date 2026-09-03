// Реестр предметов LMNT™ by ApeDroidz — коллекция ERC-1155, живущая в инвентарях
// дроидов (ERC-6551). Один файл на весь каталог: метаданные, картинки и модели
// берутся отсюда, чтобы контракт, API и сайт не расходились в том, что такое
// предмет №1.
//
// Раскладка на R2 (бакет apedroidz). Папка LMNT лежит на одном уровне с apedroidz,
// внутри папка на дроп, внутри неё папка на вещь:
//   LMNT/<drop>/<item>/image.webp      2048px, поле image в метаданных
//   LMNT/<drop>/<item>/preview.webp    512px, сетка инвентаря
//
// 3D-модели вещей НЕ дублируются сюда. Они уже лежат в apedroidz/3D-objects/<layer>/
// и оттуда же их берёт сборка MML-аватара (src/lib/mml.ts). Один файл — один адрес,
// иначе после первой же переделки модели аватар и инвентарь покажут разное.

import { MEDIA_BASE, SITE_BASE } from './media'

// На зоне assets.apedroidz.com стоит кэш на год, а прав на его очистку у нашего
// токена нет. Поэтому версия живёт в адресе: перерисовали вещь — подняли число,
// и CDN вместе с маркетплейсами увидят новую картинку, не дожидаясь года.
// Тот же приём и по той же причине применён в src/lib/mml.ts.
const ASSET_VERSION = '1'

const LMNT_BASE = `${MEDIA_BASE}/LMNT`
const OBJECTS_BASE = `${MEDIA_BASE}/apedroidz/3D-objects`

/** Слой аватара, на который вещь надевается. Совпадает с CHILD_LAYERS в mml.ts. */
export type LmntLayer = 'clothes' | 'shoes' | 'eyes' | 'mouth' | 'hat'

export type LmntItem = {
  /** id токена в контракте LMNT1155. Задаётся при createItem и больше не меняется. */
  id: number
  /** Папка дропа на R2 и человеческое имя серии. */
  drop: string
  dropName: string
  /** Папка вещи внутри дропа. */
  slug: string
  name: string
  description: string
  /** Слой аватара и значение трейта на нём — то же имя, что у файла GLB. */
  layer: LmntLayer
  glb: string
  /** Дополнительные трейты в метаданных, помимо вычисляемых. */
  traits: Array<{ trait_type: string; value: string }>
  /** Привязана ли вещь к дроиду навсегда (в контракте: transferable = false). */
  bound: boolean
  /** Выдаётся ровно один раз на дроида (в контракте: perDroid = true). */
  perDroid: boolean
}

// ── Дроп 01 — SNKRS ────────────────────────────────────────────────────────────
// Кроссовки за апгрейд дроида. Это первый дроп LMNT и единственный, который
// раздаётся ретроспективно: их получают все, кто уже дошёл до уровня 2.
//
// Обычные и супер — разные вещи, а не варианты одной: у них разные модели,
// разный тираж и разное условие получения (тип сожжённой батарейки).

const SNKRS_01 = { drop: 'snkrs_01', dropName: 'SNKRS 01' } as const

export const LMNT_ITEMS: Record<number, LmntItem> = {
  1: {
    ...SNKRS_01,
    id: 1,
    slug: 'element',
    name: 'ELEMENT',
    description:
      'The first thing a droid earns. ELEMENT sneakers are handed to every ApeDroid that reaches level 2, and they stay with the droid — not with the wallet that upgraded it.',
    layer: 'shoes',
    glb: `${OBJECTS_BASE}/shoes/element.glb`,
    traits: [
      { trait_type: 'Drop', value: 'SNKRS 01' },
      { trait_type: 'Slot', value: 'Shoes' },
      { trait_type: 'Edition', value: 'Standard' },
      { trait_type: 'Source', value: 'Level 2 Upgrade' },
    ],
    bound: true,
    perDroid: true,
  },
  2: {
    ...SNKRS_01,
    id: 2,
    slug: 'element_super',
    name: 'ELEMENT SUPER',
    description:
      'The super edition of the first drop, earned only by droids upgraded with a Super Battery. Bound to the droid it was earned by.',
    layer: 'shoes',
    glb: `${OBJECTS_BASE}/shoes/element_super.glb`,
    traits: [
      { trait_type: 'Drop', value: 'SNKRS 01' },
      { trait_type: 'Slot', value: 'Shoes' },
      { trait_type: 'Edition', value: 'Super' },
      { trait_type: 'Source', value: 'Level 2 SUPER Upgrade' },
    ],
    bound: true,
    perDroid: true,
  },
}

export const lmntItem = (id: number): LmntItem | null => LMNT_ITEMS[id] ?? null

/** Картинка вещи: LMNT/<drop>/<item>/image.webp */
export const lmntImageUrl = (item: LmntItem): string =>
  `${LMNT_BASE}/${item.drop}/${item.slug}/image.webp?v=${ASSET_VERSION}`

/** Квадратное превью под сетку инвентаря. */
export const lmntPreviewUrl = (item: LmntItem): string =>
  `${LMNT_BASE}/${item.drop}/${item.slug}/preview.webp?v=${ASSET_VERSION}`

/**
 * Метаданные предмета в форме, которую ждут маркетплейсы.
 *
 * Трейт Transfer проставляется здесь, а не в контракте: маркетплейсы не умеют
 * читать непередаваемость ERC-1155 заранее, и единственное место, где мы можем
 * сказать это человеку до того, как он попробует продать вещь, — карточка.
 */
export const buildLmntMetadata = (item: LmntItem) => ({
  name: item.name,
  description: item.description,
  image: lmntImageUrl(item),
  external_url: `${SITE_BASE}/dashboard`,
  attributes: [
    ...item.traits,
    { trait_type: 'Transfer', value: item.bound ? 'Bound to droid' : 'Tradable' },
    { trait_type: 'Supply', value: item.perDroid ? 'One per droid' : 'Open' },
  ],
})
