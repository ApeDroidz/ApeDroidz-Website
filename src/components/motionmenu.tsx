"use client"

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hand, Music, Radio, Crosshair, Footprints, Zap, X } from 'lucide-react';

interface MotionMenuProps {
  onSelect: (emotion: string) => void;
  activeEmotion: string | null;
  disabled: boolean;
}

// Animation variants
const menuContainer = {
  hidden: { opacity: 0, x: 30 },
  show: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1] as const,
      delay: 0.3,
      staggerChildren: 0.06,
      delayChildren: 0.4,
    },
  },
}

const menuItem = {
  hidden: { opacity: 0, x: 15, scale: 0.9 },
  show: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
  },
}

const titleVariant = {
  hidden: { opacity: 0, x: 20 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.2 },
  },
}

// Mobile FAB variants
const fabContainer = {
  hidden: { opacity: 0, scale: 0.8 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay: 0.5 },
  },
}

const mobileMenuContainer = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1] as const,
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    y: 20,
    transition: { duration: 0.2 },
  },
}

const mobileMenuItem = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function MotionMenu({ onSelect, activeEmotion, disabled }: MotionMenuProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuItems = [
    { id: 'Hello', icon: Hand, label: 'Hello' },
    { id: 'Dance', icon: Music, label: 'Dance' },
    { id: 'HipHop', icon: Radio, label: 'HipHop' },
    { id: 'Punch', icon: Crosshair, label: 'Punch' },
    { id: 'Kick', icon: Footprints, label: 'Kick' },
    { id: 'Attack', icon: Zap, label: 'Attack' },
  ];

  const handleMobileSelect = (id: string) => {
    onSelect(id);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* DESKTOP: Original menu (hidden on mobile) */}
      <div className={`
        hidden md:flex fixed right-8 top-1/2 -translate-y-1/2 z-50 flex-col items-end transition-opacity duration-300
        ${disabled ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}
      `}>
        <motion.h3
          className="uppercase mb-3 mr-1 font-mono text-white text-base font-normal tracking-wider"
          initial="hidden"
          animate="show"
          variants={titleVariant}
        >
          Moves
        </motion.h3>

        <motion.div
          className="flex flex-col gap-2 bg-black/30 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl shadow-black/50"
          initial="hidden"
          animate="show"
          variants={menuContainer}
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeEmotion === item.id;

            return (
              <motion.button
                key={item.id}
                variants={menuItem}
                onClick={() => onSelect(item.id)}
                disabled={disabled}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative p-3 rounded-xl transition-all duration-200 group
                  flex items-center justify-center cursor-pointer
                  ${isActive
                    ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.4)] scale-110 z-10'
                    : 'text-white/60 hover:text-white hover:bg-white/20'
                  }
                  ${disabled ? 'cursor-not-allowed' : ''}
                `}
              >
                <span className={`
                  absolute right-full mr-4 top-1/2 -translate-y-1/2
                  px-3 py-1.5 rounded-lg
                  bg-black/60 backdrop-blur-md border border-white/10
                  text-white text-xs font-medium tracking-wider uppercase
                  whitespace-nowrap pointer-events-none
                  transition-all duration-300
                  opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0
                `}>
                  {item.label}
                </span>

                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 2}
                  className="transition-transform duration-300 group-hover:scale-110 relative z-10"
                />
              </motion.button>
            );
          })}
        </motion.div>
      </div>

      {/* MOBILE: FAB + Expandable Menu */}
      <div className={`
        md:hidden fixed right-4 bottom-4 z-40 transition-opacity duration-300
        ${disabled ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}
      `}>
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              className="absolute bottom-16 right-0 flex flex-col gap-2 bg-black/90 backdrop-blur-xl p-2 rounded-2xl border border-white/15 shadow-2xl w-14 z-10"
              variants={mobileMenuContainer}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeEmotion === item.id;

                return (
                  <motion.button
                    key={item.id}
                    variants={mobileMenuItem}
                    onClick={() => handleMobileSelect(item.id)}
                    disabled={disabled}
                    className={`
                      flex items-center justify-center p-2.5 rounded-xl transition-all duration-200
                      ${isActive
                        ? 'bg-white text-black'
                        : 'text-white/80 hover:bg-white/10'
                      }
                    `}
                  >
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Label "MOVES" - hidden when menu open (popup covers it) */}
        <motion.div
          className={`absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-black uppercase tracking-widest text-white/50 pointer-events-none z-0 transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-0' : 'opacity-100'}`}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
        >
          MOVES
        </motion.div>

        {/* FAB Button */}
        <motion.button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          disabled={disabled}
          className={`
            flex items-center justify-center w-14 h-14 rounded-2xl
            border border-white/10 backdrop-blur-md transition-all duration-300
            ${isMobileMenuOpen
              ? 'bg-white text-black'
              : 'bg-black/80 text-white hover:bg-black'
            }
          `}
          variants={fabContainer}
          initial="hidden"
          animate="show"
          whileTap={{ scale: 0.9 }}
        >
          <AnimatePresence mode="wait">
            {isMobileMenuOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X size={24} className="text-current" />
              </motion.div>
            ) : (
              <motion.div
                key="open"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Zap size={24} className="text-current" fill="currentColor" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </>
  );
}