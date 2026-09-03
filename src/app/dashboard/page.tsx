"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { Inventory } from "@/app/upgrade_module/inventory"
import { NFTItem } from "@/app/upgrade_module/page"
import { AlertModal } from "@/components/alert-modal"
import { ProfileModal } from "@/components/profile-modal"
import { resolveImageUrl } from "@/lib/utils"
import { useGlitchSession } from "@/hooks/useGlitchSession"
import { Check, ChevronsUp, Loader2, Lock, Save } from "lucide-react"

// Level can arrive as 'level' (current) or legacy 'Level'/'Rank Value'.
const LEVEL_TRAIT_KEYS = ['level', 'rank value', 'upgrade level']

type ViewKey = 'pixel' | 'animated' | 'pfp3d' | 'fullbody' | 'model3d'
type Collection = 'droidz' | 'honorary'

// Вид, в котором показывается ВЕСЬ список справа. Standard — как сейчас: у
// каждого дроида та картинка, что реально стоит у него в метаданных. Остальные
// перекрашивают список целиком, чтобы холдер увидел свою коллекцию в одном
// стиле, ничего при этом не сохраняя.
type StyleKey = 'standard' | 'pfp3d' | 'pixel' | 'animated' | 'fullbody'

const STYLE_OPTIONS: { label: string; value: StyleKey; locked?: boolean }[] = [
  { label: 'Standard style', value: 'standard' },
  { label: '3D PFP', value: 'pfp3d' },
  { label: 'Pixel', value: 'pixel' },
  { label: 'Animated', value: 'animated' },
  { label: 'Full Body', value: 'fullbody', locked: true },
]

/** Картинка карточки для выбранного стиля. Standard и всё, чего у токена нет
 *  (у honorary, например, нет 3D), падают на сохранённый вид из метаданных. */
const styledImage = (item: NFTItem, style: StyleKey): string | undefined => {
  const m = item.metadata || {}
  const variant = style === 'pixel' ? m.image_pixel
    : style === 'animated' ? m.image_animated
      : style === 'pfp3d' ? m.image_3d
        : null
  return variant || item.image
}

// Per-wallet droid cache TTL — avoids re-hitting the indexer on every
// remount / navigation between pages within a session.
const DROIDS_CACHE_TTL = 120_000

const getDroidLevel = (item: NFTItem | null): number => {
  if (!item) return 1;
  if (typeof item.level === 'number' && item.level > 0) return item.level;
  const attributes = item.metadata?.attributes || item.metadata?.traits || [];
  if (Array.isArray(attributes)) {
    const lvlAttr = attributes.find((a: any) =>
      LEVEL_TRAIT_KEYS.includes(String(a.trait_type || '').toLowerCase())
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

  // Which collection the panel is showing. Honorary is a separate ERC-1155
  // contract with its own endpoint, art and unlock rules.
  const [collection, setCollection] = useState<Collection>('droidz')
  const [droids, setDroids] = useState<NFTItem[]>([])
  const [isInventoryLoading, setIsInventoryLoading] = useState(true)
  const [selectedDroid, setSelectedDroid] = useState<NFTItem | null>(null)

  // View currently shown inside the embedded previewer (synced via postMessage)
  const [currentView, setCurrentView] = useState<ViewKey>('pixel')
  const [savedView, setSavedView] = useState<ViewKey | null>(null)
  const [listStyle, setListStyle] = useState<StyleKey>('standard')
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
  const [toastState, setToastState] = useState<{ isOpen: boolean, type: 'success' | 'error' | 'info', title: string, message: string }>({ isOpen: false, type: 'info', title: '', message: '' })

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // === ЗАГРУЗКА ДРОИДОВ (0 thirdweb RPC: Insight-индексер + БД через наш сервер) ===
  // Браузер делает ОДИН same-origin запрос к /api/owned-droids; thirdweb он не
  // трогает вообще (ни RPC-квоты, ни домен-allowlist). Кэш на сессию гасит
  // повторные сканы при навигации/ремаунтах.
  const fetchMyDroids = useCallback(async (opts?: { force?: boolean; isBackground?: boolean }): Promise<number> => {
    const force = opts?.force ?? false
    const isBackground = opts?.isBackground ?? false
    if (!account?.address) {
      setIsInventoryLoading(false)
      return 0
    }
    const owner = account.address
    const endpoint = collection === 'honorary' ? '/api/owned-honorary' : '/api/owned-droids'
    const cacheKey = collection === 'honorary'
      ? `apedroidz:honorary:${owner.toLowerCase()}`
      : `apedroidz:droids:${owner.toLowerCase()}`

    if (!force && typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Date.now() - parsed.ts < DROIDS_CACHE_TTL && Array.isArray(parsed.droids)) {
            setDroids(parsed.droids)
            setIsInventoryLoading(false)
            return parsed.droids.length
          }
        }
      } catch { /* ignore cache errors */ }
    }

    if (!isBackground) {
      setIsInventoryLoading(true)
      setDroids([])
    }
    try {
      const res = await fetch(`${endpoint}?owner=${owner}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      const loadedDroids: NFTItem[] = (json?.droids || []).map((d: any) => ({
        id: d.id,
        tokenId: d.tokenId,
        name: d.name,
        // Cards show whatever the holder saved as their default view.
        image: resolveImageUrl(d.image || d.image_pixel),
        type: 'droid' as const,
        level: d.level ?? 1,
        isHonorary: !!d.isHonorary,
        metadata: {
          attributes: d.attributes,
          display_view: d.display_view,
          is_super: d.is_super,
          has_gif: d.has_gif,
          // Kept so saving a new default can repaint the card without a refetch.
          image_pixel: d.image_pixel,
          image_animated: d.image_animated,
          image_3d: d.image_3d,
        },
      }))
      setDroids(loadedDroids)
      if (typeof window !== 'undefined') {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), droids: loadedDroids })) } catch { /* quota */ }
      }
      return loadedDroids.length
    } catch (error) {
      console.error("Error loading droids:", error)
      return 0
    } finally {
      if (!isBackground) setIsInventoryLoading(false)
    }
  }, [account?.address, collection])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const n = await fetchMyDroids()
      // Индексер может отставать на блок-другой после свежего минта/трансфера —
      // повторяем РОВНО один раз и только если пусто.
      if (!cancelled && n === 0 && account?.address) {
        setTimeout(() => { if (!cancelled) fetchMyDroids({ force: true, isBackground: true }) }, 3000)
      }
    })()
    return () => { cancelled = true }
  }, [fetchMyDroids, account?.address])

  // === СИНХРОНИЗАЦИЯ С ПРЕВЬЮЕРОМ (postMessage из iframe) ===
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e?.data
      if (d?.type === 'apedroidz:viewChanged' && String(d.tokenId) === String(selectedDroid?.tokenId)) {
        setCurrentView(d.view as ViewKey)
      }
      // "Upgrade to unlock" pressed inside the previewer.
      if (d?.type === 'apedroidz:upgradeRequested' && d.tokenId) {
        router.push(`/upgrade_module?select=${d.tokenId}`)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [selectedDroid?.tokenId, router])

  // Switching collections invalidates the current selection/previewer.
  const handleSwitchCollection = (next: Collection) => {
    if (next === collection) return
    setCollection(next)
    setSelectedDroid(null)
    setJustSaved(false)
  }

  const handleSelectDroid = (item: NFTItem | null) => {
    setSelectedDroid(item)
    setJustSaved(false)
    if (item) {
      const dv = item.metadata?.display_view
      const initial: ViewKey = dv === 'animated' ? 'animated' : dv === 'pixel' ? 'pixel'
        : dv === 'pfp3d' ? 'pfp3d'
          : getDroidLevel(item) >= 2 ? 'animated' : 'pixel'
      setCurrentView(initial)
      setSavedView(initial)
    }
  }

  // Список показывается в выбранном стиле. Сохранённый вид токена при этом не
  // меняется — это только просмотр, поэтому подменяем картинку на лету.
  const styledDroids = useMemo(
    () => (listStyle === 'standard' ? droids : droids.map((d) => ({ ...d, image: styledImage(d, listStyle) || d.image }))),
    [droids, listStyle],
  )

  const selectedLevel = getDroidLevel(selectedDroid)
  const isHonorary = collection === 'honorary'
  // Honorary: animated exists only when the token actually has a gif.
  // Base collection: animated unlocks at level 2.
  const needsUpgradeForCurrent = currentView === 'animated' && (
    isHonorary ? !selectedDroid?.metadata?.has_gif : selectedLevel < 2
  )
  const isCurrentSaved = savedView === currentView && !needsUpgradeForCurrent
  // PFP в метаданных — это картинка. Интерактивную модель и фул-боди туда не
  // положить, поэтому на этих вкладках кнопке сохранения нечего делать.
  const isSaveableView = currentView === 'pixel' || currentView === 'animated' || currentView === 'pfp3d'

  // === SAVE YOUR PFP ===
  const handleSaveDefault = async () => {
    if (!selectedDroid || isSaving) return
    if (needsUpgradeForCurrent) {
      router.push(`/upgrade_module?select=${selectedDroid.tokenId}`)
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
        body: JSON.stringify({ tokenId: selectedDroid.tokenId, view: currentView, collection }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (data?.needsUpgrade) {
          router.push(`/upgrade_module?select=${selectedDroid.tokenId}`)
          return
        }
        throw new Error(data?.error || 'Failed to save')
      }
      setSavedView(currentView)
      setJustSaved(true)

      // Repaint this droid's card with the newly chosen view right away, and
      // drop the caches so a reload (or the upgrade module) agrees with it.
      setDroids(prev => {
        const next = prev.map(d => {
          if (d.id !== selectedDroid.id) return d
          const variant = currentView === 'animated' ? d.metadata?.image_animated
            : currentView === 'pfp3d' ? d.metadata?.image_3d
              : d.metadata?.image_pixel
          return variant
            ? { ...d, image: variant, metadata: { ...d.metadata, display_view: currentView } }
            : d
        })
        if (account?.address && typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(
              `apedroidz:droids:${account.address.toLowerCase()}`,
              JSON.stringify({ ts: Date.now(), droids: next })
            )
            sessionStorage.removeItem(`apedroidz:nfts:${account.address.toLowerCase()}`)
          } catch { /* quota */ }
        }
        return next
      })

      // Say plainly whether the marketplace nudge went through, instead of
      // promising an automatic refresh that may have silently failed.
      const variant = currentView === 'animated' ? 'Animated' : currentView === 'pfp3d' ? '3D PFP' : 'Pixel'
      setToastState({
        isOpen: true, type: 'success', title: 'PFP saved',
        message: data?.marketplaceRefreshed === false
          ? `Droid #${selectedDroid.tokenId} — ${variant} version\nMarketplace refresh was rejected — refresh manually if it looks stale`
          : `Droid #${selectedDroid.tokenId} — ${variant} version\nMetadata will update automatically`,
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
          className="pt-24 pb-6 px-4 sm:px-6 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 lg:h-full lg:overflow-hidden"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
          }}
        >
          {/* ЛЕВАЯ ЧАСТЬ — PFP PREVIEWER (без рамки, центрировано, как машина в апгрейд-модуле) */}
          <motion.div
            className="flex flex-col items-center min-h-[420px] lg:h-full lg:min-h-0 relative order-1 lg:order-none"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent rounded-full blur-3xl pointer-events-none transform scale-75" />

            {/* Header — размеры и верстка как в апгрейд-модуле (по центру) */}
            <div className="w-full max-w-[1200px] px-4 mt-4 mb-4 md:mb-6 z-20 text-center flex-shrink-0">
              <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-2">
                Choose Your PFP Style
              </h1>
              <p className="text-gray-400 text-xs md:text-sm font-mono leading-relaxed max-w-2xl mx-auto px-4">
                Pick the render that represents your droid — it&apos;s what OpenSea and other marketplaces will display.
              </p>
            </div>

            {/* Превьюер — без карточки-рамки, лёгкое скругление (только визуально;
                сам файл картинки при открытии/скачивании без скруглений) */}
            <div className="flex-1 w-full min-h-[300px] lg:min-h-0 relative rounded-2xl overflow-hidden bg-black">
              {selectedDroid ? (
                <iframe
                  ref={iframeRef}
                  key={`${collection}-${selectedDroid.tokenId}`}
                  src={`/api/viewer/${selectedDroid.tokenId}?embed=1${isHonorary ? '&collection=honorary' : ''}`}
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

            {/* SAVE YOUR PFP — nothing to act on until a droid is picked */}
            <div className="flex-shrink-0 mt-4 relative w-full max-w-[520px] mx-auto">
              <AnimatePresence mode="wait">
                {!selectedDroid ? null : !isSaveableView ? (
                  <motion.div
                    key="not-a-pfp"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="w-full h-12 flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-white/50 font-black uppercase tracking-wider text-sm"
                  >
                    <Lock size={16} />
                    Interactive view — not a PFP
                  </motion.div>
                ) : needsUpgradeForCurrent ? (
                  // Locked. On the base collection this is actionable — upgrading
                  // is something the holder can do right now. Honorary has no
                  // self-serve path, so it only states what unlocks it.
                  isHonorary ? (
                    // On the site (no marketplace sandbox) this can be a real
                    // link, unlike the plaque inside the previewer.
                    <motion.a
                      key="honorary-locked"
                      href="https://x.com/SPLITF0RM"
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      className="w-full h-12 flex items-center justify-center gap-2 bg-white text-black font-black uppercase tracking-wider rounded-full hover:bg-[#0069FF] hover:text-white transition-all text-sm shadow-lg cursor-pointer no-underline"
                    >
                      <Lock size={16} />
                      Contact SPLITFORM to order
                    </motion.a>
                  ) : (
                    <motion.button
                      key="upgrade"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      onClick={handleSaveDefault}
                      className="w-full h-12 flex items-center justify-center gap-2 bg-white text-black font-black uppercase tracking-wider rounded-full hover:bg-[#0069FF] hover:text-white transition-all text-sm shadow-lg cursor-pointer"
                    >
                      <ChevronsUp size={18} />
                      Upgrade to unlock Animated
                    </motion.button>
                  )
                ) : (
                  <motion.button
                    key="save"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    onClick={handleSaveDefault}
                    disabled={isSaving || isCurrentSaved}
                    className={`w-full h-12 flex items-center justify-center gap-2 font-black uppercase tracking-wider rounded-full transition-all text-sm shadow-lg ${
                      isCurrentSaved
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
                  Saved PFP becomes the default everywhere your droid is shown.
                </p>
              )}
            </div>
          </motion.div>

          {/* ПРАВАЯ ЧАСТЬ — СПИСОК ДРОИДОВ (50% ширины, плотная сетка до 5 карточек) */}
          <motion.div
            className="flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden order-2 lg:order-none"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            <div className="flex-1 lg:min-h-0 shadow-2xl shadow-black/50 rounded-2xl">
              <Inventory
                title="Your Droidz"
                collectionSwitch={{
                  value: collection,
                  options: [
                    { key: 'droidz', label: 'ApeDroidz' },
                    { key: 'honorary', label: 'Honorary' },
                  ],
                  onChange: (k) => handleSwitchCollection(k as Collection),
                }}
                hideFilter={isHonorary}
                styleFilter={{
                  value: listStyle,
                  // У honorary нет 3D-рендера — вариант виден, но заперт.
                  options: isHonorary
                    ? STYLE_OPTIONS.map((o) => (o.value === 'pfp3d' ? { ...o, locked: true } : o))
                    : STYLE_OPTIONS,
                  onChange: (v) => setListStyle(v as StyleKey),
                }}
                items={styledDroids}
                selectedId={selectedDroid?.id}
                onSelect={handleSelectDroid}
                type="droid"
                isLoading={isInventoryLoading}
                onRefresh={async () => { await fetchMyDroids({ force: true }) }}
                showDetails={false}
                droidGridClassName="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6"
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
