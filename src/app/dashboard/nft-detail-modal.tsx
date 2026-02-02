"use client"

import { useState, useEffect } from "react"
import { NFTItem } from "@/app/dashboard/page"
import { X, Lock, Zap, Check } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { NFTImageSkeleton } from "@/components/nft-image-skeleton"
import { resolveImageUrl } from "@/lib/utils"

interface NFTDetailModalProps {
  item: NFTItem | null
  isOpen: boolean
  onClose: () => void
  onUpgrade?: () => void
  type: 'droid' | 'battery'
}

interface Trait {
  name: string
  value: string
}

export function NFTDetailModal({ item, isOpen, onClose, onUpgrade, type }: NFTDetailModalProps) {
  if (!item) return null

  const finalImage = resolveImageUrl(item.image)
  const level = item.level || 1

  // === ЛОГИКА ЦВЕТОВ ===
  // Super только если уровень > 1
  const hasSuperTrait = item.metadata?.attributes?.some((a: any) =>
    (a.trait_type === "upgrade level" && a.value?.toLowerCase().includes("super")) ||
    (a.trait_type === "background" && a.value === "apechain_orange")
  );
  const isSuper = level > 1 && hasSuperTrait;

  const themeColors = isSuper
    ? { bg: "bg-orange-600", border: "border-orange-400", text: "text-white", shadow: "shadow-[0_0_15px_rgba(234,88,12,0.4)]" }
    : { bg: "bg-blue-600", border: "border-blue-400", text: "text-white", shadow: "shadow-[0_0_15px_rgba(37,99,235,0.4)]" };

  const inactiveStyle = "bg-white/5 border-white/10 text-white/30";
  const nextStepStyle = "bg-white/10 border-white/20 text-white/50 animate-pulse";

  const getTraits = (): Trait[] => {
    if (item.metadata?.attributes && Array.isArray(item.metadata.attributes)) {
      return item.metadata.attributes.map((attr: any) => ({
        name: attr.trait_type || attr.name || 'unknown',
        value: attr.value?.toString() || 'N/A',
      }))
    }
    return []
  }
  const traits = getTraits()

  const ProgressSegment = ({ isActive, isNext, isLocked, label, icon }: { isActive: boolean, isNext: boolean, isLocked?: boolean, label: string, icon?: React.ReactNode }) => {
    let currentStyle = inactiveStyle;
    if (isActive) currentStyle = `${themeColors.bg} ${themeColors.border} ${themeColors.text} ${themeColors.shadow}`;
    else if (isNext) currentStyle = nextStepStyle;

    return (
      <div className={`flex-1 h-12 rounded-lg flex items-center justify-center border-2 transition-all duration-300 relative overflow-hidden ${currentStyle}`}>
        <span className="relative z-10 text-[10px] lg:text-xs font-black uppercase tracking-widest flex items-center gap-2">
          {label} {icon}
        </span>
      </div>
    )
  }

  // Detect mobile for fullscreen modal
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={isMobile ? { opacity: 0, y: "100%", x: 0 } : { opacity: 0, scale: 0.95, x: "-50%", y: "-45%" }}
            animate={isMobile ? { opacity: 1, y: 0, x: 0 } : { opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={isMobile ? { opacity: 0, y: "100%", x: 0 } : { opacity: 0, scale: 0.95, x: "-50%", y: "-45%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={`fixed z-[101] bg-[#0a0a0a] shadow-2xl shadow-black
              ${isMobile
                ? 'inset-0 w-full h-full rounded-none border-0 overflow-y-auto'
                : 'left-1/2 top-1/2 w-auto h-auto max-h-[95vh] lg:h-[70vh] lg:max-h-[650px] max-w-6xl border border-white/20 rounded-2xl overflow-hidden flex flex-col lg:flex-row'
              }
            `}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-[110] w-10 h-10 flex items-center justify-center rounded-lg bg-black/60 hover:bg-white/20 hover:text-white border border-white/20 transition-all cursor-pointer backdrop-blur-md"
            >
              <X size={20} className="text-white" />
            </button>

            {/* ЛЕВАЯ ЧАСТЬ - на мобилке не фиксируется, скроллится вместе с контентом */}
            <div className={`relative w-full bg-[#050505] border-b lg:border-b-0 lg:border-r border-white/10 ${isMobile ? '' : 'aspect-square lg:h-full lg:w-auto flex-shrink-0'}`}>
              <div className={`${isMobile ? 'w-full aspect-square' : 'w-full h-full'}`}>
                <NFTImageSkeleton
                  src={finalImage}
                  alt={item.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* ПРАВАЯ ЧАСТЬ */}
            <div className="flex-1 min-w-0 lg:min-w-[450px] flex flex-col p-6 lg:p-10 overflow-y-auto custom-scrollbar bg-black">

              <div className="relative mb-6 lg:mb-8">
                <h2 className="text-3xl lg:text-4xl font-black uppercase tracking-tighter text-white leading-tight break-words mb-6">
                  {item.name}
                </h2>

                {/* EVOLUTION PROGRESS BAR */}
                {type === 'droid' && (
                  <div className="w-full flex items-center gap-2 mb-6">
                    <ProgressSegment
                      isActive={level >= 1}
                      isNext={false}
                      label="LVL 1"
                      icon={level >= 1 ? <Check size={14} strokeWidth={4} /> : null}
                    />
                    <ProgressSegment
                      isActive={level >= 2}
                      isNext={level === 1}
                      label={isSuper ? "2 SUPER" : "LVL 2"}
                      icon={level >= 2 ? <Zap size={14} fill="currentColor" /> : null}
                    />
                    <ProgressSegment
                      isActive={level >= 3}
                      isNext={false}
                      isLocked={true}
                      label="LVL 3"
                      icon={<Lock size={14} className="opacity-60" />}
                    />
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="mb-8">
                {/* КНОПКА ДЛЯ ДРОИДОВ */}
                {type === 'droid' && level === 1 && (
                  <button
                    onClick={() => { if (onUpgrade) onUpgrade(); onClose(); }}
                    className="w-full py-4 bg-white text-black font-black uppercase tracking-[0.2em] rounded-xl hover:bg-blue-600 hover:text-white transition-all duration-300 shadow-lg text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Zap size={16} /> Initiate Fusion
                  </button>
                )}

                {/* КНОПКА ДЛЯ БАТАРЕЕК */}
                {type === 'battery' && (
                  <button
                    onClick={() => { if (onUpgrade) onUpgrade(); onClose(); }}
                    className="w-full py-4 bg-white text-black font-black uppercase tracking-[0.2em] rounded-xl hover:bg-blue-600 hover:text-white transition-all duration-300 shadow-lg text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Check size={16} strokeWidth={3} /> Equip Battery
                  </button>
                )}
              </div>

              {/* ТРЕЙТЫ */}
              {traits.length > 0 ? (
                <div className="flex-1">
                  <h3 className="text-[10px] font-mono text-white/30 mb-4 uppercase tracking-[0.2em] font-bold">
                    Decoded Attributes
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4">
                    {traits.map((trait, idx) => (
                      <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all group">
                        <div className="text-[9px] text-white/30 uppercase font-mono tracking-widest mb-1 group-hover:text-blue-400 transition-colors">
                          {trait.name}
                        </div>
                        <div className="text-xs font-bold text-white uppercase tracking-tight leading-tight break-words">
                          {trait.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center border border-dashed border-white/10 rounded-2xl">
                  <p className="text-white/20 font-mono text-[9px] uppercase tracking-[0.3em] animate-pulse">
                    Scanning Metadata...
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}