"use client"

import dynamic from "next/dynamic"
import { motion } from "framer-motion"
import { createWallet } from "thirdweb/wallets"
import { client, apeChain } from "@/lib/thirdweb"

const ConnectButton = dynamic(
    () => import("thirdweb/react").then((mod) => mod.ConnectButton),
    { ssr: false },
)

const wallets = [
    createWallet("io.metamask"),
    createWallet("com.coinbase.wallet"),
    createWallet("me.rainbow"),
]

/**
 * Дверь холдерских страниц: дашборд, апгрейд-машина, грид.
 *
 * Без кошелька эти экраны выглядели как пустой инструмент — рабочая область на
 * месте, но в ней нечего выбрать, и единственная кнопка вела на OpenSea
 * (владелец, 20.09: «а то у него щас одна кнопка бай он опенси»). Купить дроида
 * — это не то, что нужно сделать человеку, у которого он уже есть: ему нужно
 * подключить кошелёк. Поэтому подключение здесь — главное действие, а
 * маркетплейс остался ссылкой для тех, у кого дроида действительно нет.
 *
 * Слой z-40: шапка сайта (z-50) с её собственной кнопкой кошелька остаётся
 * сверху и кликабельной, накрыта только рабочая область.
 */
export function ConnectGate({
    title = "Connect your wallet",
    subtitle = "Your droidz live in your wallet — connect it and they show up here.",
}: {
    title?: string
    subtitle?: string
}) {
    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 pt-24 pb-10 bg-black/70 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0b]/95 p-8 text-center shadow-2xl shadow-black/60"
            >
                <img src="/icon_logo.svg" alt="" className="mx-auto mb-5 h-12 w-auto opacity-60" />

                <h2 className="mb-2 text-2xl font-black uppercase tracking-tight text-white">{title}</h2>
                <p className="mx-auto mb-6 max-w-xs text-xs leading-relaxed text-white/40">{subtitle}</p>

                <div className="flex justify-center [&_button]:!w-full">
                    <ConnectButton
                        client={client}
                        chain={apeChain}
                        wallets={wallets}
                        theme={"dark"}
                        connectButton={{
                            label: "Connect Wallet",
                            className: `
                                !bg-white !text-black !font-black !uppercase !tracking-wider !rounded-full
                                !h-12 !px-8 !text-sm !w-full
                                !border !border-transparent !transition-all !duration-300
                                hover:!bg-[#0069FF] hover:!text-white
                            `,
                        }}
                        connectModal={{
                            size: "compact",
                            title: "ApeDroidz Access",
                            showThirdwebBranding: false,
                        }}
                    />
                </div>

                <a
                    href="https://opensea.io/collection/apedroidz"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-white/35 transition-colors hover:text-white"
                >
                    <img src="/Opensea.svg" alt="" className="h-3.5 w-3.5 object-contain opacity-60" />
                    No droid yet? Get one on OpenSea
                </a>
            </motion.div>
        </div>
    )
}
