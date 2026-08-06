"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { Coins } from "lucide-react"

// Placeholder while staking is being built. The route exists so the header can
// link to something real instead of a dead button.
export default function StakingPage() {
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

  return (
    <main className="relative min-h-screen w-full bg-black font-sans text-white selection:bg-white/20 overflow-hidden">
      <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <Header
          onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
          onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
        />

        <div className="flex-1 flex items-center justify-center px-4">
          <motion.div
            className="text-center max-w-lg"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Coins size={28} className="text-[#666666]" />
            </div>

            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-3">
              Staking
            </h1>
            <p className="text-[#3b82f6] text-xs md:text-sm font-black uppercase tracking-[0.3em] mb-5">
              Coming Soon
            </p>
            <p className="text-gray-400 text-xs md:text-sm font-mono leading-relaxed max-w-md mx-auto">
              Put your Droidz to work. Details land here once the mechanics are locked in.
            </p>
          </motion.div>
        </div>
      </div>

      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
    </main>
  )
}
