"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { UserLevelBadge } from "@/components/user-level-badge";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, apeChain } from "@/lib/thirdweb";
import { createWallet } from "thirdweb/wallets";
import { Menu, X, Wallet, ChevronDown } from "lucide-react";
import { slideInLeft } from "@/lib/animations";
import { SOCIALS } from "@/lib/socials";

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

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

// Единый источник навигации для десктопа и мобильного меню.
const NAV_GROUPS: NavGroup[] = [
  {
    key: "upgrade",
    label: "Upgrade",
    items: [
      { href: "/upgrade_module", label: "Upgrade Module" },
      { href: "/batteries_mint", label: "Mint Batteries" },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    items: [
      { href: "/merge_mechanism", label: "Merge Mechanism" },
      { href: "/grid", label: "Grid Maker" },
    ],
  },
];

const DIRECT_LINKS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/glitch_games/cards", label: "Glitch Cards" },
];

// Общая «стеклянная» плашка — тот же фрейм, что у панелей дашборда.
const FRAME = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md";

export function Header({ isDashboard = false, onOpenProfile, onOpenLeaderboard }: HeaderProps) {
  const account = useActiveAccount();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => setIsMenuOpen(false);
  const isActive = (href: string) => pathname === href;
  const groupIsActive = (g: NavGroup) => g.items.some((i) => isActive(i.href));

  // Закрываем дропдауны по клику вне, ESC и смене маршрута.
  useEffect(() => {
    if (!openMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [openMenu]);

  useEffect(() => {
    setOpenMenu(null);
    setOpenMobileGroup(null);
    setIsMenuOpen(false);
  }, [pathname]);

  const linkClass = (active: boolean) =>
    `px-4 py-2 rounded-full text-sm font-medium transition-colors ${
      active ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/[0.07]"
    }`;

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 px-4 py-3 lg:px-6 lg:py-4">
        <div className={`${FRAME} flex items-center justify-between gap-4 px-4 py-2.5 lg:px-5 lg:py-3`}>
          {/* Логотип */}
          <motion.div className="flex items-center shrink-0" initial="hidden" animate="show" variants={slideInLeft}>
            <Link href="/" className="flex items-center cursor-pointer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/full-logo.svg"
                alt="ApeDroidz Logo"
                className="h-[28px] lg:h-[32px] w-auto transition-transform duration-300 ease-out hover:scale-105"
              />
            </Link>
          </motion.div>

          {/* Навигация по центру */}
          <div ref={navRef} className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {DIRECT_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(isActive(item.href))}>
                {item.label}
              </Link>
            ))}

            {NAV_GROUPS.map((group) => {
              const open = openMenu === group.key;
              return (
                <div key={group.key} className="relative">
                  <button
                    onClick={() => setOpenMenu((o) => (o === group.key ? null : group.key))}
                    className={`${linkClass(groupIsActive(group) || open)} flex items-center gap-1.5`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                  >
                    {group.label}
                    <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {open && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+10px)] min-w-[210px] rounded-2xl border border-white/10 bg-[#0b0b0b]/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-1.5 z-50"
                        role="menu"
                      >
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpenMenu(null)}
                            className={`block px-3.5 py-2.5 rounded-xl text-sm transition-colors ${
                              isActive(item.href)
                                ? "bg-white/10 text-white"
                                : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                            }`}
                            role="menuitem"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            <span className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-white/25 cursor-default select-none">
              Staking
              <span className="text-[8px] font-black uppercase tracking-widest border border-white/15 text-white/40 rounded px-1.5 py-0.5">
                Soon
              </span>
            </span>
          </div>

          {/* Профиль + кошелёк справа */}
          <motion.div
            className="hidden lg:flex items-center gap-2 shrink-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            {account && onOpenProfile && <UserLevelBadge onClick={onOpenProfile} />}
            <ConnectButton
              client={client}
              chain={apeChain}
              wallets={wallets}
              theme="dark"
              connectButton={{
                label: "Connect Wallet",
                className: `
                  !bg-white !text-black !font-bold !rounded-full
                  !h-[42px] !px-6 !text-sm
                  !border !border-transparent !transition-all !duration-300
                  hover:!bg-[#0069FF] hover:!text-white hover:!border-transparent
                `,
              }}
              detailsButton={{
                className: `
                  !bg-white/5 !border !border-white/10 !rounded-full !h-[42px] !text-sm
                `,
              }}
              connectModal={{
                size: "compact",
                title: "ApeDroidz Access",
                showThirdwebBranding: false,
              }}
            />
          </motion.div>

          {/* Бургер */}
          <motion.button
            className="lg:hidden flex items-center justify-center h-[38px] w-[38px] rounded-full border border-white/15 bg-white/5"
            onClick={() => setIsMenuOpen(true)}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Open menu"
          >
            <Menu size={20} className="text-white" />
          </motion.button>
        </div>
      </header>

      {/* Мобильное меню */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[299] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMenu}
            />

            <motion.div
              className="fixed top-0 right-0 bottom-0 w-[86%] max-w-[360px] bg-[#0b0b0b] border-l border-white/10 z-[300] lg:hidden flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/full-logo.svg" alt="ApeDroidz" className="h-7 w-auto" />
                <button
                  onClick={closeMenu}
                  className="flex items-center justify-center h-[38px] w-[38px] rounded-full border border-white/15 bg-white/5"
                  aria-label="Close menu"
                >
                  <X size={20} className="text-white" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-2">
                {account && onOpenProfile && (
                  <div className="mb-2">
                    <UserLevelBadge onClick={() => { onOpenProfile(); closeMenu(); }} className="w-full" />
                  </div>
                )}

                {!account && (
                  <div className="mb-2 [&_button]:!w-full">
                    <ConnectButton
                      client={client}
                      chain={apeChain}
                      wallets={wallets}
                      theme="dark"
                      connectButton={{
                        label: "Connect Wallet",
                        className: `
                          !bg-white !text-black !font-bold !rounded-full !w-full
                          !h-[48px] !text-sm !border !border-transparent
                        `,
                      }}
                      connectModal={{ size: "compact", title: "ApeDroidz Access", showThirdwebBranding: false }}
                    />
                  </div>
                )}

                {DIRECT_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenu}
                    className={`flex items-center h-[50px] px-4 rounded-2xl text-sm font-medium transition-colors ${
                      isActive(item.href) ? "bg-white/10 text-white" : "bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}

                {NAV_GROUPS.map((group) => {
                  const open = openMobileGroup === group.key;
                  return (
                    <div key={group.key} className="flex flex-col gap-1.5">
                      <button
                        onClick={() => setOpenMobileGroup((o) => (o === group.key ? null : group.key))}
                        className={`flex items-center h-[50px] px-4 rounded-2xl text-sm font-medium transition-colors ${
                          groupIsActive(group) || open ? "bg-white/10 text-white" : "bg-white/5 text-white/70"
                        }`}
                        aria-expanded={open}
                      >
                        <span className="flex-1 text-left">{group.label}</span>
                        <ChevronDown size={16} className={`text-white/50 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>

                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-1.5 pl-3">
                              {group.items.map((item) => (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  onClick={closeMenu}
                                  className={`flex items-center h-[44px] px-4 rounded-xl text-sm transition-colors ${
                                    isActive(item.href)
                                      ? "bg-[#3b82f6]/10 text-white border border-[#3b82f6]/30"
                                      : "bg-white/[0.03] text-white/70 hover:bg-white/10"
                                  }`}
                                >
                                  {item.label}
                                </Link>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}

                <div className="flex items-center h-[50px] px-4 rounded-2xl bg-white/[0.03] text-sm text-white/30 select-none">
                  <span className="flex-1">Staking</span>
                  <span className="text-[8px] font-black uppercase tracking-widest border border-white/15 text-white/40 rounded px-1.5 py-0.5">
                    Soon
                  </span>
                </div>

                <div className="h-px bg-white/10 my-3" />

                <div className="flex items-center justify-center gap-3">
                  {SOCIALS.map((social) => (
                    <Link
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={social.name}
                      className="flex items-center justify-center w-[44px] h-[44px] bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white group"
                    >
                      <social.Icon
                        className={social.name === "OpenSea"
                          ? "w-[18px] h-[18px] brightness-0 invert-[0.6] group-hover:invert transition-all"
                          : "w-[18px] h-[18px]"}
                      />
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
