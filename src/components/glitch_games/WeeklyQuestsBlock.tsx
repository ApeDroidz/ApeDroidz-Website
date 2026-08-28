"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, CalendarRange } from "lucide-react"
import { GlitchQuest } from "./types"
import { QuestCard } from "./QuestCard"
import { fadeUp } from "@/lib/animations"

interface WeeklyQuestsBlockProps {
    quests: GlitchQuest[]
    isHolder: boolean
    wallet: string | undefined
    onQuestClaimed: (xpGained: number, ticketsGained: number) => void
}

export function WeeklyQuestsBlock({ quests, isHolder, wallet, onQuestClaimed }: WeeklyQuestsBlockProps) {
    const [isOpen, setIsOpen] = useState(false)
    const completed = quests.filter(q => q.claimed_at !== null).length

    return (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
            <button
                onClick={() => setIsOpen(v => !v)}
                className="flex items-center justify-between cursor-pointer group"
            >
                <div className="flex items-center gap-2">
                    <CalendarRange className="w-4 h-4 text-white/50" />
                    <span className="text-xs font-black uppercase tracking-widest text-white/70">Weekly Quests</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">
                        {completed}/{quests.length} done
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-white icon-dim-30 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        {quests.length === 0 ? (
                            <p className="text-[10px] text-white/25 font-medium text-center py-3">No weekly quests available</p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {quests.map(quest => (
                                    <QuestCard
                                        key={quest.id}
                                        quest={quest}
                                        isHolder={isHolder}
                                        wallet={wallet}
                                        onClaimed={onQuestClaimed}
                                    />
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
