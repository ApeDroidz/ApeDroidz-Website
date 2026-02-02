"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { staggerContainer, listItem, withDelay, slideInRight } from "@/lib/animations"

const SOCIALS = [
    {
        name: "X",
        url: "https://x.com/ApeDroidz",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h.001Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
        )
    },
    {
        name: "Discord",
        url: "https://discord.com/invite/sFkkYyFZMj",
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
        )
    },
    {
        name: "Magic Eden",
        url: "https://magiceden.io/collections/apechain/0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3",
        icon: (
            <img
                src="/MagicEden.svg"
                alt="Magic Eden"
                className="w-[22px] h-[22px] object-contain brightness-0 invert-[0.7] group-hover:invert transition-all duration-300"
            />
        )
    },
    {
        name: "Opensea",
        url: "https://opensea.io/collection/apedroidz",
        icon: (
            <img
                src="/Opensea.svg"
                alt="Opensea"
                className="w-[22px] h-[22px] object-contain brightness-0 invert-[0.7] group-hover:invert transition-all duration-300"
            />
        )
    }
]

interface SocialSidebarProps {
    orientation?: 'horizontal' | 'vertical';
}

// Delayed container variant for sidebar (appears after main content)
const sidebarContainer = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.08,
            delayChildren: 0.8, // Delay to appear after main page content
        },
    },
}

const sidebarItem = {
    hidden: { opacity: 0, x: 20, scale: 0.9 },
    show: {
        opacity: 1,
        x: 0,
        scale: 1,
        transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
    },
}

export function SocialSidebar({ orientation = 'horizontal' }: SocialSidebarProps) {
    return (
        <motion.div
            className={`hidden lg:flex fixed right-10 bottom-8 z-50 ${orientation === 'vertical' ? 'flex-col' : 'flex-row'} gap-2 items-center`}
            initial="hidden"
            animate="show"
            variants={sidebarContainer}
        >
            {SOCIALS.map((social) => (
                <motion.div key={social.name} variants={sidebarItem}>
                    <Link
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-[48px] h-[48px] bg-black border border-white/15 rounded-xl hover:bg-[#1a1a1a] hover:border-white/30 hover:scale-[1.05] active:scale-[0.98] transition-all duration-300 shadow-lg group"
                        title={social.name}
                    >
                        <div className="text-white/70 group-hover:text-white transition-colors duration-300">
                            {social.icon}
                        </div>
                    </Link>
                </motion.div>
            ))}
        </motion.div>
    )
}
