"use client"

import { NFTItem } from "@/app/dashboard/page"
import { motion, AnimatePresence } from "framer-motion"
import React, { useState, useEffect } from "react"
import { ArrowRight, Share, Zap, X, RefreshCcw, ExternalLink } from "lucide-react"
import { ShareModal } from "@/components/share-modal"
import { useUserProgress } from "@/hooks/useUserProgress"

// Адрес для ссылки на OpenSea (Фикс ошибки TS)
const DROID_COLLECTION_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

// === 1. ЭФФЕКТЫ (ВСПЫШКИ, ВОЛНЫ, КОНФЕТТИ) ===
const PixelConfetti = ({ isSuper = false }: { isSuper?: boolean }) => {
  const particles = Array.from({ length: 80 }).map((_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 20 + Math.random() * 40;
    const tx = Math.cos(angle) * velocity;
    const ty = Math.sin(angle) * velocity;
    const size = Math.random() * 8 + 4;
    const superColors = ['#FF4500', '#FFA500', '#FFD700', '#FFFFFF', '#FF6347'];
    const normalColors = ['#00BFFF', '#1E90FF', '#00FFFF', '#FFFFFF', '#4169E1'];
    const color = (isSuper ? superColors : normalColors)[Math.floor(Math.random() * superColors.length)];
    const duration = 0.8 + Math.random() * 1.2;
    const delay = Math.random() * 0.2;
    return { id: i, size, tx, ty, duration, delay, color, rotation: Math.random() * 720 };
  });

  return (
    <div className="absolute inset-0 pointer-events-none z-[100] flex items-center justify-center overflow-visible">
      <div className="fixed inset-0 animate-flash-bang pointer-events-none mix-blend-overlay z-[110]" style={{ background: 'radial-gradient(circle at center, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 60%)' }} />
      <div className={`absolute w-0 h-0 rounded-full border-[10px] animate-shockwave opacity-0 ${isSuper ? 'border-orange-500 shadow-[0_0_100px_#FF6B00]' : 'border-blue-500 shadow-[0_0_100px_3B82F6]'}`} />
      {particles.map((p) => (
        <div key={p.id} className="absolute animate-pixel-explode" style={{ width: `${p.size}px`, height: `${p.size}px`, backgroundColor: p.color, boxShadow: `0 0 ${p.size * 2}px ${p.color}`, borderRadius: '2px', '--tx': `${p.tx}vmin`, '--ty': `${p.ty}vmin`, '--rot': `${p.rotation}deg`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`, left: '50%', top: '50%' } as React.CSSProperties} />
      ))}
    </div>
  );
};

// === 2. СТИЛИ (ГЛИТЧ + ЦВЕТА) ===
const HARDCORE_GLITCH_STYLES = `
  @keyframes pixel-explode { 0% { opacity: 1; transform: translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(0.5); } 10% { opacity: 1; scale: 1.5; } 100% { opacity: 0; transform: translate(-50%, -50%) translate(var(--tx), calc(var(--ty) + 20vmin)) rotate(var(--rot)) scale(0); } }
  .animate-pixel-explode { animation: pixel-explode cubic-bezier(0.25, 1, 0.5, 1) forwards; }
  @keyframes shockwave-expand { 0% { width: 0; height: 0; opacity: 1; border-width: 50px; } 100% { width: 150vmin; height: 150vmin; opacity: 0; border-width: 0; } }
  .animate-shockwave { animation: shockwave-expand 0.6s ease-out forwards; transform: translate(-50%, -50%); left: 50%; top: 50%; }
  @keyframes flash-bang { 0% { opacity: 1; } 100% { opacity: 0; } }
  .animate-flash-bang { animation: flash-bang 0.5s ease-out forwards; }
  
  /* GLOW для Level Up (#3b82f6) */
  @keyframes glow-pulse { 
    0% { box-shadow: 0 0 5px rgba(59,130,246,0.2); border-color: rgba(59,130,246,0.2); } 
    50% { box-shadow: 0 0 25px rgba(59,130,246,0.5); border-color: rgba(59,130,246,0.6); } 
    100% { box-shadow: 0 0 5px rgba(59,130,246,0.2); border-color: rgba(59,130,246,0.2); } 
  }
  .animate-level-up { animation: glow-pulse 2s infinite ease-in-out; }

  /* Glitch Keyframes */
  @keyframes glitch-anim-1 { 0% { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); } 5% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } 10% { clip-path: inset(80% 0 5% 0); transform: translate(-5px, 0); } 15% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); } 20% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); } 25% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); } 30% { clip-path: inset(40% 0 40% 0); transform: translate(-5px, 0); } 35% { clip-path: inset(80% 0 10% 0); transform: translate(5px, 0); } 40% { clip-path: inset(20% 0 50% 0); transform: translate(-5px, 0); } 45% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 50% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); } 55% { clip-path: inset(70% 0 20% 0); transform: translate(5px, 0); } 60% { clip-path: inset(30% 0 60% 0); transform: translate(-5px, 0); } 65% { clip-path: inset(90% 0 5% 0); transform: translate(5px, 0); } 70% { clip-path: inset(15% 0 80% 0); transform: translate(-5px, 0); } 75% { clip-path: inset(55% 0 10% 0); transform: translate(5px, 0); } 80% { clip-path: inset(25% 0 50% 0); transform: translate(-5px, 0); } 85% { clip-path: inset(75% 0 15% 0); transform: translate(5px, 0); } 90% { clip-path: inset(10% 0 85% 0); transform: translate(-5px, 0); } 95% { clip-path: inset(45% 0 45% 0); transform: translate(5px, 0); } 100% { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); } }
  @keyframes glitch-anim-2 { 0% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } 5% { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); } 10% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); } 15% { clip-path: inset(70% 0 20% 0); transform: translate(-5px, 0); } 20% { clip-path: inset(10% 0 40% 0); transform: translate(5px, 0); } 25% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 30% { clip-path: inset(20% 0 70% 0); transform: translate(5px, 0); } 35% { clip-path: inset(90% 0 5% 0); transform: translate(-5px, 0); } 40% { clip-path: inset(30% 0 50% 0); transform: translate(5px, 0); } 45% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); } 50% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); } 55% { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); } 60% { clip-path: inset(40% 0 40% 0); transform: translate(5px, 0); } 65% { clip-path: inset(20% 0 70% 0); transform: translate(-5px, 0); } 70% { clip-path: inset(70% 0 15% 0); transform: translate(5px, 0); } 75% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); } 80% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 85% { clip-path: inset(25% 0 60% 0); transform: translate(-5px, 0); } 90% { clip-path: inset(85% 0 5% 0); transform: translate(5px, 0); } 95% { clip-path: inset(35% 0 50% 0); transform: translate(-5px, 0); } 100% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } }
  
  .glitch-wrapper { position: relative; width: 100%; height: 100%; }
  .glitch-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; }
  .intensity-1 .layer-1 { animation: glitch-anim-1 4s infinite step-end alternate-reverse; opacity: 0.3; }
  .intensity-1 .layer-2 { animation: glitch-anim-2 4s infinite step-end alternate-reverse; opacity: 0.3; }
  .intensity-2 .layer-1 { animation: glitch-anim-1 2s infinite step-end alternate-reverse; opacity: 0.7; }
  .intensity-2 .layer-2 { animation: glitch-anim-2 2s infinite step-end alternate-reverse; opacity: 0.7; }
  .intensity-3 .layer-1 { animation: glitch-anim-1 0.1s infinite step-end alternate-reverse; opacity: 1; }
  .intensity-3 .layer-2 { animation: glitch-anim-2 0.1s infinite step-end alternate-reverse; opacity: 1; }
`

const GlitchContainer = ({ children, intensity }: { children: React.ReactNode, intensity: 0 | 1 | 2 | 3 }) => {
  if (intensity === 0) return <>{children}</>
  return (
    <div className={`glitch-wrapper intensity-${intensity}`}>
      <div className="relative z-10 w-full h-full">{children}</div>
      <div className="glitch-layer layer-1 z-20 pointer-events-none" aria-hidden="true">{children}</div>
      <div className="glitch-layer layer-2 z-20 pointer-events-none" aria-hidden="true">{children}</div>
    </div>
  )
}

interface UpgradeMachineProps {
  selectedDroid: NFTItem | null
  selectedBattery: NFTItem | null
  onUpgrade: () => void
  onReset?: () => void
  isUpgrading: boolean
  newDroid?: NFTItem | null
  onShare?: () => void
  isSuperBattery?: boolean
  onRefreshInventory?: (isBackground?: boolean) => void
}

export function UpgradeMachine({ selectedDroid, selectedBattery, onUpgrade, onReset, isUpgrading, newDroid, onShare, isSuperBattery = false, onRefreshInventory }: UpgradeMachineProps) {
  const { level, xp, rank, progress, refetch } = useUserProgress()
  const [prevLevel, setPrevLevel] = useState(level)
  const isLevelUp = level > prevLevel

  const isReady = selectedDroid && selectedBattery
  const hasOneItem = (selectedDroid && !selectedBattery) || (!selectedDroid && selectedBattery)
  const [isNewImageLoaded, setIsNewImageLoaded] = useState(false)

  // === 1. ГЛУБОКИЙ СКАН УРОВНЯ (ЧТОБЫ ЛОВИТЬ ДРОИДОВ 2 ЛВЛ) ===
  const getDroidLevel = (item: NFTItem | null): number => {
    if (!item) return 1;

    // 1. Прямое свойство
    if (typeof item.level === 'number' && item.level > 0) return item.level;

    // 2. Поиск в traits/attributes (для данных с блокчейна или БД)
    // @ts-ignore
    const allTraits = [...(item.traits || []), ...(item.metadata?.attributes || []), ...(item.metadata?.traits || [])];

    // Ищем атрибуты, где может быть уровень
    const levelTrait = allTraits.find((t: any) => {
      const type = (t.trait_type || "").toLowerCase();
      return type === "level" || type === "rank value" || type === "upgrade level" || type === "rank";
    });

    if (levelTrait) {
      // Парсим число из значения (например "LVL 2" -> 2)
      const val = parseInt(String(levelTrait.value).replace(/\D/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }

    return 1; // Если ничего не нашли, считаем 1
  };

  const currentDroidLevel = getDroidLevel(selectedDroid);
  const isMaxLevel = currentDroidLevel >= 2;
  const [showMaxLevelAlert, setShowMaxLevelAlert] = useState(false)

  // Фиксация уровня
  useEffect(() => {
    if (!newDroid) {
      setIsNewImageLoaded(false)
      setPrevLevel(level)
    }
  }, [newDroid, level])

  const showSuccessScreen = newDroid && isNewImageLoaded

  // Обновление
  useEffect(() => {
    if (showSuccessScreen) {
      refetch(); // Обновляем прогресс юзера (XP)
      if (onRefreshInventory) {
        onRefreshInventory(true); // Мгновенно обновляем инвентарь (убираем сгоревшую батарейку) без мерцания
      }
    }
  }, [showSuccessScreen, refetch, onRefreshInventory])

  let glitchIntensity: 0 | 1 | 2 | 3 = 0
  if (isUpgrading || (newDroid && !isNewImageLoaded)) glitchIntensity = 3
  else if (isReady) glitchIntensity = 2
  else if (hasOneItem) glitchIntensity = 1

  let buttonText = "SELECT COMPONENTS"
  if (showSuccessScreen) buttonText = "COMPLETE"
  else if (isUpgrading || (newDroid && !isNewImageLoaded)) buttonText = "PROCESSING..."
  else if (isReady) {
    if (isMaxLevel) buttonText = "MAX LEVEL // OPTIONS"
    else buttonText = "START UPGRADE"
  }
  else if (selectedDroid && !selectedBattery) buttonText = "ADD BATTERY"
  else if (!selectedDroid && selectedBattery) buttonText = "ADD DROID"

  const isActive = (isReady && !isUpgrading) || showSuccessScreen;

  const handleMainAction = () => {
    if (isMaxLevel) {
      setShowMaxLevelAlert(true)
    } else {
      onUpgrade()
    }
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-start pt-4 md:pt-4 p-0 relative overflow-hidden">
      <style>{HARDCORE_GLITCH_STYLES}</style>

      {newDroid && !isNewImageLoaded && (
        <img src={newDroid.image} alt="Preload" className="absolute opacity-0 w-0 h-0" onLoad={() => setIsNewImageLoaded(true)} onError={() => setIsNewImageLoaded(true)} />
      )}

      {/* === MODAL: MAX LEVEL ALERT === */}
      <AnimatePresence>
        {showMaxLevelAlert && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowMaxLevelAlert(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-sm bg-[#0a0a0a] border border-white/20 rounded-2xl p-6 flex flex-col gap-4 text-center shadow-2xl">
              <div className="flex flex-col items-center gap-2">
                {/* Иконка #3b82f6 */}
                <Zap size={40} className="text-[#3b82f6] mb-2" />
                <h2 className="text-xl font-black text-white uppercase tracking-widest">Maximum Power</h2>
                <p className="text-gray-400 text-sm font-mono leading-relaxed">
                  This Droid has already reached Level 2. Further upgrades are not possible at this time.
                </p>
              </div>
              <div className="flex flex-col gap-3 w-full mt-2">
                {/* Кнопка Share - Синяя */}
                <button onClick={() => { if (onShare) onShare(); setShowMaxLevelAlert(false); }} className="w-full h-12 flex items-center justify-center gap-2 bg-white text-black font-black uppercase tracking-wider rounded-xl hover:bg-blue-600 hover:border-blue-600 hover:text-white transition-all shadow-lg text-sm">
                  <Share size={16} /> Share & Flex
                </button>
                {/* Кнопка Reset - Контурная */}
                <button onClick={() => { if (onReset) onReset(); setShowMaxLevelAlert(false); }} className="w-full h-12 flex items-center justify-center gap-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-xl hover:bg-white/10 transition-all text-sm">
                  <RefreshCcw size={16} /> Select Another
                </button>
                {/* Ссылка на детали (Безопасный адрес) */}
                <a href={`https://opensea.io/assets/apechain/${DROID_COLLECTION_ADDRESS}/${selectedDroid?.id || ""}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-white/40 hover:text-white uppercase tracking-widest flex items-center justify-center gap-1 mt-1 transition-colors">
                  View Details <ExternalLink size={10} />
                </a>
              </div>
              <button onClick={() => setShowMaxLevelAlert(false)} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={20} /></button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-[1200px] px-4 mb-4 md:mb-8 z-20 text-center">
        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-2">
          {showSuccessScreen ? "Upgrade Complete" : "Upgrade Your Droid"}
        </h1>
        <p className="text-gray-400 text-xs md:text-sm font-mono leading-relaxed max-w-2xl mx-auto px-4">
          {showSuccessScreen ? "Upgrade successful. Your Droid has evolved." : "Select your Droid and a Energy Battery to initiate the upgrade process."}
        </p>
      </div>

      <div className="relative w-full max-w-[1100px] flex flex-col items-center">
        <AnimatePresence mode="wait">
          {!showSuccessScreen ? (
            <motion.div key="upgrade-machine" initial={{ opacity: 0, y: 0 }} animate={{ opacity: 1, y: [-10, 10, -10], rotate: [-1, 1, -1] }} transition={{ y: { duration: 6, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 6, repeat: Infinity, ease: "easeInOut" } }} className="relative w-[140%] sm:w-[85%] aspect-video flex items-center justify-center z-10" >
              <GlitchContainer intensity={glitchIntensity}>
                <div className="relative w-full h-full flex items-center justify-center">
                  <img src="/Upgrader.jpg" alt="Upgrade Device" className="w-full h-full object-contain drop-shadow-[0_0_40px_rgba(0,0,0,0.8)] rounded-xl relative z-10" style={{ pointerEvents: 'none' }} />
                  {/* Battery Screen - mobile: adjusted, desktop: original */}
                  <div className="absolute z-20 flex items-center justify-center 
                    top-[28%] left-[22%] w-[16%] h-[22%]
                    sm:top-[28%] sm:left-[17.3%] sm:w-[20.5%] sm:h-[26%]"
                    style={{ mixBlendMode: 'screen', backgroundColor: 'black', transform: 'perspective(1500px) rotateY(30deg) rotateX(15deg) rotateZ(-5.7deg) skewX(1deg)', clipPath: 'inset(0 round 10px)', borderRadius: '10px', overflow: 'hidden' }}>
                    {selectedBattery ? <ScreenContent item={selectedBattery} rounded={true} /> : <span className="text-white/30 font-mono text-[8px] sm:text-[10px] md:text-sm animate-pulse tracking-widest">BATTERY</span>}
                  </div>
                  {/* Droid Screen - mobile: adjusted, desktop: original */}
                  <div className="absolute z-20 flex items-center justify-center
                    top-[17%] left-[48%] w-[24%] h-[31%]
                    sm:top-[16%] sm:left-[50.8%] sm:w-[26%] sm:h-[33%]"
                    style={{ mixBlendMode: 'screen', backgroundColor: 'black', transform: 'perspective(1600px) rotateY(-31deg) rotateX(14deg) rotateZ(5deg) skewY(-2.6deg)', clipPath: 'inset(0 round 10px)', borderRadius: '10px', overflow: 'hidden' }}>
                    {selectedDroid ? <ScreenContent item={selectedDroid} showName={true} rounded={true} /> : <span className="text-white/30 font-mono text-[10px] md:text-sm animate-pulse tracking-widest">DROID</span>}
                  </div>
                </div>
              </GlitchContainer>
            </motion.div>
          ) : (
            <motion.div key="success-machine" initial={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: [-10, 10, -10] }} className="relative w-[85%] aspect-video flex items-center justify-center z-10" >
              <div className="absolute top-[32%] left-[49%] w-0 h-0 z-50 flex items-center justify-center"><PixelConfetti isSuper={isSuperBattery} /></div>
              <img src="/Upgrader_Finish.jpg" alt="Upgrade Complete" className="w-full h-full object-contain rounded-xl" style={{ pointerEvents: 'none' }} />
              <div className="absolute z-20 flex items-center justify-center overflow-hidden" style={{ top: '16%', left: '36%', width: '26%', height: '33%', transform: 'perspective(1600px) rotateY(-7deg) rotateX(0deg) rotateZ(-2deg) skewX(-2deg) skewY(1.4deg)', clipPath: 'inset(0 round 14px)' }}>
                <ScreenContent item={newDroid} showName={true} isAnimated={true} opacity={1} rounded={true} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-2 md:bottom-4 z-30 w-full max-w-2xl px-4 flex flex-col gap-4">

        {/* === БЛОК ПРОГРЕССА (ЦВЕТ #3b82f6) === */}
        <AnimatePresence>
          {showSuccessScreen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-black/80 backdrop-blur-md border ${isLevelUp ? 'border-[#3b82f6] animate-level-up' : 'border-white/10'} rounded-2xl p-4 flex flex-col gap-2 shadow-2xl`}
            >
              <div className="flex justify-between items-end">
                <div className="flex flex-col gap-0.5">
                  <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isLevelUp ? 'text-[#3b82f6] animate-pulse' : 'text-white/40'}`}>
                    {isLevelUp ? 'RANK UPGRADED!' : 'PROGRESS UPDATED'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-white uppercase tracking-tight leading-none">{rank}</span>
                    <span className="text-[10px] font-bold text-[#3b82f6] bg-[#3b82f6]/10 px-2 py-0.5 rounded uppercase flex items-center gap-1">
                      <Zap size={10} fill="currentColor" /> LVL {level}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xl font-black text-[#3b82f6] leading-none">{new Intl.NumberFormat().format(xp)} XP</span>
                </div>
              </div>

              {/* Progress Bar (Цвет #3b82f6) */}
              <div className="relative w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                  className="h-full bg-[#3b82f6] shadow-[0_0_15px_rgba(59,130,246,0.6)]"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showSuccessScreen ? (
          <>
            {/* === КНОПКА SHARE (СИНИЙ HOVER: blue-600) === */}
            <button onClick={onShare} className="group relative w-full h-14 flex items-center justify-center gap-3 uppercase font-black tracking-widest text-base rounded-xl border-2 bg-white border-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] transition-all">
              Share & Flex Your Droid
              <Share size={18} strokeWidth={3} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button onClick={onReset} className="text-white/30 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] transition-colors py-2">Close & Continue</button>
          </>
        ) : (
          // === КНОПКА UPGRADE (СИНИЙ HOVER: blue-600) ===
          <button onClick={() => { if (isReady && !isUpgrading) handleMainAction() }} disabled={!(selectedDroid && selectedBattery) || isUpgrading} className={`group relative w-full h-12 md:h-14 flex items-center justify-center gap-3 uppercase font-black tracking-widest text-sm md:text-base rounded-xl border-2 transition-all duration-300 overflow-hidden shadow-2xl ${isActive ? "bg-white border-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] cursor-pointer" : "bg-white/5 text-white/30 border-white/10 cursor-default"}`}>
            {buttonText}
            {(isUpgrading || (newDroid && !isNewImageLoaded)) ? <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> : isReady ? <ArrowRight size={18} strokeWidth={3} className="group-hover:translate-x-1 transition-transform" /> : null}
          </button>
        )}
      </div>
      {newDroid && <ShareModal isOpen={false} onClose={() => { }} item={newDroid} />}
    </div>
  )
}

import { resolveImageUrl } from "@/lib/utils"

function ScreenContent({ item, showName = false, isAnimated = false, opacity = 0.9, rounded = false }: { item: NFTItem, showName?: boolean, isAnimated?: boolean, opacity?: number, rounded?: boolean }) {
  const imageUrl = resolveImageUrl(item.image)
  return (
    <div className="w-full h-full relative flex items-center justify-center">
      <img src={imageUrl} alt={item.name} className={`absolute inset-0 w-full h-full object-contain z-10 ${isAnimated ? 'animate-bounce-slow' : ''} ${rounded ? 'rounded-[12%]' : ''}`} style={{ imageRendering: 'pixelated', opacity: opacity }} />
      {showName && <div className="absolute bottom-[5%] left-0 right-0 flex justify-center z-20 px-1"><span className="font-mono text-white/90 bg-black/50 border border-white/20 tracking-wider backdrop-blur-sm rounded px-[6%] py-[1%] text-[0.8vw] md:text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[95%]">{item.name}</span></div>}
    </div>
  )
}