"use client";

import { createWallet } from "thirdweb/wallets";
import { useActiveAccount } from "thirdweb/react";
import { client, apeChain } from "@/lib/thirdweb";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

// 1. Динамический импорт кнопки с отключенным SSR
// Это заставит Next.js рисовать кнопку только в браузере, избегая ошибки гидратации
const ConnectButton = dynamic(
  () => import("thirdweb/react").then((mod) => mod.ConnectButton),
  { ssr: false }
);

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
];

export function WalletButton({ isDashboard = false }: { isDashboard?: boolean }) {
  const account = useActiveAccount();
  const router = useRouter();

  // Если кошелек подключен, показываем окошко кошелька и кнопку навигации
  // ConnectButton автоматически показывает адрес и баланс когда подключен
  if (account) {
    return (
      <div className="z-50 flex items-center gap-3">
        {/* Окошко кошелька с ConnectButton (автоматически показывает имя, баланс, статус) */}
        <div className="flex items-center cursor-pointer">
          <ConnectButton
            client={client}
            chain={apeChain}
            wallets={wallets}
            theme={"dark"}
            connectButton={{
              label: "Connect Wallet",
              className: `
                !bg-transparent !text-white !font-medium !rounded-lg 
                !h-[48px] !px-4 !text-sm !cursor-pointer
                !border !border-white/20 !transition-all !duration-300
                hover:!border-white/30 hover:!bg-white/10
              `,
            }}
            connectModal={{
              size: "compact",
              title: "ApeDroidz Access",
              showThirdwebBranding: false,
            }}
          />
        </div>

        {/* Кнопка навигации рядом с окошком валлета */}
        <button
          onClick={() => router.push(isDashboard ? "/" : "/dashboard")}
          className={`
            h-[48px] px-6 text-sm font-bold rounded-lg transition-all duration-300 cursor-pointer
            ${isDashboard
              ? "bg-transparent text-white backdrop-blur-md border border-white/30 hover:border-white/75"
              : "bg-white text-black hover:bg-gray-200 border border-transparent"}
          `}
        >
          {isDashboard ? "Back to Menu" : "Go to Dashboard"}
        </button>
      </div>
    );
  }

  return (
    <div className="z-50">
      <ConnectButton
        client={client}
        chain={apeChain}
        wallets={wallets}
        theme={"dark"}
        connectButton={{
          label: "Connect Wallet",
          className: `
            !bg-white !text-black !font-bold !rounded-lg 
            !h-[48px] !px-8 !text-base
            !border !border-transparent !transition-all !duration-300
            hover:!bg-black hover:!text-white hover:!border-white/30
          `,
        }}
        connectModal={{
          size: "compact",
          title: "ApeDroidz Access",
          showThirdwebBranding: false,
        }}
      />
    </div>
  );
}