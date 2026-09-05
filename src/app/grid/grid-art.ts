// Общая логика грид-тула: какую картинку дроид кладёт в ячейку, какой у грида
// фон и как раскладываются лого в подвале. Живёт в одном месте, потому что
// превью (visual-grid) и выгрузка (grid-download-button) обязаны рисовать одно
// и то же — иначе скачанный файл не совпадает с тем, что человек видел.

import { NFTItem } from "@/app/upgrade_module/page"
import { droidAnimatedUrl, droid3dPfpUrl, honoraryAnimatedUrl } from "@/lib/media"
import { resolveImageUrl } from "@/lib/utils"

export const BLUE_BG = '#0247AF'
export const ORANGE_BG = '#FF6C00'
// Под 3D-бюстами грид тёмный: у рендера свой градиентный фон, и плоский синий
// вокруг него смотрится как чужая рамка. Тот же тон, что у карточек сайта.
export const DARK_BG = '#0a0a0a'

/** Вид одного дроида — то, чем он показан в кошельке и на маркетплейсах. */
export type GridView = 'pixel' | 'animated' | 'pfp3d'

/** Стиль всего грида, тот же выбор, что в дашборде. `standard` — у каждого
 *  дроида его собственный сохранённый вид; остальные перекрашивают грид
 *  целиком, ничего не сохраняя. */
export type GridStyle = 'standard' | 'pfp3d' | 'pixel' | 'animated' | 'fullbody'

export const GRID_STYLE_OPTIONS: { label: string; value: GridStyle; locked?: boolean }[] = [
    { label: 'Standard style', value: 'standard' },
    { label: '3D PFP', value: 'pfp3d' },
    { label: 'Pixel', value: 'pixel' },
    { label: 'Animated', value: 'animated' },
    // Рендеров в полный рост ещё нет — пункт виден, но заперт, как в дашборде.
    { label: 'Full Body', value: 'fullbody', locked: true },
]

export const isSuper = (item: NFTItem): boolean => {
    return (item.batteryType === 'Super') || !!item.metadata?.attributes?.some((a: any) =>
        (a.trait_type === "upgrade level" && a.value?.toLowerCase().includes("super")) ||
        (a.trait_type === "background" && a.value === "apechain_orange")
    )
}

/** Анимация есть только у второго уровня, а у honorary — только у токенов,
 *  которым её реально нарисовали. */
export const canAnimate = (item: NFTItem): boolean =>
    item.isHonorary ? !!item.metadata?.has_gif : (item.level || 1) >= 2

/** Есть ли у дроида арт выбранного стиля. Это и фильтр списка: показываем
 *  только тех, кто реально нарисован так, как просят, — иначе часть грида
 *  молча уезжала бы в другой вид. У honorary своего 3D нет, у первого уровня
 *  нет анимации. */
export const supportsStyle = (item: NFTItem, style: GridStyle): boolean => {
    if (style === 'pfp3d') return !item.isHonorary
    if (style === 'animated') return canAnimate(item)
    return true
}

/** Вид, сохранённый холдером (или дефолт коллекции) — его отдаёт API. */
const savedView = (item: NFTItem): GridView => {
    const dv = item.metadata?.display_view
    if (dv === 'animated' || dv === 'pfp3d' || dv === 'pixel') return dv
    // Поля нет (старый ответ API) — прежнее поведение: пиксель.
    return 'pixel'
}

/** Вид дроида с учётом выбранного стиля грида. Стиль, которого у токена нет
 *  (3D у honorary, анимация у первого уровня), откатывается на сохранённый —
 *  так же, как это делает дашборд. */
export const getView = (item: NFTItem, style: GridStyle = 'standard'): GridView => {
    const saved = savedView(item)
    if (style === 'pixel') return 'pixel'
    if (style === 'pfp3d') return item.isHonorary ? saved : 'pfp3d'
    if (style === 'animated') return canAnimate(item) ? 'animated' : saved
    // standard и заблокированный fullbody — как сохранено у дроида.
    return saved
}

export const is3d = (item: NFTItem, style: GridStyle = 'standard'): boolean =>
    getView(item, style) === 'pfp3d'

/** GIF для ячейки — только если дроид в этом стиле реально анимирован. */
export const getAnimatedUrl = (item: NFTItem, style: GridStyle = 'standard'): string | null => {
    if (getView(item, style) !== 'animated') return null
    const tokenId = item.tokenId || item.id

    // Honorary — отдельная коллекция со своим артом: уровней нет, файлы названы
    // по номеру арта, а не токена, поэтому путь из tokenId отдаёт 404. Берём
    // URL, который вернул API.
    if (item.isHonorary) {
        if (!item.metadata?.has_gif) return null
        return item.metadata?.image_animated || honoraryAnimatedUrl(tokenId)
    }

    if ((item.level || 1) < 2) return null
    return droidAnimatedUrl(tokenId, isSuper(item))
}

/** Картинка ячейки: 512px превью бюста, пиксельная статика или анимированный
 *  webp — смотря какой вид у дроида в этом стиле. */
export const getStillUrl = (item: NFTItem, style: GridStyle = 'standard'): string => {
    const m = item.metadata || {}
    const view = getView(item, style)
    const variant = view === 'pfp3d' ? m.image_3d
        : view === 'animated' ? m.image_animated
            : m.image_pixel
    return resolveImageUrl(variant || item.image)
}

/** Пиксельная статика — последний запасной вариант, когда не грузится ничего. */
export const getPixelUrl = (item: NFTItem): string =>
    resolveImageUrl(item.metadata?.image_pixel || item.image)

/** Для выгрузки бюста: 512px превью хватает, пока ячейка не крупнее него.
 *  В сетке 2×N ячейка 600px — там берём полный 2048px рендер. */
export const get3dDownloadUrl = (item: NFTItem, cellSize: number): string => {
    if (cellSize <= 512) return getStillUrl(item, 'pfp3d')
    return droid3dPfpUrl(item.tokenId || item.id, item.level || 1, isSuper(item))
}

/** Фон грида. Большинство бюстов — тёмный; большинство SUPER — оранжевый;
 *  иначе синий. Правило «больше половины» одно для обоих случаев. */
export const gridBackground = (droids: NFTItem[], style: GridStyle = 'standard'): string => {
    if (droids.length === 0) return BLUE_BG
    const half = droids.length / 2
    if (droids.filter(d => is3d(d, style)).length > half) return DARK_BG
    if (droids.filter(isSuper).length > half) return ORANGE_BG
    return BLUE_BG
}

// Оптимальная сетка для N элементов (минимум 2)
export const calculateGridDimensions = (count: number): { cols: number; rows: number } => {
    if (count < 2) return { cols: 2, rows: 1 }
    if (count === 2) return { cols: 2, rows: 1 }
    if (count === 3) return { cols: 3, rows: 1 }
    if (count === 4) return { cols: 2, rows: 2 }
    if (count === 5) return { cols: 3, rows: 2 }
    if (count === 6) return { cols: 3, rows: 2 }
    if (count <= 9) return { cols: 3, rows: 3 }
    if (count <= 12) return { cols: 4, rows: 3 }
    if (count <= 16) return { cols: 4, rows: 4 }
    if (count <= 20) return { cols: 5, rows: 4 }
    if (count <= 25) return { cols: 5, rows: 5 }

    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    return { cols, rows }
}

// ── Подвал грида ─────────────────────────────────────────────────────────────

/** `ratio` — ширина/высота файла, `scale` — оптическая поправка: у лого разная
 *  доля текста в высоте, и при одинаковой высоте рамки они читаются как разные
 *  по размеру. Значения подобраны по рендеру всей полосы вместе. */
export type FooterLogo = { src: string; alt: string; ratio: number; scale: number }

export const FOOTER_LOGOS: FooterLogo[] = [
    { src: '/lmnt.svg', alt: 'LMNT', ratio: 5.58, scale: 1.12 },
    { src: '/Apechain.svg', alt: 'ApeChain', ratio: 3.05, scale: 1.00 },
    { src: '/otherside.svg', alt: 'Otherside', ratio: 4.89, scale: 0.80 },
    { src: '/full-logo.svg', alt: 'ApeDroidz', ratio: 3.23, scale: 1.30 },
    { src: '/zerobrand.svg', alt: 'ZeroBrand', ratio: 5.28, scale: 0.85 },
]

export type FooterLogoBox = FooterLogo & { width: number; height: number }

/** Раскладка подвала: пять лого в один ряд по центру. Высота считается от
 *  высоты подвала, а если ряд не влезает по ширине — высота и промежутки
 *  ужимаются пропорционально. Одна математика на превью и на выгрузку. */
export const layoutFooterLogos = (
    width: number,
    height: number,
): { items: FooterLogoBox[]; gap: number; rowWidth: number; startX: number } => {
    const widthOf = (logo: FooterLogo, h: number) => logo.ratio * h * logo.scale
    const rowWidthAt = (h: number, gap: number) =>
        FOOTER_LOGOS.reduce((sum, l) => sum + widthOf(l, h), 0) + gap * (FOOTER_LOGOS.length - 1)

    let h = Math.min(height * 0.26, 46)
    // Промежуток намеренно крупный: лого партнёров не должны читаться одним
    // слипшимся блоком. Ряд всё равно ужимается под ширину ниже.
    let gap = Math.min(width * 0.09, h * 2.55)

    // Ряд линеен по (h, gap), поэтому один коэффициент ужимает и то и другое.
    const maxWidth = width * 0.94
    const full = rowWidthAt(h, gap)
    if (full > maxWidth) {
        const k = maxWidth / full
        h *= k
        gap *= k
    }

    const items: FooterLogoBox[] = FOOTER_LOGOS.map((logo) => ({
        ...logo,
        width: widthOf(logo, h),
        height: h * logo.scale,
    }))
    const rowWidth = items.reduce((sum, i) => sum + i.width, 0) + gap * (items.length - 1)

    return { items, gap, rowWidth, startX: (width - rowWidth) / 2 }
}
