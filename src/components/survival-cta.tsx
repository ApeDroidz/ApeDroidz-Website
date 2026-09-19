"use client"

import { memo, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, X } from "lucide-react"
import Link from "next/link"

// Угловой баннер лендинга (владелец, 19.09): «в левом нижнем углу как был до
// этого, только вставим видео с Droidz Survival и напишем BETA is LIVE, и
// кнопка Play». Тот же каркас, что у прежних баннеров (glitch-cta, droid-3d-cta):
// стеклянная карточка, заголовок, окно превью, крупная строка и кнопка.
// В окне — анонс беты с R2, без звука и по кругу; звук есть на самой странице игры.

const ANNOUNCE_SRC = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce.mp4'
const ANNOUNCE_POSTER = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce-poster.jpg'

// Закрытый баннер не возвращается. Ключ с версией: поменяем содержимое —
// поднимем номер, и баннер снова покажется тем, кто закрыл прошлый.
// v2 (19.09): баннер «пропал» у владельца — он был закрыт крестиком, а решение
// лежит в localStorage навсегда. Номер поднят, чтобы баннер вернулся всем,
// кто закрыл первую версию.
const DISMISS_KEY = 'apedroidz.cta-survival.dismissed.v2'

function SurvivalCTAComponent() {
    const [isDismissed, setIsDismissed] = useState(false)

    // Решение читаем уже на клиенте: обращение к localStorage при рендере
    // разошлось бы с разметкой сервера.
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

    if (isDismissed) return null

    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[190px] sm:w-[230px] md:w-[300px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            {/* Крестик снаружи ссылки: кнопка внутри ссылки уводила бы на игру,
                и вложенные интерактивные элементы недопустимы в разметке. */}
            <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="absolute -top-2 -right-2 z-10 grid place-items-center w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-white/15 bg-[#0a0a0a] text-white/50 shadow-lg cursor-pointer transition-colors duration-200 hover:bg-white hover:text-black hover:border-white"
            >
                <X size={12} strokeWidth={2.5} />
            </button>

            <Link
                href="/droidz_survival"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── Title ────────────────────────────────────────────────── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    <p className="text-[7.5px] sm:text-[9.5px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-[1.15]">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">Droidz Survival Game</span>
                    </p>
                </div>

                {/* ── Preview window: the announce, silent, looping ─────────── */}
                <div className="relative px-1.5 sm:px-1">
                    {/* 2:1, not 16:9: a full-height video card climbed into the hero's
                        CHECK YOUR DROIDZ button on a 900-tall screen; the crop trims sky. */}
                    <div className="relative w-full aspect-[2/1] rounded-xl overflow-hidden border border-white/5 bg-[#090909]">
                        <video
                            src={ANNOUNCE_SRC}
                            poster={ANNOUNCE_POSTER}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            aria-label="Droidz Survival beta announce"
                            className="absolute inset-0 h-full w-full object-cover"
                        />
                        <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{ boxShadow: "inset 0 0 18px rgba(0,0,0,0.55)" }}
                        />
                        <span className="absolute top-1.5 left-1.5 rounded-full border border-white/15 bg-black/60 px-1.5 py-0.5 font-mono text-[7px] sm:text-[8px] uppercase tracking-widest text-white/70">
                            Closed beta
                        </span>
                    </div>
                </div>

                {/* ── Text & CTA ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 sm:gap-2 sm:px-3 sm:pb-3 sm:pt-2">
                    {/* Одной строкой (владелец, 19.09). whitespace-nowrap, чтобы узкая
                        карточка на телефоне не переносила «is Live» обратно вниз. */}
                    <h3 className="whitespace-nowrap text-[15px] sm:text-[19px] md:text-[22px] font-black text-white leading-none tracking-tight uppercase">
                        Beta{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white">
                            is Live
                        </span>
                    </h3>

                    <div className="w-full h-8 sm:h-9 flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-wider text-[10px] sm:text-[11px] transition-all duration-300 bg-white text-black group-hover:bg-[#0069FF] group-hover:text-white shadow-[0_0_20px_rgba(255,255,255,.1)] group-hover:shadow-[0_0_25px_rgba(0,105,255,.5)]">
                        Play
                        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform hidden sm:block" />
                    </div>
                </div>

                <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[60px] pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600/20 blur-[60px] pointer-events-none" />
            </Link>
        </motion.div>
    )
}

export const SurvivalCTA = memo(SurvivalCTAComponent)
