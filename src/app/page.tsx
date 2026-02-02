"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import dynamic from "next/dynamic"
import { Header } from "@/components/header"
import { MotionMenu } from "@/components/motionmenu"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { MintCTA } from "@/components/mint-cta"
import { SocialSidebar } from "@/components/social-sidebar"

// Динамический импорт Scene с отключенным SSR
const Scene = dynamic(() => import("@/components/scene").then((mod) => ({ default: mod.Scene })), {
  ssr: false,
  loading: () => <div className="absolute inset-0 w-full h-full bg-black" />
})

export default function Home() {
  const [activeEmotion, setActiveEmotion] = useState<string | null>(null)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
  const router = useRouter()
  const account = useActiveAccount()


  useEffect(() => {
    const preloadModel = (url: string) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'fetch';
      link.href = url;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    };
    preloadModel('/white-droid.glb');
    preloadModel('/animations/Dance.glb');
  }, []);

  return (
    <main className="relative h-[100dvh] w-full bg-black overflow-hidden font-sans">

      {/* СЛОЙ 5 (ВЕРХНИЙ): HEADER */}
      <div className="absolute top-0 left-0 right-0 z-50">
        <Header
          onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
          onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
        />
      </div>

      {/* СЛОЙ 1 (ФОН): ЦИФРОВОЙ ФОН (над дымом) */}
      <div
        className="absolute inset-0 z-0 pointer-events-none select-none mix-blend-screen"
        style={{
          maskImage: "linear-gradient(to bottom, black 40%, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 40%, transparent 70%)"
        }}
      >
        <DigitalBackground />
      </div>

      {/* СЛОЙ 2 (СЕРЕДИНА): 3D СЦЕНА */}
      <div className="absolute inset-0 z-10">
        <Scene
          activeEmotion={activeEmotion}
          onEmotionEnd={() => setActiveEmotion(null)}
        />
      </div>

      {/* СЛОЙ 3 (UI): МЕНЮ */}
      <MotionMenu
        activeEmotion={activeEmotion}
        onSelect={setActiveEmotion}
        disabled={activeEmotion !== null}
      />

      {/* Mint CTA */}
      <MintCTA />

      {/* Social Sidebar */}
      <SocialSidebar />

      {/* Profile Modal */}
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
    </main>
  )
}