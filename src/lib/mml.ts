// Сборка MML-аватара для Otherside.
//
// Otherside читает поле `mml` из метаданных NFT и ждёт документ с одним
// верхнеуровневым <m-character>; дочерние <m-model> добавляют части поверх.
// Все части обязаны сидеть на одном скелете UE5 — наши GLB собраны именно так
// (см. scripts/3d/README.md).
//
// Файл на токен ровно один, и он динамический: уровень дроида меняется после
// апгрейда, дальше появится гардероб с покупной одеждой. Статикой это не
// сделать — на assets.apedroidz.com стоит кэш на год, перезалитый файл ещё
// год отдавался бы старым.

const OBJECTS_BASE = `${(process.env.NEXT_PUBLIC_MEDIA_URL || 'https://assets.apedroidz.com').replace(/\/+$/, '')}/apedroidz/3D-objects`

// На assets.apedroidz.com стоит кэш на год, а права на его очистку у нашего
// токена нет. Поэтому версия живёт в адресе: заменили модели — подняли число,
// и CDN отдаёт новое, не дожидаясь протухания старого.
const ASSET_VERSION = '29'

// Под закрытой одеждой тело режется, иначе пластины корпуса лезут сквозь ткань:
// они жёстко привязаны к костям, а ткань сглажена, и на каждом сгибе поверхности
// расходятся. Дизайнер подготовил шесть вариантов обреза, каждый под свой крой.
// Всё, чего нет в таблице, носит обычное целое тело.
const BODY_VARIANT: Record<string, string> = {
  grey_long_sleeve: 'v1',
  apechain_hoodie: 'v1',
  black_hoodie: 'v1',
  red_shirt: 'v1',
  worker: 'v2',
  prisoner: 'v3',
  superhero: 'v3',
  white_robe: 'v4',
  ninja_suit: 'v4',
  sports_jacket: 'v4',
  blazer: 'v4',
  white_t_shirt: 'v5',
  dark_t_shirt: 'v5',
  "grandma's_sweater": 'v6',
  grandmas_sweater: 'v6',
}

/** Кроссовки: значения, из которых получаются имена файлов
 *  lmnt_snkrs_01.glb и lmnt_super_snkrs_01.glb. */
const SHOE = '"LMNT" Snkrs_01'
const SHOE_SUPER = '"LMNT_SUPER" Snkrs_01'

/** Слои-дети m-character, в порядке появления в документе. */
const CHILD_LAYERS = ['clothes', 'shoes', 'eyes', 'mouth', 'hat'] as const
type ChildLayer = typeof CHILD_LAYERS[number]

/** Имя файла из значения трейта: кавычки выкидываем, пробел в подчёркивание.
 *  Правило продублировано в scripts/3d/export_traits.py и build_previews.mjs —
 *  менять только во всех трёх местах сразу. */
const slug = (value: string): string =>
  value.replace(/['"]/g, '').replace(/ /g, '_').toLowerCase()

const partUrl = (layer: string, value: string): string =>
  `${OBJECTS_BASE}/${layer}/${slug(value)}.glb?v=${ASSET_VERSION}`

export type MmlInput = {
  /** Трейты токена: {body: 'iron', hat: 'toaster', …}. */
  traits: Record<string, string>
  level: number
  isSuper: boolean
  /** Будущий гардероб: перекрывает трейт на слое (значение) либо снимает его (null).
   *  Пока никем не передаётся — ручка оставлена, чтобы покупная одежда легла
   *  сюда без переписывания сборки. */
  equipped?: Partial<Record<ChildLayer, string | null>>
}

/**
 * Возвращает готовый MML-документ. Бросает, если у токена нет body —
 * без тела m-character собирать не из чего.
 */
export function buildDroidMml({ traits, level, isSuper, equipped = {} }: MmlInput): string {
  const body = traits.body
  if (!body) throw new Error('у токена нет трейта body')

  const children: string[] = []
  for (const layer of CHILD_LAYERS) {
    // Кроссовки — не трейт из метаданных, они следствие уровня: level 1 без них,
    // level 2 в LMNT, level 2 SUPER в LMNT_SUPER.
    const fromLevel = layer === 'shoes'
      ? (level >= 2 ? (isSuper ? SHOE_SUPER : SHOE) : null)
      : (traits[layer] ?? null)

    const value = layer in equipped ? equipped[layer] ?? null : fromLevel
    if (value) children.push(`  <m-model src="${partUrl(layer, value)}"></m-model>`)
  }

  // Тело выбирается по надетой вещи: <скин>__v3.glb вместо <скин>.glb.
  const worn = 'clothes' in equipped ? equipped.clothes : traits.clothes
  // Ищем и по исходному значению трейта, и по slug: у свитера в метаданных
  // апостроф, а в именах файлов его нет — на этом легко разъехаться.
  const variant = worn ? (BODY_VARIANT[worn] ?? BODY_VARIANT[slug(worn)]) : undefined
  const bodyFile = variant ? `${slug(body)}__${variant}` : slug(body)
  const bodySrc = `${OBJECTS_BASE}/body/${bodyFile}.glb?v=${ASSET_VERSION}`

  return `<m-character src="${bodySrc}">\n${children.join('\n')}\n</m-character>\n`
}
