"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { UserLevelBadge } from "@/components/user-level-badge";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, apeChain } from "@/lib/thirdweb";
import { createWallet } from "thirdweb/wallets";
import { Menu, X, LayoutDashboard, Home, Battery, Grid2X2, Wallet, Zap, Gamepad2, Wrench, ChevronDown, ChevronsUp } from "lucide-react";
import { slideInLeft } from "@/lib/animations";

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
];

// Social links for burger menu
const SOCIALS = [
  {
    name: "X", url: "https://x.com/ApeDroidz", icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h.001Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )
  },
  {
    name: "Discord", url: "https://discord.com/invite/sFkkYyFZMj", icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    )
  },
  {
    name: "OpenSea", url: "https://opensea.io/collection/apedroidz", icon: (
      <img src="/Opensea.svg" alt="OS" className="w-5 h-5 opacity-40 hover:opacity-100 transition-opacity" />
    )
  },
];

interface HeaderProps {
  isDashboard?: boolean;
  onOpenProfile?: () => void;
  onOpenLeaderboard?: () => void;
}

export function Header({ isDashboard = false, onOpenProfile, onOpenLeaderboard }: HeaderProps) {
  const account = useActiveAccount();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);          // desktop dropdown
  const [isMobileToolsOpen, setIsMobileToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Page-context flags
  const isGamePage = pathname === '/glitch_game' || pathname === '/glitch_games/cards' || pathname === '/glitch_games/flight' || pathname === '/glitch_flight';
  const isGlitchGamesPage = pathname === '/glitch_games/cards';
  const isGridPage = pathname === '/grid';
  const isMergePage = pathname === '/merge_mechanism';
  const isMintPage = pathname === '/batteries_mint';
  const isUpgradePage = pathname === '/upgrade_module';
  const isHomePage = pathname === '/';
  const showDashboardNav = isGamePage || isGlitchGamesPage || isGridPage || isMergePage;

  // Tools = the "utility" pages (upgrade / mint / merge / grid)
  const isAnyToolsPage = isUpgradePage || isMintPage || isMergePage || isGridPage;

  const closeMenu = () => setIsMenuOpen(false);

  // Close desktop dropdown on outside-click + ESC + route change.
  useEffect(() => {
    if (!isToolsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsToolsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isToolsOpen]);

  // Auto-close on route change (useful for both desktop dropdown + mobile drawer).
  useEffect(() => {
    setIsToolsOpen(false);
    setIsMobileToolsOpen(false);
    setIsMenuOpen(false);
  }, [pathname]);

  // Tool entries — single source of truth so desktop dropdown + mobile section
  // stay in sync.
  const TOOLS: Array<{ href: string; label: string; icon: React.ReactNode; active: boolean }> = [
    {
      href: "/upgrade_module",
      label: "Upgrade Module",
      icon: <ChevronsUp size={18} className="text-[#A1A1AA] group-hover:text-white transition-colors" />,
      active: isUpgradePage,
    },
    {
      href: "/batteries_mint",
      label: "Mint Batteries",
      icon: <Battery size={18} className="-rotate-90 text-[#A1A1AA] group-hover:text-white transition-colors" />,
      active: isMintPage,
    },
    {
      href: "/merge_mechanism",
      label: "Merge Mechanism",
      icon: <Zap size={18} className="text-[#A1A1AA] group-hover:text-white transition-colors" />,
      active: isMergePage,
    },
    {
      href: "/grid",
      label: "Grid Maker",
      icon: <Grid2X2 size={18} className="text-[#A1A1AA] group-hover:text-white transition-colors" />,
      active: isGridPage,
    },
  ];

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-transparent py-4 px-4 lg:py-6 lg:px-6">
        {/* Logo */}
        <motion.div
          className="flex items-center h-full"
          initial="hidden"
          animate="show"
          variants={slideInLeft}
        >
          <Link href="/" className="flex items-center h-full cursor-pointer">
            <img
              src="/full-logo.svg"
              alt="ApeDroidz Logo"
              className="h-[32px] lg:h-[40px] w-auto transition-transform duration-300 ease-out hover:scale-105"
            />
          </Link>
        </motion.div>

        {/* DESKTOP Navigation */}
        <motion.div
          className="hidden lg:flex items-center gap-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          {/* Profile */}
          {account && onOpenProfile && (
            <UserLevelBadge onClick={onOpenProfile} />
          )}

          {/* Glitch Games — icon-only button, straight to the cards game */}
          {!isGlitchGamesPage && (
            <Link href="/glitch_games/cards">
              <motion.div
                className="flex items-center justify-center h-[48px] w-[48px] bg-black border border-white/15 rounded-xl hover:bg-white/10 hover:border-white/30 transition-all duration-300 shadow-lg group cursor-pointer relative"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Gamepad2 size={20} className="text-[#A1A1AA] group-hover:text-white transition-colors" />
                <div className="absolute top-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
                  Games
                </div>
              </motion.div>
            </Link>
          )}

          {/* Tools dropdown — icon-only button */}
          <div ref={toolsRef} className="relative">
            <motion.button
              onClick={() => setIsToolsOpen(o => !o)}
              className={`flex items-center justify-center h-[48px] w-[48px] bg-black border rounded-xl transition-all duration-300 shadow-lg group cursor-pointer relative ${
                isAnyToolsPage || isToolsOpen
                  ? 'border-white/30 bg-white/5'
                  : 'border-white/15 hover:bg-white/10 hover:border-white/30'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-haspopup="menu"
              aria-expanded={isToolsOpen}
              aria-label="Tools"
            >
              <Wrench size={20} className={`transition-colors ${isAnyToolsPage || isToolsOpen ? 'text-white' : 'text-[#A1A1AA] group-hover:text-white'}`} />
              <ChevronDown size={10} className={`absolute bottom-1 right-1 transition-transform ${isToolsOpen ? 'rotate-180 text-white' : 'text-[#A1A1AA] group-hover:text-white'}`} />
              <div className="absolute top-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
                Tools
              </div>
            </motion.button>

            <AnimatePresence>
              {isToolsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-[56px] min-w-[220px] bg-[#0a0a0a]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 p-2 z-50"
                  role="menu"
                >
                  {TOOLS.map((tool) => (
                    <Link
                      key={tool.href}
                      href={tool.href}
                      onClick={() => setIsToolsOpen(false)}
                      className={`group flex items-center gap-3 w-full h-[44px] px-3 rounded-xl transition-colors ${
                        tool.active
                          ? 'bg-[#3b82f6]/10 text-white border border-[#3b82f6]/30'
                          : 'text-white/80 hover:bg-white/5 hover:text-white border border-transparent'
                      }`}
                      role="menuitem"
                    >
                      {tool.icon}
                      <span className="text-sm font-medium">{tool.label}</span>
                      {tool.active && <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-[#3b82f6]">Active</span>}
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Dashboard — primary white button on the home page, dark elsewhere;
              on the dashboard page itself it's the "Back to Menu" home icon */}
          {!isDashboard ? (
            <Link href="/dashboard" className="outline-none focus:outline-none focus-visible:outline-none rounded-xl" draggable={false}>
              <motion.div
                className={`flex items-center gap-2 h-[48px] px-4 rounded-xl transition-all duration-300 shadow-lg group cursor-pointer ${
                  isHomePage
                    ? 'bg-white border border-transparent hover:bg-[#0069FF]'
                    : 'bg-black border border-white/15 hover:bg-white/10 hover:border-white/30'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <LayoutDashboard size={18} className={`transition-colors ${isHomePage ? 'text-black group-hover:text-white' : 'text-[#A1A1AA] group-hover:text-white'}`} />
                <span className={`text-sm font-bold transition-colors ${isHomePage ? 'text-black group-hover:text-white' : 'text-[#A1A1AA] group-hover:text-white'}`}>Dashboard</span>
              </motion.div>
            </Link>
          ) : (
            <Link href="/" className="outline-none focus:outline-none focus-visible:outline-none rounded-xl" draggable={false}>
              <motion.div
                className="flex items-center justify-center h-[48px] w-[48px] bg-black border border-white/15 rounded-xl hover:bg-white/10 hover:border-white/30 transition-all duration-300 shadow-lg group cursor-pointer relative"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Home size={20} className="text-[#A1A1AA] group-hover:text-white transition-colors" />
                <div className="absolute top-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
                  Back to Menu
                </div>
              </motion.div>
            </Link>
          )}

          {!account && (
            <ConnectButton
              client={client}
              chain={apeChain}
              wallets={wallets}
              theme="dark"
              connectButton={{
                label: "Connect Wallet",
                className: `
                  !bg-white !text-black !font-bold !rounded-xl
                  !h-[48px] !px-8 !text-base
                  !border !border-transparent !transition-all !duration-300
                  hover:!bg-[#0069FF] hover:!text-white hover:!border-transparent
                `,
              }}
              connectModal={{
                size: "compact",
                title: "ApeDroidz Access",
                showThirdwebBranding: false,
              }}
            />
          )}
        </motion.div>

        {/* MOBILE Burger Button */}
        <motion.button
          className="lg:hidden flex items-center justify-center h-[44px] w-[44px] bg-black/80 border border-white/15 rounded-xl"
          onClick={() => setIsMenuOpen(true)}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <Menu size={22} className="text-white" />
        </motion.button>
      </header>

      {/* MOBILE Menu Drawer */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[299] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMenu}
            />

            {/* Drawer */}
            <motion.div
              className="fixed top-0 right-0 bottom-0 w-[300px] bg-[#0a0a0a] border-l border-white/10 z-[300] lg:hidden flex flex-col shadow-2xl overflow-y-auto"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              {/* Close Button */}
              <div className="flex justify-end p-4">
                <button
                  onClick={closeMenu}
                  className="flex items-center justify-center h-[44px] w-[44px] bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                >
                  <X size={22} className="text-white" />
                </button>
              </div>

              {/* Menu Content */}
              <div className="flex-1 flex flex-col gap-3 px-4 pb-6">
                {/* 1. Profile / Connect */}
                {account && onOpenProfile && (
                  <button
                    onClick={() => { onOpenProfile(); closeMenu(); }}
                    className="w-full"
                  >
                    <UserLevelBadge onClick={() => { }} className="!w-full !h-[52px] !bg-white/5 hover:!bg-white/10 !border-white/10" />
                  </button>
                )}
                {!account && (
                  <div className="relative w-full">
                    <Wallet size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A1A1AA] z-10 pointer-events-none" />
                    <ConnectButton
                      client={client}
                      chain={apeChain}
                      wallets={wallets}
                      theme="dark"
                      connectButton={{
                        label: "Connect Wallet",
                        className: `
                          !w-full !bg-white/5 !text-white !font-medium !rounded-xl
                          !h-[52px] !text-sm !justify-start !pl-11 !pr-4
                          !border !border-white/10 hover:!bg-white/10
                        `,
                      }}
                      connectModal={{
                        size: "compact",
                        title: "ApeDroidz Access",
                        showThirdwebBranding: false,
                      }}
                    />
                  </div>
                )}

                {/* 2. Dashboard / Back */}
                {!isDashboard ? (
                  <Link
                    href="/dashboard"
                    onClick={closeMenu}
                    className="flex items-center justify-start gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 text-white font-medium text-sm rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <LayoutDashboard size={18} className="text-[#A1A1AA]" />
                    Go to Dashboard
                  </Link>
                ) : (
                  <Link
                    href="/"
                    onClick={closeMenu}
                    className="flex items-center gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 text-white font-medium text-sm rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <Home size={18} className="text-[#A1A1AA]" />
                    Back to Menu
                  </Link>
                )}

                {/* 3. Glitch Games hub */}
                {!isGlitchGamesPage && (
                  <Link
                    href="/glitch_games/cards"
                    onClick={closeMenu}
                    className="flex items-center gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <Gamepad2 size={18} className="text-[#A1A1AA]" />
                    <span className="text-white font-medium text-sm">Glitch Games</span>
                  </Link>
                )}

                {/* 4. Tools — accordion section */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <button
                    onClick={() => setIsMobileToolsOpen(o => !o)}
                    className={`flex items-center gap-3 w-full h-[52px] px-4 border rounded-xl transition-colors ${
                      isAnyToolsPage || isMobileToolsOpen
                        ? 'bg-white/10 border-white/20'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    aria-expanded={isMobileToolsOpen}
                  >
                    <Wrench size={18} className="text-[#A1A1AA]" />
                    <span className="text-white font-medium text-sm flex-1 text-left">Tools</span>
                    <ChevronDown size={16} className={`text-white/60 transition-transform ${isMobileToolsOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {isMobileToolsOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-1.5 pl-3 pt-1">
                          {TOOLS.map(tool => (
                            <Link
                              key={tool.href}
                              href={tool.href}
                              onClick={closeMenu}
                              className={`flex items-center gap-3 w-full h-[44px] px-3 rounded-xl transition-colors border ${
                                tool.active
                                  ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30 text-white'
                                  : 'bg-white/[0.025] border-white/5 hover:bg-white/10 text-white/80'
                              }`}
                            >
                              {tool.icon}
                              <span className="text-sm font-medium">{tool.label}</span>
                              {tool.active && <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-[#3b82f6]">Active</span>}
                            </Link>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Divider */}
                <div className="h-px bg-white/10 mt-4 mb-2" />

                {/* Social Links */}
                <div className="flex items-center justify-center gap-3">
                  {SOCIALS.map((social) => (
                    <Link
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-[44px] h-[44px] bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors text-[#71717A] hover:text-white"
                      title={social.name}
                    >
                      {social.icon}
                    </Link>
                  ))}
                </div>

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
