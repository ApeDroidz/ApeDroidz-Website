"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount, useSendTransaction } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { client, apeChain } from "@/lib/thirdweb"
import { burn, getOwnedNFTs } from "thirdweb/extensions/erc721"
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
import { supabase } from "@/lib/supabase"
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
}

// Contract addresses from env
const BATTERY_CONTRACT = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

const APEDROIDZ_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

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

export default function DashboardPage() {
  const account = useActiveAccount()
  const { mutateAsync: sendTx } = useSendTransaction()
  const router = useRouter()
  const { refetch: refetchProgress } = useUserProgress()

  // --- STATES ---
  const batteryCache = useRef<Record<string, any>>({})
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

  // === ЗАГРУЗКА NFT ===
  const fetchMyNFTs = useCallback(async (isBackground: boolean = false) => {
    // Если это фоновое обновление - не стираем данные и не показываем скелетоны
    if (!isBackground) {
      setIsInventoryLoading(true)
      setBatteries([])
      setDroids([])
    }

    if (!account?.address) {
      setIsInventoryLoading(false)
      return
    }

    try {
      // Load Droids
      const droidContract = getContract({ client, chain: apeChain, address: APEDROIDZ_CONTRACT })
      const droidNfts = await getOwnedNFTs({ contract: droidContract, owner: account.address })

      const loadedDroids = await Promise.all(
        droidNfts.map(async (nft) => {
          const tokenId = nft.id.toString()
          try {
            const res = await fetch(`/api/metadata/droidz/${tokenId}`)
            let metadata = res.ok ? await res.json() : (nft.metadata || {})

            // Используем ту же логику парсинга, что и в helper
            const lvlHelperObj = { level: 0, metadata };
            const currentLevel = getDroidLevel(lvlHelperObj as any);

            let imgUrl = resolveImageUrl((metadata as any).image)
            if (!imgUrl) imgUrl = resolveImageUrl(nft.metadata?.image)

            return {
              id: tokenId,
              tokenId: tokenId,
              name: (metadata as any).name || `ApeDroid #${tokenId}`,
              image: imgUrl,
              type: 'droid' as const,
              level: currentLevel,
              metadata: metadata,
            }
          } catch (err) {
            return {
              id: tokenId,
              tokenId: tokenId,
              name: `ApeDroid #${tokenId}`,
              image: resolveImageUrl(nft.metadata?.image),
              type: 'droid' as const,
              level: 1,
              metadata: nft.metadata || {}
            }
          }
        })
      )
      setDroids(loadedDroids)

      // Load Batteries from battery contract
      if (BATTERY_CONTRACT) {
        try {
          const batteryContractInstance = getContract({ client, chain: apeChain, address: BATTERY_CONTRACT })
          const batteryNfts = await getOwnedNFTs({ contract: batteryContractInstance, owner: account.address })

          const loadedBatteries = await Promise.all(
            batteryNfts.map(async (nft) => {
              const tokenId = nft.id.toString()
              try {
                let metadata;
                // Check Cache (Promise or Data)
                if (batteryCache.current[tokenId]) {
                  metadata = await batteryCache.current[tokenId];
                } else {
                  // Create Promise immediately
                  const fetchPromise = fetch(`/api/metadata/battery/${tokenId}`)
                    .then(res => res.ok ? res.json() : {})
                    .catch((err) => { console.error(err); return {}; });

                  // Store Promise in cache
                  batteryCache.current[tokenId] = fetchPromise;

                  // Await it
                  metadata = await fetchPromise;

                  // Optimize: Replace Promise with Value (optional, but saves micro-overhead)
                  batteryCache.current[tokenId] = metadata;
                }

                // Determine battery type from metadata attributes
                let batteryType: 'Standard' | 'Super' = 'Standard'
                if (metadata.attributes) {
                  const typeAttr = metadata.attributes.find((a: any) => a.trait_type === 'Type')
                  if (typeAttr?.value === 'Super') {
                    batteryType = 'Super'
                  }
                }

                return {
                  id: `battery-${tokenId}`,
                  tokenId: tokenId,
                  name: metadata.name || `Energy Battery #${tokenId}`,
                  image: resolveImageUrl(metadata.image) || 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp',
                  type: 'battery' as const,
                  batteryType: batteryType,
                  metadata: metadata,
                }
              } catch (err) {
                return {
                  id: `battery-${tokenId}`,
                  tokenId: tokenId,
                  name: `Energy Battery #${tokenId}`,
                  image: 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp',
                  type: 'battery' as const,
                  batteryType: 'Standard' as const,
                  metadata: {}
                }
              }
            })
          )

          // Filter out burned batteries by checking Supabase
          const tokenIds = loadedBatteries.map(b => parseInt(b.tokenId))
          const { data: burnedData } = await supabase
            .from('batteries')
            .select('token_id')
            .in('token_id', tokenIds)
            .eq('is_burned', true)

          const burnedTokenIds = new Set((burnedData || []).map((b: { token_id: number }) => String(b.token_id)))
          const activeBatteries = loadedBatteries.filter(b => !burnedTokenIds.has(b.tokenId))

          setBatteries(activeBatteries)
        } catch (batteryError) {
          console.error("Error loading batteries:", batteryError)
        }
      }
    } catch (error) {
      console.error("Error loading NFTs:", error)
    } finally {
      if (!isBackground) {
        setIsInventoryLoading(false)
      }
    }
  }, [account?.address])

  useEffect(() => {
    fetchMyNFTs()

    // Polling for recent mints (retry once after 2s)
    const timer = setTimeout(fetchMyNFTs, 2000)
    return () => clearTimeout(timer)
  }, [fetchMyNFTs])

  // Redirect to home if not connected - with delay to allow wallet reconnection on refresh
  useEffect(() => {
    // Give thirdweb time to reconnect wallet on page refresh (2 seconds)
    const timer = setTimeout(() => {
      if (!account?.address) router.push('/')
    }, 2000)
    return () => clearTimeout(timer)
  }, [account?.address, router])

  // === АПГРЕЙД ===
  const handleUpgrade = async () => {
    if (!selectedDroid || !selectedBattery) return
    setIsUpgrading(true)

    try {
      // 1. BURN BATTERY ON-CHAIN
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

      // 2. CALL API TO UPDATE METADATA (Already protected by backend checks, but now we burn first)
      const [response, _] = await Promise.all([
        fetch('/api/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId: selectedDroid.tokenId,
            batteryId: selectedBattery.tokenId // Backend verifies type from DB
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

      await fetchMyNFTs()
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
                onRefresh={fetchMyNFTs}
              />
            </div>
            <div className="flex-1 lg:min-h-0 shadow-2xl shadow-black/50 rounded-2xl">
              <Inventory
                key={`droids-${droids.length}-${newUpgradedDroid ? 'upgraded' : ''}`}
                title="2. Select Droid"
                items={droids}
                selectedId={selectedDroid?.id}
                onSelect={handleSelectDroid} // <--- Сюда подключена новая логика
                onDetailClick={(item) => { setDetailModalItem(item); setIsDetailModalOpen(true); }}
                type="droid"
                isLoading={isInventoryLoading}
                onRefresh={fetchMyNFTs}
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