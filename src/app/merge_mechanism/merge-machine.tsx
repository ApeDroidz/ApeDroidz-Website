"use client"

import { motion, AnimatePresence } from "framer-motion"
import React, { useState, useEffect } from "react"
import { Zap, ArrowRight, RefreshCcw } from "lucide-react"

// === GLITCH + ANIMATION STYLES ===
const MERGE_GLITCH_STYLES = `
  /* Particle explosion animation */
  @keyframes pixel-explode { 
    0% { opacity: 1; transform: translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(0.5); } 
    10% { opacity: 1; scale: 1.5; } 
    100% { opacity: 0; transform: translate(-50%, -50%) translate(var(--tx), calc(var(--ty) + 20vmin)) rotate(var(--rot)) scale(0); } 
  }
  .animate-pixel-explode { animation: pixel-explode cubic-bezier(0.25, 1, 0.5, 1) forwards; }
  
  @keyframes shockwave-expand { 
    0% { width: 0; height: 0; opacity: 1; border-width: 50px; } 
    100% { width: 150vmin; height: 150vmin; opacity: 0; border-width: 0; } 
  }
  .animate-shockwave { animation: shockwave-expand 0.6s ease-out forwards; transform: translate(-50%, -50%); left: 50%; top: 50%; }
  
  @keyframes flash-bang { 0% { opacity: 1; } 100% { opacity: 0; } }
  .animate-flash-bang { animation: flash-bang 0.5s ease-out forwards; }

  /* Glitch Keyframes */
  @keyframes glitch-anim-1 { 
    0% { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); } 
    20% { clip-path: inset(60% 0 20% 0); transform: translate(5px, 0); } 
    40% { clip-path: inset(10% 0 85% 0); transform: translate(-5px, 0); } 
    60% { clip-path: inset(80% 0 10% 0); transform: translate(5px, 0); } 
    80% { clip-path: inset(30% 0 50% 0); transform: translate(-5px, 0); } 
    100% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 
  }
  @keyframes glitch-anim-2 { 
    0% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } 
    20% { clip-path: inset(70% 0 15% 0); transform: translate(-5px, 0); } 
    40% { clip-path: inset(40% 0 40% 0); transform: translate(5px, 0); } 
    60% { clip-path: inset(20% 0 70% 0); transform: translate(-5px, 0); } 
    80% { clip-path: inset(85% 0 5% 0); transform: translate(5px, 0); } 
    100% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); } 
  }
  
  .glitch-wrapper { position: relative; width: 100%; height: 100%; }
  .glitch-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; }
  
  /* 5 Intensity levels for 20 batteries */
  .intensity-1 .layer-1 { animation: glitch-anim-1 4s infinite step-end alternate-reverse; opacity: 0.2; }
  .intensity-1 .layer-2 { animation: glitch-anim-2 4s infinite step-end alternate-reverse; opacity: 0.2; }
  .intensity-2 .layer-1 { animation: glitch-anim-1 2s infinite step-end alternate-reverse; opacity: 0.4; }
  .intensity-2 .layer-2 { animation: glitch-anim-2 2s infinite step-end alternate-reverse; opacity: 0.4; }
  .intensity-3 .layer-1 { animation: glitch-anim-1 0.5s infinite step-end alternate-reverse; opacity: 0.6; }
  .intensity-3 .layer-2 { animation: glitch-anim-2 0.5s infinite step-end alternate-reverse; opacity: 0.6; }
  .intensity-4 .layer-1 { animation: glitch-anim-1 0.2s infinite step-end alternate-reverse; opacity: 0.8; }
  .intensity-4 .layer-2 { animation: glitch-anim-2 0.2s infinite step-end alternate-reverse; opacity: 0.8; }
  .intensity-5 .layer-1 { animation: glitch-anim-1 0.1s infinite step-end alternate-reverse; opacity: 1; }
  .intensity-5 .layer-2 { animation: glitch-anim-2 0.1s infinite step-end alternate-reverse; opacity: 1; }

  /* Success image animation */
  @keyframes float-gentle {
    0%, 100% { transform: scale(1) translateY(0); }
    50% { transform: scale(1.02) translateY(-5px); }
  }
  .animate-float-gentle { animation: float-gentle 3s ease-in-out infinite; }
`

// Confetti effect component - orange themed
const PixelConfetti = () => {
    const particles = Array.from({ length: 80 }).map((_, i) => {
        const angle = Math.random() * Math.PI * 2
        const velocity = 20 + Math.random() * 40
        const tx = Math.cos(angle) * velocity
        const ty = Math.sin(angle) * velocity
        const size = Math.random() * 8 + 4
        const colors = ['#FF7700', '#FF9933', '#FFBB66', '#FFFFFF', '#FF5500']
        const color = colors[Math.floor(Math.random() * colors.length)]
        const duration = 0.8 + Math.random() * 1.2
        const delay = Math.random() * 0.2
        return { id: i, size, tx, ty, duration, delay, color, rotation: Math.random() * 720 }
    })

    return (
        <div className="absolute inset-0 pointer-events-none z-[100] flex items-center justify-center overflow-visible">
            <div className="fixed inset-0 animate-flash-bang pointer-events-none mix-blend-overlay z-[110]"
                style={{ background: 'radial-gradient(circle at center, rgba(255,119,0,0.8) 0%, rgba(255,119,0,0) 60%)' }} />
            <div className="absolute w-0 h-0 rounded-full border-[10px] animate-shockwave opacity-0 border-[#FF7700] shadow-[0_0_100px_#FF7700]" />
            {particles.map((p) => (
                <div key={p.id} className="absolute animate-pixel-explode"
                    style={{
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        backgroundColor: p.color,
                        boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
                        borderRadius: '2px',
                        '--tx': `${p.tx}vmin`,
                        '--ty': `${p.ty}vmin`,
                        '--rot': `${p.rotation}deg`,
                        animationDuration: `${p.duration}s`,
                        animationDelay: `${p.delay}s`,
                        left: '50%',
                        top: '50%'
                    } as React.CSSProperties} />
            ))}
        </div>
    )
}

// Glitch container with intensity levels
const GlitchContainer = ({ children, intensity }: { children: React.ReactNode, intensity: 0 | 1 | 2 | 3 | 4 | 5 }) => {
    if (intensity === 0) return <>{children}</>
    return (
        <div className={`glitch-wrapper intensity-${intensity}`}>
            <div className="relative z-10 w-full h-full">{children}</div>
            <div className="glitch-layer layer-1 z-20 pointer-events-none" aria-hidden="true">{children}</div>
            <div className="glitch-layer layer-2 z-20 pointer-events-none" aria-hidden="true">{children}</div>
        </div>
    )
}

// Progress bar for batteries — 20 cells, orange
const ProgressBar = ({ filledCount }: { filledCount: number }) => {
    return (
        <div className="flex flex-row gap-[3px] w-full max-w-[320px] sm:max-w-[360px] md:max-w-[400px] lg:max-w-[440px] h-8 sm:h-10 bg-white/5 rounded-lg border border-white/10 p-1">
            {Array.from({ length: 20 }).map((_, i) => {
                const isFilled = i < filledCount
                return (
                    <motion.div
                        key={i}
                        initial={false}
                        animate={{
                            backgroundColor: isFilled ? '#FF7700' : 'rgba(255,255,255,0.1)',
                            boxShadow: isFilled ? '0 0 8px #FF7700' : 'none'
                        }}
                        transition={{ duration: 0.15 }}
                        className={`flex-1 h-full rounded-sm border ${isFilled ? 'border-orange-400' : 'border-white/10'}`}
                    />
                )
            })}
        </div>
    )
}

// Progress bar for shards — 30 cells, blue
const ShardProgressBar = ({ filledCount }: { filledCount: number }) => {
    return (
        <div className="flex flex-row gap-[2px] w-full max-w-[320px] sm:max-w-[360px] md:max-w-[400px] lg:max-w-[440px] h-7 sm:h-9 bg-white/5 rounded-lg border border-white/10 p-1">
            {Array.from({ length: 30 }).map((_, i) => {
                const isFilled = i < filledCount
                return (
                    <motion.div
                        key={i}
                        initial={false}
                        animate={{
                            backgroundColor: isFilled ? '#0069FF' : 'rgba(255,255,255,0.1)',
                            boxShadow: isFilled ? '0 0 6px #0069FF' : 'none'
                        }}
                        transition={{ duration: 0.1 }}
                        className={`flex-1 h-full rounded-sm border ${isFilled ? 'border-blue-400' : 'border-white/10'}`}
                    />
                )
            })}
        </div>
    )
}

interface MergeMachineProps {
    mode: 'batteries' | 'shards'
    selectedCount: number
    isReady: boolean
    isMerging: boolean
    mergeSuccess: boolean
    onStartMerge: () => void
    onReset: () => void
    targetImageUrl?: string | null
}

export function MergeMachine({
    mode,
    selectedCount,
    isReady,
    isMerging,
    mergeSuccess,
    onStartMerge,
    onReset,
    targetImageUrl,
}: MergeMachineProps) {
    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 640)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const isShards = mode === 'shards'
    const requiredCount = isShards ? 30 : 20
    const accentColor = isShards ? '#a855f7' : '#FF7700'

    // Calculate glitch intensity
    const getGlitchIntensity = (): 0 | 1 | 2 | 3 | 4 | 5 => {
        if (isMerging) return 5
        if (selectedCount === 0) return 0
        const pct = selectedCount / requiredCount
        if (pct <= 0.25) return 1
        if (pct <= 0.5) return 2
        if (pct <= 0.75) return 3
        if (pct < 1) return 4
        return 5
    }

    // Calculate brightness (0.2 → 1.0)
    const getBrightness = () => {
        if (mergeSuccess) return 1
        return 0.2 + (selectedCount / requiredCount) * 0.8
    }

    // Button label
    const required = isShards ? 30 : 20
    let buttonText = `0/${required} SELECTED`
    if (mergeSuccess) buttonText = "MERGE COMPLETE"
    else if (isMerging) buttonText = "MERGING..."
    else if (isReady) buttonText = isShards ? "START SHARD MERGE" : "START MERGE"
    else if (selectedCount > 0) buttonText = `${selectedCount}/${required} SELECTED`

    const isButtonActive = isReady && !isMerging && !mergeSuccess

    return (
        <div className="w-full h-full flex flex-col items-center justify-between p-4 sm:p-6 relative overflow-hidden">
            <style>{MERGE_GLITCH_STYLES}</style>

            {/* Header */}
            <div className="w-full max-w-[1200px] px-4 z-20 text-center flex-shrink-0 mb-4 sm:mb-0">
                <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black uppercase tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-1 sm:mb-2">
                    {mergeSuccess ? (isShards ? 'Battery Acquired!' : 'Merge Complete') : 'Merge Mechanism'}
                </h1>
                <p className="text-gray-400 text-xs sm:text-sm font-mono leading-relaxed max-w-2xl mx-auto">
                    {mergeSuccess
                        ? (isShards ? 'You received a Standard Battery in exchange for 30 Energy Shards.' : 'Congratulations! You have received a SUPER BATTERY.')
                        : (isShards ? 'Select 30 Energy Shards to merge into 1 Standard Battery.' : 'Select 20 Standard Batteries to merge into 1 Super Battery.')}
                </p>
            </div>

            {/* Main content - centered in remaining space */}
            <div className="relative w-full max-w-[900px] flex-1 flex flex-col items-center justify-center">
                <AnimatePresence mode="wait">
                    {!mergeSuccess ? (
                        <motion.div
                            key="merge-machine"
                            initial={{ opacity: 0 }}
                            animate={isMobile
                                ? { opacity: 1 }
                                : { opacity: 1, y: [-5, 5, -5] }
                            }
                            transition={isMobile
                                ? { duration: 0.5 }
                                : { y: { duration: 4, repeat: Infinity, ease: "easeInOut" } }
                            }
                            className="relative flex items-center justify-center gap-6 w-full px-4"
                        >
                            <GlitchContainer intensity={getGlitchIntensity()}>
                                <div className="flex flex-col items-center justify-center gap-4 sm:gap-5 md:gap-6">
                                    {/* Target image */}
                                    <div className="relative">
                                        <div
                                            className="w-56 h-56 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 rounded-2xl overflow-hidden border-2 border-white/20 bg-black/50 backdrop-blur-md transition-all duration-300"
                                            style={{
                                                filter: `brightness(${getBrightness()})`,
                                                boxShadow: selectedCount > 0 ? `0 0 ${selectedCount * 2}px ${accentColor}${Math.round((selectedCount / requiredCount) * 66).toString(16).padStart(2, '0')}` : 'none'
                                            }}
                                        >
                                            <img
                                                src={isShards
                                                    ? (targetImageUrl || 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/super_battery.webp')
                                                    : 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/super_battery.webp'
                                                }
                                                alt={isShards ? 'Standard Battery' : 'Super Battery'}
                                                className="w-full h-full object-contain"
                                                style={{ imageRendering: 'pixelated' }}
                                            />
                                        </div>

                                        {selectedCount > 0 && (
                                            <div
                                                className="absolute inset-0 pointer-events-none rounded-2xl"
                                                style={{
                                                    background: `linear-gradient(to right, ${accentColor}${Math.round((selectedCount / requiredCount) * 0.4 * 255).toString(16).padStart(2, '0')} ${(selectedCount / requiredCount) * 100}%, transparent ${(selectedCount / requiredCount) * 100}%)`,
                                                    mixBlendMode: 'overlay'
                                                }}
                                            />
                                        )}
                                    </div>

                                    {/* Progress Bar */}
                                    {isShards
                                        ? <ShardProgressBar filledCount={selectedCount} />
                                        : <ProgressBar filledCount={selectedCount} />
                                    }
                                </div>
                            </GlitchContainer>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
                            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                            className="relative flex flex-col items-center justify-center gap-6 w-full px-4"
                        >
                            <PixelConfetti />

                            {/* Success */}
                            <div className="relative animate-float-gentle">
                                <div className={`w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-96 lg:h-96 rounded-2xl overflow-hidden border-2 bg-black/50 backdrop-blur-md ${isShards
                                    ? 'border-purple-500/50 shadow-[0_0_40px_rgba(168,85,247,0.4)]'
                                    : 'border-[#FF7700]/50 shadow-[0_0_40px_rgba(255,119,0,0.4)]'
                                    }`}>
                                    <img
                                        src={isShards
                                            ? (targetImageUrl || 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/super_battery.webp')
                                            : 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/super_battery.webp'
                                        }
                                        alt={isShards ? 'Standard Battery' : 'Super Battery'}
                                        className="w-full h-full object-contain"
                                        style={{ imageRendering: 'pixelated' }}
                                    />
                                </div>
                                <div className={`absolute -top-4 -right-4 w-12 h-12 rounded-full flex items-center justify-center ${isShards
                                    ? 'bg-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.6)]'
                                    : 'bg-[#FF7700] shadow-[0_0_20px_rgba(255,119,0,0.6)]'
                                    }`}>
                                    <Zap size={24} className="text-white" fill="white" />
                                </div>
                            </div>

                            <div className="text-center">
                                <h2 className={`text-2xl md:text-3xl font-black uppercase tracking-wider mb-2 ${isShards ? 'text-purple-400' : 'text-[#FF7700]'
                                    }`}>
                                    {isShards ? 'Standard Battery Acquired!' : 'Super Battery Acquired!'}
                                </h2>
                                <p className="text-white/60 text-sm font-mono">
                                    {isShards
                                        ? 'Your 30 shards have been merged into a Standard Battery.'
                                        : 'Your battery has been upgraded successfully.'}
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Action Button - fixed at bottom with proper spacing */}
            <div className="w-full max-w-md px-4 pb-2 flex flex-col gap-3 flex-shrink-0">
                {mergeSuccess ? (
                    <>
                        <button
                            onClick={onReset}
                            className="group relative w-full h-14 flex items-center justify-center gap-3 uppercase font-black tracking-widest text-base rounded-xl border-2 bg-white border-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all"
                        >
                            <RefreshCcw size={18} />
                            Merge Another
                        </button>
                    </>
                ) : (
                    <button
                        onClick={onStartMerge}
                        disabled={!isButtonActive}
                        className={`group relative w-full h-12 md:h-14 flex items-center justify-center gap-3 uppercase font-black tracking-widest text-sm md:text-base rounded-xl border-2 transition-all duration-300 overflow-hidden shadow-2xl
                            ${isButtonActive
                                ? "bg-white border-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] cursor-pointer"
                                : "bg-white/5 text-white/30 border-white/10 cursor-default"}`}
                    >
                        {buttonText}
                        {isMerging ? (
                            <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                        ) : isButtonActive ? (
                            <ArrowRight size={18} strokeWidth={3} className="group-hover:translate-x-1 transition-transform" />
                        ) : null}
                    </button>
                )}
            </div>
        </div>
    )
}
