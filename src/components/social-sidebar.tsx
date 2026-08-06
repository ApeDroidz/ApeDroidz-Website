"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { SOCIALS } from "@/lib/socials"

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
                            <social.Icon className={social.name === "OpenSea"
                                ? "w-[22px] h-[22px] object-contain brightness-0 invert-[0.7] group-hover:invert transition-all duration-300"
                                : "w-5 h-5"} />
                        </div>
                    </Link>
                </motion.div>
            ))}
        </motion.div>
    )
}
