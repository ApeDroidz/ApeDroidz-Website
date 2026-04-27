"use client"

import { motion } from "framer-motion"
import { CalendarDays } from "lucide-react"
import { GlitchQuest } from "./types"
import { QuestCard } from "./QuestCard"
import { fadeUp } from "@/lib/animations"

interface DailyQuestsBlockProps {
    quests: GlitchQuest[]
    isHolder: boolean
    wallet: string | undefined
    onQuestClaimed: (xpGained: number, ticketsGained: number) => void
}

export function DailyQuestsBlock({ quests, isHolder, wallet, onQuestClaimed }: DailyQuestsBlockProps) {
    const completed = quests.filter(q => q.claimed_at !== null).length

    return (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-white/50" />
                    <span className="text-xs font-black uppercase tracking-widest text-white/70">Daily Quests</span>
                </div>
                <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">
                    {completed}/{quests.length} done
                </span>
            </div>

            {quests.length === 0 ? (
                <p className="text-[10px] text-white/25 font-medium text-center py-3">No quests available</p>
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
    )
}
