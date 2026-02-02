"use client"

import { useState, useEffect } from "react"

interface NFTImageSkeletonProps {
  src?: string | null // разрешаем null/undefined
  alt: string
  className?: string
}

export function NFTImageSkeleton({ src, alt, className = "" }: NFTImageSkeletonProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setIsLoading(true)
    setHasError(false)
  }, [src])

  // ЛОГИКА ИЗМЕНЕНА:
  // Если src нет (фейковая загрузка), мы НЕ показываем "Empty Slot".
  // Мы просто рендерим блок с isLoading = true (прелоадер).
  const shouldShowLoader = isLoading || !src

  return (
    <div className={`relative w-full h-full ${className} rounded-lg overflow-hidden bg-[#0a0a0a]`}>

      {/* === LOADING STATE (Показываем, если грузится ИЛИ если нет src) === */}
      {shouldShowLoader && (
        <div className="absolute inset-0 z-20 bg-[#1a1a1a] flex items-center justify-center">
          {/* 1. Шиммер-блик */}
          <div
            className="absolute inset-0 z-10 bg-gradient-to-r from-transparent via-white/5 to-transparent"
            style={{
              transform: 'skewX(-20deg) translateX(-150%)',
              animation: 'shimmer 1.5s infinite linear'
            }}
          />

          {/* 2. Прелоадер */}
          <div className="relative z-20">
            <svg
              className="animate-spin h-6 w-6 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-10" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        </div>
      )}

      {/* === ERROR STATE === */}
      {hasError && !shouldShowLoader && (
        <div className="absolute inset-0 z-10 bg-[#0a0a0a] flex flex-col items-center justify-center border border-white/5">
          <span className="text-white/40 text-[10px] font-mono uppercase tracking-[0.2em] animate-pulse">
            No Signal
          </span>
        </div>
      )}

      {/* === IMAGE === */}
      {src && (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-500 ${shouldShowLoader ? 'opacity-0' : 'opacity-100'}`}
          style={{ imageRendering: 'pixelated' }}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false)
            setHasError(true)
          }}
        />
      )}

      <style jsx>{`
        @keyframes shimmer {
          100% {
            transform: skewX(-20deg) translateX(250%);
          }
        }
      `}</style>
    </div>
  )
}