"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { UserLevelBadge } from "@/components/user-level-badge";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, apeChain } from "@/lib/thirdweb";
import { createWallet } from "thirdweb/wallets";
import { Trophy, Menu, X } from "lucide-react";
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
    name: "Magic Eden", url: "https://magiceden.io/collections/apechain/0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3", icon: (
      <img src="/MagicEden.svg" alt="ME" className="w-5 h-5 brightness-0 invert" />
    )
  },
  {
    name: "OpenSea", url: "https://opensea.io/collection/apedroidz", icon: (
      <img src="/Opensea.svg" alt="OS" className="w-5 h-5 brightness-0 invert" />
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = () => setIsMenuOpen(false);

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

        {/* DESKTOP Navigation - hidden on mobile */}
        <motion.div
          className="hidden lg:flex items-center gap-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          {account && onOpenProfile && (
            <UserLevelBadge onClick={onOpenProfile} />
          )}

          {onOpenLeaderboard && (
            <motion.button
              onClick={onOpenLeaderboard}
              className="flex items-center justify-center h-[48px] w-[48px] bg-black border border-white/15 rounded-xl hover:bg-white/10 hover:border-white/30 transition-all duration-300 shadow-lg group cursor-pointer"
              title="Leaderboard"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Trophy size={20} className="text-white/70 group-hover:text-white transition-colors" />
            </motion.button>
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

          {account && !isDashboard && (
            <Link
              href="/dashboard"
              className="flex items-center justify-center h-[48px] px-6 bg-transparent border border-white/15 text-white text-sm font-bold rounded-xl hover:bg-white/10 hover:border-white/50 transition-all duration-300"
            >
              Go to Dashboard
            </Link>
          )}

          {isDashboard && (
            <Link
              href="/"
              className="flex items-center justify-center h-[48px] px-6 bg-transparent border border-white/15 text-white text-sm font-bold rounded-xl hover:bg-white/10 hover:border-white/50 transition-all duration-300"
            >
              Back to Menu
            </Link>
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
              className="fixed top-0 right-0 bottom-0 w-[280px] bg-[#0a0a0a] border-l border-white/10 z-[300] lg:hidden flex flex-col shadow-2xl"
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
              <div className="flex-1 flex flex-col gap-3 px-4 pb-4">
                {/* XP Badge */}
                {account && onOpenProfile && (
                  <button
                    onClick={() => { onOpenProfile(); closeMenu(); }}
                    className="w-full"
                  >
                    <UserLevelBadge onClick={() => { }} className="!w-full !h-[52px] !bg-white/5 hover:!bg-white/10 !border-white/10" />
                  </button>
                )}

                {/* Leaderboard */}
                {onOpenLeaderboard && (
                  <button
                    onClick={() => { onOpenLeaderboard(); closeMenu(); }}
                    className="flex items-center gap-3 w-full h-[52px] px-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <Trophy size={18} className="text-white/70" />
                    <span className="text-white font-medium text-sm">Leaderboard</span>
                  </button>
                )}

                {/* Connect Wallet */}
                {!account && (
                  <div onClick={closeMenu} className="w-full">
                    <ConnectButton
                      client={client}
                      chain={apeChain}
                      wallets={wallets}
                      theme="dark"
                      connectButton={{
                        label: "Connect Wallet",
                        className: `
                          !w-full !bg-white !text-black !font-bold !rounded-xl  
                          !h-[52px] !text-base
                          !border !border-transparent
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

                {/* Dashboard / Back */}
                {account && !isDashboard && (
                  <Link
                    href="/dashboard"
                    onClick={closeMenu}
                    className="flex items-center justify-center w-full h-[52px] bg-white text-black font-bold rounded-xl hover:bg-blue-600 hover:text-white transition-colors"
                  >
                    Go to Dashboard
                  </Link>
                )}

                {isDashboard && (
                  <Link
                    href="/"
                    onClick={closeMenu}
                    className="flex items-center justify-center w-full h-[52px] bg-white/5 border border-white/10 text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
                  >
                    Back to Menu
                  </Link>
                )}

                {/* Divider */}
                <div className="h-px bg-white/10 mt-4 mb-2" />

                {/* Social Links - directly after buttons */}
                <div className="flex items-center justify-center gap-3">
                  {SOCIALS.map((social) => (
                    <Link
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-[44px] h-[44px] bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors text-white/70 hover:text-white"
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