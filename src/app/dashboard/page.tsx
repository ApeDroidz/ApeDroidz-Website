"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { client, apeChain } from "@/lib/thirdweb"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { Inventory } from "@/app/upgrade_module/inventory"
import { NFTItem } from "@/app/upgrade_module/page"
import { AlertModal } from "@/components/alert-modal"
import { ProfileModal } from "@/components/profile-modal"
import { resolveImageUrl } from "@/lib/utils"
import { useGlitchSession } from "@/hooks/useGlitchSession"
import { Check, ChevronsUp, Loader2, Save } from "lucide-react"

const APEDROIDZ_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

type ViewKey = 'pixel' | 'animated' | 'pfp3d' | 'fullbody'

const getDroidLevel = (item: NFTItem | null): number => {
  if (!item) return 1;
  if (typeof item.level === 'number' && item.level > 0) return item.level;
  const attributes = item.metadata?.attributes || item.metadata?.traits || [];
  if (Array.isArray(attributes)) {
    const lvlAttr = attributes.find((a: any) =>
      a.trait_type === "Level" || a.trait_type === "Rank Value" || a.trait_type === "Upgrade Level"
    );
    if (lvlAttr) {
      const val = parseInt(String(lvlAttr.value).replace(/\D/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return 1;
};

export default function DashboardPage() {
  const account = useActiveAccount()
  const router = useRouter()
  const { ensureLogin } = useGlitchSession()

  const [droids, setDroids] = useState<NFTItem[]>([])
  const [isInventoryLoading, setIsInventoryLoading] = useState(true)
  const [selectedDroid, setSelectedDroid] = useState<NFTItem | null>(null)

  // View currently shown inside the embedded previewer (synced via postMessage)
  const [currentView, setCurrentView] = useState<ViewKey>('pixel')
  const [savedView, setSavedView] = useState<ViewKey | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
  const [toastState, setToastState] = useState<{ isOpen: boolean, type: 'success' | 'error' | 'info', title: string, message: string }>({ isOpen: false, type: 'info', title: '', message: '' })

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // === ЗАГРУЗКА ДРОИДОВ (быстрая: 1 on-chain enum + 1 батч-запрос метадаты) ===
  const fetchMyDroids = useCallback(async (isBackground: boolean = false) => {
    if (!isBackground) {
      setIsInventoryLoading(true)
      setDroids([])
    }
    if (!account?.address) {
      setIsInventoryLoading(false)
      return
    }
    try {
      const droidContract = getContract({ client, chain: apeChain, address: APEDROIDZ_CONTRACT })
      const droidNfts = await getOwnedNFTs({ contract: droidContract, owner: account.address })

      const ids = droidNfts.map((nft) => nft.id.toString())
      if (ids.length === 0) {
        setDroids([])
        return
      }

      // Keep on-chain metadata as a fallback image source.
      const chainMeta: Record<string, any> = {}
      droidNfts.forEach((nft) => { chainMeta[nft.id.toString()] = nft.metadata })

      // ONE batch call for all owned droids instead of N per-token fetches.
      let metaMap: Record<string, any> = {}
      try {
        const res = await fetch('/api/metadata/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        if (res.ok) metaMap = (await res.json())?.droids || {}
      } catch (e) {
        console.error('[dashboard] batch metadata failed, using on-chain fallback:', e)
      }

      const loadedDroids: NFTItem[] = ids.map((tokenId) => {
        const m = metaMap[tokenId]
        const img = resolveImageUrl(m?.image_pixel || m?.image) || resolveImageUrl(chainMeta[tokenId]?.image)
        return {
          id: tokenId,
          tokenId,
          name: m?.name || `ApeDroid #${tokenId}`,
          image: img,
          type: 'droid' as const,
          level: m?.level ?? 1,
          metadata: m || chainMeta[tokenId] || {},
        }
      })
      setDroids(loadedDroids)
    } catch (error) {
      console.error("Error loading droids:", error)
    } finally {
      if (!isBackground) setIsInventoryLoading(false)
    }
  }, [account?.address])

  useEffect(() => {
    fetchMyDroids()
    // Retry once after a couple seconds to catch indexing lag on fresh mints/transfers.
    const timer = setTimeout(() => fetchMyDroids(true), 2000)
    return () => clearTimeout(timer)
  }, [fetchMyDroids])

  // === СИНХРОНИЗАЦИЯ С ПРЕВЬЮЕРОМ (postMessage из iframe) ===
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e?.data
      if (d?.type === 'apedroidz:viewChanged' && String(d.tokenId) === String(selectedDroid?.tokenId)) {
        setCurrentView(d.view as ViewKey)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [selectedDroid?.tokenId])

  const handleSelectDroid = (item: NFTItem | null) => {
    setSelectedDroid(item)
    setJustSaved(false)
    if (item) {
      const dv = item.metadata?.display_view
      const initial: ViewKey = dv === 'animated' ? 'animated' : dv === 'pixel' ? 'pixel'
        : getDroidLevel(item) >= 2 ? 'animated' : 'pixel'
      setCurrentView(initial)
      setSavedView(initial)
    }
  }

  const selectedLevel = getDroidLevel(selectedDroid)
  const needsUpgradeForCurrent = currentView === 'animated' && selectedLevel < 2
  const isCurrentSaved = savedView === currentView && !needsUpgradeForCurrent

  // === SAVE YOUR PFP ===
  const handleSaveDefault = async () => {
    if (!selectedDroid || isSaving) return
    if (needsUpgradeForCurrent) {
      router.push('/upgrade_module')
      return
    }
    setIsSaving(true)
    try {
      const ok = await ensureLogin()
      if (!ok) {
        setToastState({ isOpen: true, type: 'error', title: 'Sign-in required', message: 'Please sign the login message to save your PFP.' })
        return
      }
      const res = await fetch('/api/display-pref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tokenId: selectedDroid.tokenId, view: currentView }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (data?.needsUpgrade) {
          router.push('/upgrade_module')
          return
        }
        throw new Error(data?.error || 'Failed to save')
      }
      setSavedView(currentView)
      setJustSaved(true)
      setToastState({
        isOpen: true, type: 'success', title: 'PFP saved',
        message: `Droid #${selectedDroid.tokenId} now shows the ${currentView === 'animated' ? 'Animated' : 'Pixel'} version on marketplaces. Refresh metadata on OpenSea to see it live.`,
      })
      setTimeout(() => setJustSaved(false), 2500)
    } catch (error: any) {
      setToastState({ isOpen: true, type: 'error', title: 'Save failed', message: error.message })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="relative min-h-screen w-full bg-black font-sans overflow-y-auto lg:overflow-hidden lg:h-screen text-white selection:bg-white/20">
      <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>

      <div className="relative z-10 min-h-screen lg:h-full flex flex-col">
        <Header
          isDashboard={true}
          onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
          onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
        />

        <motion.div
          className="pt-24 pb-6 px-4 sm:px-6 flex-1 grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 lg:h-full lg:overflow-hidden"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
          }}
        >
          {/* ЛЕВАЯ ЧАСТЬ — PFP PREVIEWER (без рамки, как машина в апгрейд-модуле) */}
          <motion.div
            className="flex flex-col min-h-[420px] lg:h-full lg:min-h-0 relative order-1 lg:order-none lg:col-span-3"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent rounded-full blur-3xl pointer-events-none transform scale-75" />

            {/* Header row — совпадает по верстке с шапкой инвентаря */}
            <div className="flex items-start justify-between gap-3 mb-4 flex-shrink-0 relative">
              <div>
                <h1 className="text-base font-bold tracking-wider text-white/90 uppercase">Choose your PFP</h1>
                <p className="text-xs text-white/40 mt-1 max-w-md leading-relaxed">
                  Pick the render that represents your droid — it&apos;s what OpenSea and other marketplaces will display.
                </p>
              </div>
              {selectedDroid && (
                <span className="flex-shrink-0 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-mono text-white font-bold border border-white/10">
                  #{selectedDroid.tokenId}
                </span>
              )}
            </div>

            {/* Превьюер — без карточки-рамки */}
            <div className="flex-1 min-h-[300px] lg:min-h-0 relative rounded-xl overflow-hidden bg-black">
              {selectedDroid ? (
                <iframe
                  ref={iframeRef}
                  key={selectedDroid.tokenId}
                  src={`/api/viewer/${selectedDroid.tokenId}?embed=1`}
                  title={`ApeDroid #${selectedDroid.tokenId} previewer`}
                  className="absolute inset-0 w-full h-full border-0"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <img src="/icon_logo.svg" alt="" className="w-16 h-auto opacity-20" />
                  <p className="text-sm font-bold uppercase tracking-widest text-white/30">Select a Droid</p>
                  <p className="text-xs text-white/20 max-w-[240px]">Pick a droid from the list to preview and set its PFP.</p>
                </div>
              )}
            </div>

            {/* SAVE YOUR PFP */}
            <div className="flex-shrink-0 mt-4 relative">
              <AnimatePresence mode="wait">
                {needsUpgradeForCurrent ? (
                  <motion.button
                    key="upgrade"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    onClick={handleSaveDefault}
                    className="w-full h-12 flex items-center justify-center gap-2 bg-[#3b82f6] text-white font-black uppercase tracking-wider rounded-xl hover:bg-[#0069FF] transition-all text-sm shadow-lg cursor-pointer"
                  >
                    <ChevronsUp size={18} />
                    Upgrade to unlock Animated
                  </motion.button>
                ) : (
                  <motion.button
                    key="save"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    onClick={handleSaveDefault}
                    disabled={!selectedDroid || isSaving || isCurrentSaved}
                    className={`w-full h-12 flex items-center justify-center gap-2 font-black uppercase tracking-wider rounded-xl transition-all text-sm shadow-lg ${
                      !selectedDroid
                        ? 'bg-white/5 text-white/25 cursor-not-allowed border border-white/10'
                        : isCurrentSaved
                          ? 'bg-white/10 text-white/60 border border-white/15 cursor-default'
                          : 'bg-white text-black hover:bg-[#0069FF] hover:text-white cursor-pointer'
                    }`}
                  >
                    {isSaving ? (
                      <><Loader2 size={18} className="animate-spin" /> Saving…</>
                    ) : justSaved || isCurrentSaved ? (
                      <><Check size={18} /> {justSaved ? 'Saved' : 'Current PFP'}</>
                    ) : (
                      <><Save size={18} /> Save your PFP</>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
              {selectedDroid && (
                <p className="text-[10px] text-white/25 text-center mt-2">
                  Saved PFP becomes the default on OpenSea after a metadata refresh.
                </p>
              )}
            </div>
          </motion.div>

          {/* ПРАВАЯ ЧАСТЬ — СПИСОК ДРОИДОВ */}
          <motion.div
            className="flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden order-2 lg:order-none lg:col-span-2"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            <div className="flex-1 lg:min-h-0 shadow-2xl shadow-black/50 rounded-2xl">
              <Inventory
                title="Your Droidz"
                items={droids}
                selectedId={selectedDroid?.id}
                onSelect={handleSelectDroid}
                type="droid"
                isLoading={isInventoryLoading}
                onRefresh={fetchMyDroids}
                showDetails={false}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>

      <AlertModal
        isOpen={toastState.isOpen}
        type={toastState.type}
        title={toastState.title}
        message={toastState.message}
        onClose={() => setToastState(prev => ({ ...prev, isOpen: false }))}
        autoClose={3500}
      />

      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
    </main>
  )
}
