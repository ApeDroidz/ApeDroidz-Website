"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount, useSendTransaction } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { client, apeChain } from "@/lib/thirdweb"
import { burn } from "thirdweb/extensions/erc721"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { UpgradeMachine } from "./upgrade-machine"
import { Inventory } from "./inventory"
import { NFTDetailModal } from "./nft-detail-modal"
import { AlertModal } from "@/components/alert-modal"
import { ShareModal } from "@/components/share-modal"
import { ProfileModal } from "@/components/profile-modal"
import { resolveImageUrl } from "@/lib/utils"
import { useUserProgress } from "@/hooks/useUserProgress"
import { useGlitchSession } from "@/hooks/useGlitchSession"
import { Share, ExternalLink, Zap } from "lucide-react"

// === ТИПЫ ДАННЫХ ===
export type NFTItem = {
  id: string
  name: string
  image: string
  type: 'droid' | 'battery'
  level?: number
  tokenId?: string
  batteryType?: 'Standard' | 'Super'
  metadata?: any
  isHonorary?: boolean
}

// Contract address from env — still needed on-chain for the battery burn tx.
const BATTERY_CONTRACT = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

// === ХЕЛПЕР: ГЛУБОКАЯ ПРОВЕРКА УРОВНЯ (Как в UpgradeMachine) ===
const getDroidLevel = (item: NFTItem | null): number => {
  if (!item) return 1;
  if (typeof item.level === 'number' && item.level > 0) return item.level;

  // @ts-ignore
  const attributes = item.metadata?.attributes || item.metadata?.traits || [];
  if (Array.isArray(attributes)) {
    const lvlAttr = attributes.find((a: any) =>
      a.trait_type === "Level" ||
      a.trait_type === "Rank Value" ||
      a.trait_type === "Upgrade Level"
    );
    if (lvlAttr) {
      const val = parseInt(String(lvlAttr.value).replace(/\D/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return 1;
};

export default function UpgradeModulePage() {
  const account = useActiveAccount()
  const { mutateAsync: sendTx } = useSendTransaction()
  const router = useRouter()
  const { refetch: refetchProgress } = useUserProgress()
  const { ensureLogin } = useGlitchSession()

  // --- STATES ---
  const [selectedDroid, setSelectedDroid] = useState<NFTItem | null>(null)
  const [selectedBattery, setSelectedBattery] = useState<NFTItem | null>(null)
  const [isUpgrading, setIsUpgrading] = useState(false)

  // newUpgradedDroid - только для анимации успеха в Машине
  const [newUpgradedDroid, setNewUpgradedDroid] = useState<NFTItem | null>(null)

  // shareItem - отдельный стейт для модалки шеринга (чтобы не триггерить машину)
  const [shareItem, setShareItem] = useState<NFTItem | null>(null)

  const [droids, setDroids] = useState<NFTItem[]>([])
  const [batteries, setBatteries] = useState<NFTItem[]>([])
  const [isInventoryLoading, setIsInventoryLoading] = useState(true)

  // Modals
  const [detailModalItem, setDetailModalItem] = useState<NFTItem | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
  const [alertState, setAlertState] = useState<{ isOpen: boolean, item: NFTItem | null, type?: 'max_level' }>({ isOpen: false, item: null })
  const [toastState, setToastState] = useState<{ isOpen: boolean, type: 'success' | 'error' | 'info', title: string, message: string }>({ isOpen: false, type: 'info', title: '', message: '' })
  const [confirmUpgradeOpen, setConfirmUpgradeOpen] = useState(false)

  // === ЗАГРУЗКА NFT (0 thirdweb RPC: Insight-индексер + БД, как в дашборде) ===
  // И дроиды, и батарейки грузятся через наши серверные роуты — браузер thirdweb
  // не трогает. Кэш на сессию + умный retry гасят лишние запросы.
  const emptyLoadRef = useRef(false)
  const fetchMyNFTs = useCallback(async (opts?: { force?: boolean; isBackground?: boolean } | boolean) => {
    // `true` is the legacy "background refresh" call from UpgradeMachine after a
    // successful upgrade — it must bypass the cache, which still holds the old level.
    const isBackground = opts === true || (typeof opts === 'object' && !!opts?.isBackground)
    const force = opts === true || (typeof opts === 'object' && !!opts?.force)

    if (!account?.address) {
      setIsInventoryLoading(false)
      return
    }
    const owner = account.address
    const cacheKey = `apedroidz:nfts:${owner.toLowerCase()}`

    if (!force && typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          const p = JSON.parse(cached)
          if (Date.now() - p.ts < 60_000 && Array.isArray(p.droids) && Array.isArray(p.batteries)) {
            setDroids(p.droids)
            setBatteries(p.batteries)
            setIsInventoryLoading(false)
            emptyLoadRef.current = p.droids.length === 0 && p.batteries.length === 0
            return
          }
        }
      } catch { /* ignore cache errors */ }
    }

    if (!isBackground) {
      setIsInventoryLoading(true)
      setBatteries([])
      setDroids([])
    }

    let loadedDroids: NFTItem[] = []
    let loadedBatteries: NFTItem[] = []
    try {
      const [droidRes, batteryRes] = await Promise.all([
        fetch(`/api/owned-droids?owner=${owner}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<any>,
        fetch(`/api/owned-batteries?owner=${owner}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<any>,
      ])

      loadedDroids = (droidRes?.droids || []).map((d: any) => ({
        id: d.id,
        tokenId: d.tokenId,
        name: d.name,
        // Cards + machine screen show the holder's saved default view.
        image: resolveImageUrl(d.image || d.image_pixel),
        type: 'droid' as const,
        level: d.level ?? 1,
        metadata: { attributes: d.attributes, display_view: d.display_view, is_super: d.is_super },
      }))
      loadedBatteries = (batteryRes?.batteries || []).map((b: any) => ({
        id: b.id,
        tokenId: b.tokenId,
        name: b.name,
        image: b.image,
        type: 'battery' as const,
        batteryType: b.batteryType,
        metadata: b.metadata || {},
      }))

      setDroids(loadedDroids)
      setBatteries(loadedBatteries)
      if (typeof window !== 'undefined') {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), droids: loadedDroids, batteries: loadedBatteries })) } catch { /* quota */ }
      }
    } catch (error) {
      console.error("Error loading NFTs:", error)
    } finally {
      emptyLoadRef.current = loadedDroids.length === 0 && loadedBatteries.length === 0
      if (!isBackground) setIsInventoryLoading(false)
    }
  }, [account?.address])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await fetchMyNFTs()
      // Индексер может отставать после свежего минта — повторяем один раз, если пусто.
      if (!cancelled && emptyLoadRef.current && account?.address) {
        setTimeout(() => { if (!cancelled) fetchMyNFTs({ force: true, isBackground: true }) }, 3000)
      }
    })()
    return () => { cancelled = true }
  }, [fetchMyNFTs, account?.address])

  // Pre-select a droid passed from the dashboard ("Upgrade to unlock animated"),
  // so it lands straight in the machine — no re-picking. Runs once, once loaded.
  const preselectDone = useRef(false)
  useEffect(() => {
    if (preselectDone.current || droids.length === 0) return
    let target: string | null = null
    try { target = new URLSearchParams(window.location.search).get('select') } catch { target = null }
    if (!target) { preselectDone.current = true; return }
    const match = droids.find(d => String(d.tokenId) === String(target))
    if (match && getDroidLevel(match) < 2) {
      setSelectedDroid(match)
    }
    preselectDone.current = true
  }, [droids])



  // === АПГРЕЙД ===
  const handleUpgrade = async () => {
    if (!selectedDroid || !selectedBattery) return
    setIsUpgrading(true)

    try {
      // 0. AUTH — required before any burn so we never lose a battery to a 401.
      const ok = await ensureLogin()
      if (!ok) {
        setToastState({ isOpen: true, type: 'error', title: 'Sign-in required', message: 'Please sign the login message to upgrade.' })
        setIsUpgrading(false)
        return
      }

      // 1. PRECHECK — validate ownership, droid level, battery type BEFORE burn.
      //    If anything is wrong, abort cleanly. Battery is NOT touched.
      const precheckRes = await fetch('/api/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tokenId: selectedDroid.tokenId,
          batteryId: selectedBattery.tokenId,
          phase: 'precheck',
        }),
      })
      const precheck = await precheckRes.json().catch(() => ({}))
      if (!precheckRes.ok || !precheck?.ok) {
        setToastState({
          isOpen: true,
          type: 'error',
          title: 'Cannot upgrade',
          message: precheck?.error || 'Pre-check failed. Battery NOT burned.',
        })
        setIsUpgrading(false)
        return
      }

      // 2. BURN BATTERY ON-CHAIN — only after precheck passed.
      if (BATTERY_CONTRACT) {
        const batteryContractInstance = getContract({ client, chain: apeChain, address: BATTERY_CONTRACT })
        const transaction = burn({
          contract: batteryContractInstance,
          tokenId: BigInt(selectedBattery.tokenId || 0)
        })

        try {
          await sendTx(transaction);
        } catch (txError: any) {
          console.error("Transaction rejected/failed:", txError);
          const errMsg = txError?.message || "";

          if (errMsg.includes("rejected") || errMsg.includes("denied")) {
            setToastState({ isOpen: true, type: 'error', title: 'Transaction Cancelled', message: 'You must confirm the burn transaction to proceed.' });
          } else if (errMsg.includes("owner") || errMsg.includes("reverted") || errMsg.includes("execution reverted")) {
            setToastState({ isOpen: true, type: 'error', title: 'Burn Failed', message: 'Error: Battery might already be used or invalid. Please refresh the page.' });
          } else {
            setToastState({ isOpen: true, type: 'error', title: 'Burn Error', message: 'Something went wrong with the burn transaction.' });
          }

          setIsUpgrading(false);
          return;
        }
      }

      // 3. COMMIT — server now verifies on-chain that the battery is burned,
      //    upserts the batteries row (auto-recovers missing rows from merges),
      //    and runs the upgrade RPC. Idempotent — safe to retry on flake.
      const [response, _] = await Promise.all([
        fetch('/api/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            tokenId: selectedDroid.tokenId,
            batteryId: selectedBattery.tokenId,
            phase: 'commit',
          }),
        }),
        new Promise(resolve => setTimeout(resolve, 2000))
      ])

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Upgrade failed')

      const updatedDroidData = data.updatedDroid
      if (!updatedDroidData) throw new Error("No data returned")

      const newImageUrl = resolveImageUrl(updatedDroidData.image_url)

      const upgradedItem: NFTItem = {
        ...selectedDroid,
        level: updatedDroidData.level,
        image: newImageUrl,
        metadata: {
          ...selectedDroid.metadata,
          attributes: updatedDroidData.traits || []
        }
      }

      // 1. Показываем успех в машине
      setNewUpgradedDroid(upgradedItem)

      // 2. Готовим этот же предмет для шеринга (но не открываем модалку сразу, это делает кнопка в машине)
      setShareItem(upgradedItem)

      // Инвалидируем кэши (свой и дашборда), чтобы новый уровень был виден сразу.
      try {
        if (account?.address) {
          const key = account.address.toLowerCase()
          sessionStorage.removeItem(`apedroidz:droids:${key}`)
          sessionStorage.removeItem(`apedroidz:nfts:${key}`)
        }
      } catch { /* ignore */ }

      await fetchMyNFTs({ force: true })
      if (refetchProgress) refetchProgress()

    } catch (error: any) {
      console.error(error)
      setToastState({ isOpen: true, type: 'error', title: 'Fusion Error', message: error.message })
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleReset = () => {
    setNewUpgradedDroid(null)
    setSelectedDroid(null)
    setSelectedBattery(null)
  }

  // === ВЫБОР ДРОИДА (БЛОКИРОВКА 2 ЛВЛ) ===
  const handleSelectDroid = (item: NFTItem | null) => {
    // Если на экране успеха (после апгрейда) -> сбрасываем успех и батарейку, имитируя "Close & Continue"
    if (newUpgradedDroid) {
      setNewUpgradedDroid(null)
      setSelectedBattery(null)
    }

    if (item) {
      const level = getDroidLevel(item);

      // ЕСЛИ УРОВЕНЬ 2+ -> НЕ ВЫБИРАЕМ, А ПОКАЗЫВАЕМ МЕНЮ
      if (level >= 2) {
        setAlertState({ isOpen: true, item, type: 'max_level' });
        return;
      }
    }
    // Если уровень 1 -> выбираем в слот машины
    setSelectedDroid(item);
  }

  return (
    <main className="relative min-h-screen w-full bg-black font-sans overflow-y-auto lg:overflow-hidden lg:h-screen text-white selection:bg-white/20">
      <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>

      <div className="relative z-10 min-h-screen lg:h-full flex flex-col">
        <Header
          onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
          onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
        />

        <motion.div
          className="pt-24 pb-6 px-4 sm:px-6 flex-1 grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 lg:h-full lg:overflow-hidden"
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.15,
                delayChildren: 0.1,
              },
            },
          }}
        >
          <motion.div
            className="flex flex-col min-h-[400px] lg:h-full lg:min-h-0 relative order-1 lg:order-none lg:col-span-3"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              },
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent rounded-full blur-3xl pointer-events-none transform scale-75" />
            <UpgradeMachine
              selectedDroid={selectedDroid}
              selectedBattery={selectedBattery}
              onUpgrade={() => setConfirmUpgradeOpen(true)}
              onReset={handleReset}
              isUpgrading={isUpgrading}
              newDroid={newUpgradedDroid}
              onShare={() => setIsShareModalOpen(true)} // Открывает модалку с shareItem
              isSuperBattery={selectedBattery?.batteryType === 'Super'}
              onRefreshInventory={fetchMyNFTs}
            />
          </motion.div>

          <motion.div
            className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-hidden pr-0 order-2 lg:order-none lg:col-span-2"
            variants={{
              hidden: { opacity: 0, y: 30 },
              show: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              },
            }}
          >
            <div className="flex-shrink-0 h-auto lg:h-[180px] shadow-2xl shadow-black/50 rounded-2xl">
              <Inventory
                title="1.Select Energy Battery"
                items={batteries}
                selectedId={selectedBattery?.id}
                onSelect={setSelectedBattery}
                onDetailClick={(item) => { setDetailModalItem(item); setIsDetailModalOpen(true); }}
                type="battery"
                singleRow={false}
                isLoading={isInventoryLoading}
                onRefresh={async () => { await fetchMyNFTs({ force: true }) }}
              />
            </div>
            <div className="flex-1 lg:min-h-0 shadow-2xl shadow-black/50 rounded-2xl">
              <Inventory
                title="2. Select Droid"
                items={droids}
                selectedId={selectedDroid?.id}
                onSelect={handleSelectDroid} // <--- Сюда подключена новая логика
                onDetailClick={(item) => { setDetailModalItem(item); setIsDetailModalOpen(true); }}
                type="droid"
                isLoading={isInventoryLoading}
                onRefresh={async () => { await fetchMyNFTs({ force: true }) }}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* --- MODALS --- */}

      <NFTDetailModal
        item={detailModalItem}
        isOpen={isDetailModalOpen}
        onClose={() => { setIsDetailModalOpen(false); setDetailModalItem(null); }}
        onUpgrade={() => {
          // Логика кнопки "Upgrade" внутри деталей
          if (detailModalItem?.type === 'droid') {
            const lvl = getDroidLevel(detailModalItem);
            if (lvl >= 2) {
              setIsDetailModalOpen(false);
              setAlertState({ isOpen: true, item: detailModalItem, type: 'max_level' });
              return;
            }
            setSelectedDroid(detailModalItem);
          } else {
            setSelectedBattery(detailModalItem);
          }
          setIsDetailModalOpen(false);
        }}
        type={detailModalItem?.type || 'droid'}
      />

      {/* ALERT MODAL (MAX LEVEL MENU) */}
      <AlertModal
        isOpen={alertState.isOpen}
        // Используем тип 'upgraded_droid' для показа кнопок Share/Details
        type="upgraded_droid"
        title="Maximum Power Reached"
        message={`Droid #${alertState.item?.tokenId} is already at Level ${getDroidLevel(alertState.item)}. It cannot be upgraded further.`}
        onClose={() => setAlertState({ isOpen: false, item: null })}

        // КНОПКА DETAILS
        onViewDetails={() => {
          setDetailModalItem(alertState.item);
          setAlertState({ isOpen: false, item: null });
          setIsDetailModalOpen(true);
        }}

        // КНОПКА SHARE (Самое важное!)
        onShare={() => {
          setShareItem(alertState.item); // Устанавливаем дроида для шеринга
          setAlertState({ isOpen: false, item: null });
          setIsShareModalOpen(true); // Открываем ShareModal
        }}

        isSuper={alertState.item?.metadata?.attributes?.some((a: any) =>
          a.value?.toString().toLowerCase().includes("super")
        )}
      />

      <AlertModal
        isOpen={toastState.isOpen}
        type={toastState.type}
        title={toastState.title}
        message={toastState.message}
        onClose={() => setToastState(prev => ({ ...prev, isOpen: false }))}
        autoClose={3000}
      />

      <AlertModal
        isOpen={confirmUpgradeOpen}
        type="warning"
        title="Confirm Upgrade"
        message={`Battery "${selectedBattery?.name}" will be burned to upgrade Droid #${selectedDroid?.tokenId}.`}
        onClose={() => setConfirmUpgradeOpen(false)}
        buttons={[
          { label: 'Cancel', onClick: () => setConfirmUpgradeOpen(false), variant: 'secondary' },
          { label: 'Start Upgrade', onClick: () => { setConfirmUpgradeOpen(false); handleUpgrade(); }, variant: 'primary', color: 'blue' }
        ]}
      />

      {/* SHARE MODAL (Использует shareItem - универсально для новых и старых) */}
      <ShareModal
        item={shareItem || newUpgradedDroid} // Берем или выбранного для шера, или только что созданного
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        onShowToast={(type, title, message) => setToastState({ isOpen: true, type, title, message })}
      />

      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
    </main>
  )
}