"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { UserLevelBadge } from "@/components/user-level-badge";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, apeChain } from "@/lib/thirdweb";
import { createWallet } from "thirdweb/wallets";
import { Menu, X, LayoutDashboard, Home, Battery, Grid2X2, Wallet, Zap, Wrench, ChevronDown, ChevronsUp, Coins } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { slideInLeft } from "@/lib/animations";
import { SOCIALS } from "@/lib/socials";
import { CardsIcon } from "@/components/icons/cards-icon";

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
];

interface HeaderProps {
  isDashboard?: boolean;
  onOpenProfile?: () => void;
  onOpenLeaderboard?: () => void;
}

type MenuKey = 'upgrade' | 'tools';

interface MenuItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}

interface MenuGroup {
  key: MenuKey;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  items: MenuItem[];
}

export function Header({ isDashboard = false, onOpenProfile, onOpenLeaderboard }: HeaderProps) {
  const account = useActiveAccount();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Какой из десктопных дропдаунов открыт ('upgrade' | 'tools' | null)
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [openMobileGroup, setOpenMobileGroup] = useState<MenuKey | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Page-context flags
  const isGamePage = pathname === '/glitch_game' || pathname === '/glitch_games/cards' || pathname === '/glitch_games/flight' || pathname === '/glitch_flight';
  const isGlitchGamesPage = pathname === '/glitch_games/cards';
  const isGridPage = pathname === '/grid';
  const isMergePage = pathname === '/merge_mechanism';
  const isMintPage = pathname === '/batteries_mint';
  const isUpgradePage = pathname === '/upgrade_module';
  const isHomePage = pathname === '/';
  const showDashboardNav = isGamePage || isGlitchGamesPage || isGridPage || isMergePage;

  const isAnyUpgradePage = isUpgradePage || isMintPage;
  const isAnyToolsPage = isMergePage || isGridPage;

  const closeMenu = () => setIsMenuOpen(false);

  // Close desktop dropdowns on outside-click + ESC + route change.
  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openMenu]);

  // Auto-close on route change (useful for both desktop dropdown + mobile drawer).
  useEffect(() => {
    setOpenMenu(null);
    setOpenMobileGroup(null);
    setIsMenuOpen(false);
  }, [pathname]);

  // Меню-группы — единый источник для десктопного дропдауна и мобильного
  // аккордеона. Upgrade = всё про прокачку дроида, Tools = утилиты.
  const MENUS: MenuGroup[] = [
    {
      key: 'upgrade',
      label: "Upgrade",
      Icon: ChevronsUp,
      active: isAnyUpgradePage,
      items: [
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
      ],
    },
    {
      key: 'tools',
      label: "Tools",
      Icon: Wrench,
      active: isAnyToolsPage,
      items: [
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
      ],
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
          ref={navRef}
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
                <CardsIcon size={21} className="text-[#A1A1AA] group-hover:text-white transition-colors" />
                <div className="absolute top-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
                  Glitch Cards
                </div>
              </motion.div>
            </Link>
          )}

          {/* Upgrade + Tools dropdowns — icon-only buttons */}
          {MENUS.map((menu) => {
            const isOpen = openMenu === menu.key;
            return (
              <div key={menu.key} className="relative">
                <motion.button
                  onClick={() => setOpenMenu(o => (o === menu.key ? null : menu.key))}
                  className={`flex items-center justify-center h-[48px] w-[48px] bg-black border rounded-xl transition-all duration-300 shadow-lg group cursor-pointer relative ${
                    menu.active || isOpen
                      ? 'border-white/30 bg-white/5'
                      : 'border-white/15 hover:bg-white/10 hover:border-white/30'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-label={menu.label}
                >
                  <menu.Icon size={20} className={`transition-colors ${menu.active || isOpen ? 'text-white' : 'text-[#A1A1AA] group-hover:text-white'}`} />
                  <ChevronDown size={10} className={`absolute bottom-1 right-1 transition-transform ${isOpen ? 'rotate-180 text-white' : 'text-[#A1A1AA] group-hover:text-white'}`} />
                  <div className="absolute top-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-10">
                    {menu.label}
                  </div>
                </motion.button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-[56px] min-w-[220px] bg-[#0a0a0a]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 p-2 z-50"
                      role="menu"
                    >
                      {menu.items.map((tool) => (
                        <Link
                          key={tool.href}
                          href={tool.href}
                          onClick={() => setOpenMenu(null)}
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
            );
          })}

          {/* Staking — placeholder until the mechanics ship. Deliberately not a
              link: it reads as present-but-not-yet rather than clickable. */}
          <div
            className="relative flex items-center gap-2 h-[48px] px-4 bg-black border border-white/10 rounded-xl shadow-lg cursor-not-allowed select-none"
            aria-disabled="true"
          >
            <Coins size={18} className="text-[#4d4d4d]" />
            <span className="text-sm font-bold text-[#5f5f5f]">Staking</span>
            {/* Floating badge rather than inline: it sat well on the corner and
                keeps the button's own row reading as one label. */}
            <span className="absolute -top-1.5 -right-1.5 px-1.5 py-[1px] rounded bg-[#3b82f6] text-white text-[8px] font-black uppercase tracking-wider leading-none">
              Soon
            </span>
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

                {/* Staking — not yet clickable */}
                <div className="flex items-center gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 rounded-xl opacity-70 cursor-not-allowed select-none">
                  <Coins size={18} className="text-[#4d4d4d]" />
                  <span className="text-white/70 font-medium text-sm">Staking</span>
                  <span className="ml-auto px-1.5 py-[2px] rounded bg-[#3b82f6] text-white text-[9px] font-black uppercase tracking-wider">Soon</span>
                </div>

                {/* 3. Glitch Games hub */}
                {!isGlitchGamesPage && (
                  <Link
                    href="/glitch_games/cards"
                    onClick={closeMenu}
                    className="flex items-center gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <CardsIcon size={19} className="text-[#A1A1AA]" />
                    <span className="text-white font-medium text-sm">Glitch Cards</span>
                  </Link>
                )}

                {/* 4. Upgrade + Tools — accordion sections */}
                {MENUS.map((menu) => {
                  const isOpen = openMobileGroup === menu.key;
                  return (
                    <div key={menu.key} className="flex flex-col gap-1.5 mt-1">
                      <button
                        onClick={() => setOpenMobileGroup(o => (o === menu.key ? null : menu.key))}
                        className={`flex items-center gap-3 w-full h-[52px] px-4 border rounded-xl transition-colors ${
                          menu.active || isOpen
                            ? 'bg-white/10 border-white/20'
                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                        }`}
                        aria-expanded={isOpen}
                      >
                        <menu.Icon size={18} className="text-[#A1A1AA]" />
                        <span className="text-white font-medium text-sm flex-1 text-left">{menu.label}</span>
                        <ChevronDown size={16} className={`text-white/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-1.5 pl-3 pt-1">
                              {menu.items.map(tool => (
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
                  );
                })}

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
                      <social.Icon className={social.name === "OpenSea" ? "w-5 h-5 opacity-40 hover:opacity-100 transition-opacity" : "w-5 h-5"} />
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
