"use client"

import { memo, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, X } from "lucide-react"
import Link from "next/link"
import { droidStaticUrl, droid3dPfpThumbUrl } from "@/lib/media"
import { MARQUEE_ROW_A, MARQUEE_ROW_B, MarqueeDroid } from "@/lib/landing-data"

// Угловой баннер лендинга: рассказывает про 3D и уводит холдера в дашборд
// выбирать, каким рендером представлен его дроид.
//
// Правая плитка перестала быть заглушкой: с релиза 3D бюст есть у каждого
// токена, поэтому баннер крутит подборку — слева пиксельный дроид, справа его
// же бюст, пара меняется каждые несколько секунд.

// Та же подборка, что в ленте коллекции на лендинге: там ids уже отобраны
// вручную и выглядят хорошо. Отдельный список пришлось бы поддерживать вторым.
const POOL: MarqueeDroid[] = [...MARQUEE_ROW_A, ...MARQUEE_ROW_B]

/** Сколько дроид держится в кадре. */
const SWAP_MS = 3500

// Закрытый баннер не возвращается. Ключ с версией: поменяем содержимое —
// поднимем номер, и баннер снова покажется тем, кто закрыл прошлый.
const DISMISS_KEY = 'apedroidz.cta3d.dismissed.v1' 

// ?v=1 — часть 512px превью успели запросить, пока заливка в R2 ещё шла, и
// Cloudflare закэшировал 404 на год. Метка даёт другой ключ кэша; та же, что в
// ленте коллекции, иначе картинки грузились бы дважды.
// Бюст всегда берём из синего набора, каким бы ни был сам токен — ровно как в
// ленте коллекции: пара «пиксель → 3D» на одном фоне читается как один дроид.
const bustUrl = (d: MarqueeDroid) => `${droid3dPfpThumbUrl(d.id, 1, false)}?v=1`
const pixelUrl = (d: MarqueeDroid) => droidStaticUrl(d.id, 1, false)

function Droid3DCTAComponent() {
    const [index, setIndex] = useState(0)
    const [isDismissed, setIsDismissed] = useState(false)

    // Решение читаем уже на клиенте: обращение к localStorage при рендере
    // разошлось бы с разметкой сервера. Баннер и так выезжает с задержкой в
    // секунду, поэтому закрывшие его мелькания не увидят.
    useEffect(() => {
        try {
            if (localStorage.getItem(DISMISS_KEY) === '1') setIsDismissed(true)
        } catch {
            // приватный режим или запрет на хранилище — просто показываем баннер
        }
    }, [])

    const dismiss = () => {
        setIsDismissed(true)
        try {
            localStorage.setItem(DISMISS_KEY, '1')
        } catch {
            // не сохранилось — закроется только до перезагрузки
        }
    }

    // Стартовая позиция случайная, но выбирается уже на клиенте: посчитать её
    // при рендере значило бы разойтись с разметкой сервера.
    useEffect(() => {
        setIndex(Math.floor(Math.random() * POOL.length))
    }, [])

    useEffect(() => {
        // Закрытый баннер не рисуется — крутить подборку и греть картинки незачем.
        if (isDismissed) return
        const timer = setInterval(() => setIndex((i) => (i + 1) % POOL.length), SWAP_MS)
        return () => clearInterval(timer)
    }, [isDismissed])

    // Следующая пара подгружается заранее, иначе смена ловится глазом как
    // пустая плитка.
    useEffect(() => {
        if (isDismissed) return
        const next = POOL[(index + 1) % POOL.length]
        for (const src of [pixelUrl(next), bustUrl(next)]) {
            const img = new Image()
            img.src = src
        }
    }, [index, isDismissed])

    const droid = POOL[index]

    if (isDismissed) return null

    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[190px] sm:w-[240px] md:w-[340px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            {/* Крестик стоит СНАРУЖИ ссылки: кнопка внутри ссылки — и клик по
                ней заодно уводил бы на дашборд, и вложенные интерактивные
                элементы недопустимы в разметке. Заодно он не обрезается
                скруглением карточки, у которой overflow-hidden. */}
            <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="absolute -top-2 -right-2 z-10 grid place-items-center w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-white/15 bg-[#0a0a0a] text-white/50 shadow-lg cursor-pointer transition-colors duration-200 hover:bg-white hover:text-black hover:border-white"
            >
                <X size={12} strokeWidth={2.5} />
            </button>

            <Link
                href="/dashboard"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── Title ────────────────────────────────────────────────── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    {/* Заголовок длиннее прежнего, поэтому без nowrap: на узкой
                        карточке он переносится на вторую строку, а не срезается
                        краем панели. */}
                    <p className="text-[7.5px] sm:text-[9.5px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-[1.15]">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">ApeDroidz 3D Collection</span>{" "}
                        <span className="text-[#3b82f6] drop-shadow-[0_0_8px_rgba(59,130,246,.4)]">is Live</span>
                    </p>
                </div>

                {/* ── Pixel → 3D ─────────────────────────────────────────────
                     Широкая полоса без рамки: арт лежит прямо на панели, по
                     бокам воздух. Обе плитки меняются вместе — это один и тот
                     же дроид в двух видах, и разъезжаться они не должны. */}
                <div className="relative px-1.5 sm:px-1">
                    <div className="relative w-full aspect-[16/7] rounded-xl overflow-hidden bg-[#090909] flex items-center justify-center gap-3 sm:gap-4 md:gap-5 px-4 sm:px-5 md:px-7">
                        {/* пиксельная версия */}
                        <div className="relative h-[82%] aspect-square flex-shrink-0 rounded-xl overflow-hidden">
                            <AnimatePresence initial={false}>
                                <motion.img
                                    key={`pixel-${droid.id}`}
                                    src={pixelUrl(droid)}
                                    alt={`ApeDroid #${droid.id} pixel`}
                                    draggable={false}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.5, ease: "easeInOut" }}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{ imageRendering: "pixelated" }}
                                />
                            </AnimatePresence>
                        </div>

                        <ArrowRight
                            size={16}
                            className="text-white icon-dim-40 flex-shrink-0 group-hover:text-[#3b82f6] group-hover:translate-x-0.5 transition-all"
                        />

                        {/* 3D-бюст того же токена */}
                        <div className="relative h-[82%] aspect-square flex-shrink-0 rounded-xl overflow-hidden">
                            <AnimatePresence initial={false}>
                                <motion.img
                                    key={`bust-${droid.id}`}
                                    src={bustUrl(droid)}
                                    alt={`ApeDroid #${droid.id} in 3D`}
                                    draggable={false}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.5, ease: "easeInOut" }}
                                    className="absolute inset-0 w-full h-full object-cover"
                                />
                            </AnimatePresence>
                        </div>

                        <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{ boxShadow: "inset 0 0 18px rgba(0,0,0,0.55)" }}
                        />
                    </div>
                </div>

                {/* ── Text & CTA ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 sm:gap-2 sm:px-3 sm:pb-3 sm:pt-2">
                    {/* На узкой карточке строка не помещается целиком. Перенос
                        задан руками между «Your» и «PFP Style»: сам браузер
                        оставил бы на второй строке одинокое «Style». */}
                    <h3 className="text-[14px] sm:text-[18px] md:text-[21px] font-black leading-[0.95] tracking-tight uppercase">
                        <span className="text-white">Choose Your</span>
                        <br className="md:hidden" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white">{" "}PFP Style</span>
                    </h3>

                    <div className="w-full h-8 sm:h-9 flex items-center justify-center gap-2 rounded-full font-black uppercase tracking-wider text-[10px] sm:text-[11px] transition-all duration-300 bg-white text-black group-hover:bg-[#0069FF] group-hover:text-white shadow-[0_0_20px_rgba(255,255,255,.1)] group-hover:shadow-[0_0_25px_rgba(0,105,255,.5)]">
                        Change PFP
                        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform hidden sm:block" />
                    </div>
                </div>

                <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[60px] pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600/20 blur-[60px] pointer-events-none" />
            </Link>
        </motion.div>
    )
}

export const Droid3DCTA = memo(Droid3DCTAComponent)
