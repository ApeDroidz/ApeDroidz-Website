"use client"

import { motion, AnimatePresence } from "framer-motion"
import { X, Zap, Share, RefreshCcw, ExternalLink, AlertTriangle, Info, CheckCircle } from "lucide-react"

interface AlertModalProps {
  isOpen: boolean
  onClose: () => void
  type?: 'success' | 'error' | 'info' | 'warning' | 'upgraded_droid' | 'max_level'
  title?: string
  message?: string
  autoClose?: number
  // Специальные пропсы для модалки Макс. Уровня
  onShare?: () => void
  onViewDetails?: () => void
  isSuper?: boolean
  buttons?: {
    label: string
    onClick: () => void
    variant?: 'primary' | 'secondary'
    color?: 'blue' | 'red' | 'green'
  }[]
}

export function AlertModal({
  isOpen,
  onClose,
  type = 'info',
  title,
  message,
  autoClose,
  onShare,
  onViewDetails,
  buttons
}: AlertModalProps) {

  // Авто-закрытие для тостов
  if (autoClose && isOpen) {
    setTimeout(onClose, autoClose)
  }

  // Рендер иконки в зависимости от типа
  const renderIcon = () => {
    switch (type) {
      case 'upgraded_droid':
      case 'max_level': // Поддержка обоих названий
        return <Zap size={48} className="text-[#3b82f6] drop-shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
      case 'success':
        return <CheckCircle size={48} className="text-green-500" />
      case 'error':
        return <AlertTriangle size={48} className="text-red-500" />
      case 'warning':
        return <AlertTriangle size={48} className="text-orange-500" />
      default:
        return <Info size={48} className="text-blue-500" />
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-sm bg-[#0a0a0a] border border-white/15 rounded-3xl p-8 flex flex-col gap-6 text-center shadow-[0_0_50px_rgba(0,0,0,0.8)]"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-white/30 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            {/* Header Content */}
            <div className="flex flex-col items-center gap-4">
              {renderIcon()}

              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-black text-white uppercase tracking-widest leading-none">
                  {title || "Notification"}
                </h2>
                {message && (
                  <p className="text-gray-400 text-sm font-mono leading-relaxed max-w-[90%] mx-auto">
                    {message}
                  </p>
                )}
              </div>
            </div>

            {/* === СПЕЦИАЛЬНЫЙ ЛЕЙАУТ ДЛЯ MAX LEVEL (как на скрине) === */}
            {(type === 'upgraded_droid' || type === 'max_level') ? (
              <div className="flex flex-col gap-3 w-full mt-2">

                {/* 1. КНОПКА SHARE (Белая, жирная) */}
                {onShare && (
                  <button
                    onClick={onShare}
                    className="w-full h-14 flex items-center justify-center gap-3 bg-white text-black font-black uppercase tracking-widest rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                  >
                    <Share size={18} strokeWidth={2.5} />
                    Share & Flex
                  </button>
                )}

                {/* 2. КНОПКА SELECT ANOTHER (Контурная) */}
                <button
                  onClick={onClose}
                  className="w-full h-14 flex items-center justify-center gap-3 border border-white/20 text-white font-bold uppercase tracking-widest rounded-xl hover:bg-white/5 hover:border-white/40 active:scale-[0.98] transition-all"
                >
                  <RefreshCcw size={18} />
                  Select Another
                </button>

                {/* 3. ССЫЛКА VIEW DETAILS (Мелкая снизу) */}
                {onViewDetails && (
                  <button
                    onClick={onViewDetails}
                    className="mt-2 text-[10px] font-mono text-white/30 hover:text-white uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    View Details <ExternalLink size={10} />
                  </button>
                )}
              </div>
            ) : (
              // === ОБЫЧНЫЕ КНОПКИ (Для ошибок и тостов) ===
              buttons && buttons.length > 0 && (
                <div className="flex gap-3 justify-center w-full mt-2">
                  {buttons.map((btn, idx) => (
                    <button
                      key={idx}
                      onClick={btn.onClick}
                      className={`
                        h-12 px-6 rounded-xl font-bold uppercase tracking-wider text-sm transition-all
                        ${btn.variant === 'secondary'
                          ? 'border border-white/20 hover:bg-white/10 text-white'
                          : 'bg-white text-black hover:bg-gray-200'}
                      `}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}