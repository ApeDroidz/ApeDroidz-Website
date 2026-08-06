"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { HeroSection } from "@/components/landing/hero-section"
import { StatsStrip } from "@/components/landing/stats-strip"
import { CollectionSection } from "@/components/landing/collection-section"
import { HonorariesSection } from "@/components/landing/honoraries-section"
import { PlaySection } from "@/components/landing/play-section"
import { PartnersMarquee } from "@/components/landing/partners-marquee"
import { TeamSection } from "@/components/landing/team-section"
import { Footer } from "@/components/footer"

export default function Home() {
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'fetch'
    link.href = '/white-droid.glb'
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }, [])

  return (
    <main className="relative w-full bg-black font-sans text-white">
      {/* ФОН: бегущие символы, фиксированы на всю страницу */}
      <div
        className="fixed inset-0 z-0 pointer-events-none select-none mix-blend-screen"
        style={{
          maskImage: "linear-gradient(to bottom, black 40%, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 40%, transparent 70%)"
        }}
      >
        <DigitalBackground />
      </div>

      {/* HEADER */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <Header
          onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
          onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
        />
      </div>

      {/* КОНТЕНТ */}
      <div className="relative z-10">
        <HeroSection />
        <StatsStrip />
        <CollectionSection />
        <HonorariesSection />
        <PlaySection />
        <PartnersMarquee />
        <TeamSection />
        <Footer />
      </div>

      {/* Profile Modal */}
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
    </main>
  )
}
