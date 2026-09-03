"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUpRight } from "lucide-react"
import { droidAnimatedWebpUrl, droid3dPfpThumbUrl } from "@/lib/media"
import { DROID_CONTRACT, MARQUEE_ROW_A, MARQUEE_ROW_B, MarqueeDroid, openseaItemUrl } from "@/lib/landing-data"
import { OPENSEA_COLLECTION_URL } from "@/lib/socials"
import { Marquee } from "./marquee"
import { LABEL_CLASS, SECONDARY_BTN, Reveal } from "./ui"

function DroidCard({ droid, awake }: { droid: MarqueeDroid; awake: boolean }) {
  const { id } = droid
  // Карточка стоит на 3D-рендере, пиксельная анимация лежит поверх и
  // проявляется по наведению. Обе картинки грузятся сразу: 3D-превью 512px —
  // ~18 КБ, анимированный webp — ~4 КБ, так что подмена мгновенная и без
  // мигания, а догрузка по ховеру дала бы паузу ровно в момент интереса.
  // 3D всегда на синем фоне, каким бы ни был сам токен.
  // ?v=1 — часть превью успели запросить, пока заливка в R2 ещё шла, и
  // Cloudflare закэшировал 404 на год (Cache Rule ставит TTL 31536000 любому
  // ответу). Пока кэш зоны не почищен, метка даёт другой ключ кэша.
  return (
    <a
      href={openseaItemUrl(DROID_CONTRACT, id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`ApeDroid #${id} on OpenSea`}
      data-droid-id={id}
      className="group relative w-40 md:w-56 shrink-0 rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden hover:border-white/40 transition-colors duration-300"
    >
      <div className="relative w-full aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${droid3dPfpThumbUrl(id, 1, false)}?v=1`}
          alt={`ApeDroid #${id} in 3D`}
          width={224}
          height={224}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover select-none"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={droidAnimatedWebpUrl(id, droid.super)}
          alt=""
          aria-hidden="true"
          width={224}
          height={224}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`absolute inset-0 w-full h-full object-cover select-none group-hover:opacity-100 transition-opacity duration-200 ${awake ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2.5 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <span className="font-mono text-xs text-white/80">#{id}</span>
        <ArrowUpRight size={14} className="text-white icon-dim-80" />
      </div>
    </a>
  )
}

// Пиксельный цикл длится ~760 мс — 3.2 с это примерно четыре оборота.
const AWAKE_MS = 3200
const PAUSE_MS = 900

/** Отступ от краёв окна, внутри которого карточку можно «будить».
 *  Лента едет ~120 px/с, за показ карточка проезжает ~380 px — с таким запасом
 *  она не успевает уехать под обрез экрана, пока идёт анимация.
 *  На узких экранах отступ ужимается, иначе кандидатов не остаётся вовсе. */
const edgePad = (width: number) => Math.min(400, width * 0.18)

export function CollectionSection() {
  // Раз в несколько секунд один случайный дроид сам показывает свою пиксельную
  // анимацию и гаснет обратно. Без этого лента читается как статичная галерея и
  // навести курсор никто не догадывается.
  const [awake, setAwake] = useState<number | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    // Кандидатов выбираем по реальному положению карточек, а не по списку:
    // «оживший» дроид на самом краю экрана виден наполовину и читается как
    // артефакт, а не как подсказка. Заодно отсекаются строки вне экрана.
    const pick = (): number | null => {
      const root = rowsRef.current
      if (!root) return null
      const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-droid-id]"))
      const w = window.innerWidth
      const h = window.innerHeight
      const pad = edgePad(w)
      const onScreen = (r: DOMRect) => r.bottom > 0 && r.top < h
      let pool = cards.filter((c) => {
        const r = c.getBoundingClientRect()
        return onScreen(r) && r.left >= pad && r.right <= w - pad
      })
      // Экран уже пары карточек — берём хотя бы те, что видны целиком.
      if (!pool.length) {
        pool = cards.filter((c) => {
          const r = c.getBoundingClientRect()
          return onScreen(r) && r.left >= 0 && r.right <= w
        })
      }
      if (!pool.length) return null
      const el = pool[Math.floor(Math.random() * pool.length)]
      return Number(el.dataset.droidId)
    }

    const hide = () => {
      setAwake(null)
      timer = setTimeout(show, PAUSE_MS)
    }
    const show = () => {
      const id = pick()
      if (id === null) { timer = setTimeout(show, PAUSE_MS); return }
      setAwake(id)
      timer = setTimeout(hide, AWAKE_MS)
    }
    timer = setTimeout(show, PAUSE_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <section className="relative py-14 md:py-28">
      <div className="w-full px-6 md:px-[5vw] flex flex-col md:flex-row md:items-start md:justify-between gap-6 md:gap-8">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-4`}>Main Collection</div>
          <h2 className="font-semibold tracking-tight text-[2rem] md:text-[clamp(2.2rem,4.6vw,4rem)] leading-none">ApeDroidz</h2>
          <p className="mt-5 md:mt-6 max-w-xl font-sans text-[0.95rem] md:text-lg leading-relaxed">
            <span className="text-white">3333 glitch-born Droidz on ApeChain. </span>
            <span className="text-white/35">
              Every Droid starts as pixel art, upgrades into a fully animated version and ships with a 3D body
              made for Otherside.
            </span>
          </p>
        </Reveal>
        <Reveal delay={0.1} className="md:pt-8 shrink-0 [&_a]:px-6 [&_a]:py-3.5 md:[&_a]:px-9 md:[&_a]:py-4 [&_a]:text-xs md:[&_a]:text-sm">
          <a
            href={OPENSEA_COLLECTION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={SECONDARY_BTN}
          >
            View all <ArrowUpRight size={16} />
          </a>
        </Reveal>
      </div>

      <Reveal className="mt-10 md:mt-14">
        <div ref={rowsRef} className="space-y-3 md:space-y-4">
          <Marquee durationSec={72} pauseOnHover>
            {MARQUEE_ROW_A.map((d) => <DroidCard key={d.id} droid={d} awake={awake === d.id} />)}
          </Marquee>
          <Marquee durationSec={72} direction="right" pauseOnHover>
            {MARQUEE_ROW_B.map((d) => <DroidCard key={d.id} droid={d} awake={awake === d.id} />)}
          </Marquee>
        </div>
      </Reveal>
    </section>
  )
}
