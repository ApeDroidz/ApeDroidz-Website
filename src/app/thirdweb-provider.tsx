"use client";

import { useEffect, type ReactNode } from "react";
import { ThirdwebProvider } from "thirdweb/react";
import { installWalletConnectMobileFix } from "@/lib/walletConnectMobileFix";

type ThirdwebProviderProps = {
  children: ReactNode;
};

export function ThirdwebAppProvider({ children }: ThirdwebProviderProps) {
  // Подписи с телефона через WalletConnect (MetaMask/Rainbow в Safari): без этого запрос
  // подписи уходил на ApeChain, которой нет в сессии кошелька, и кошелёк открывался пустым.
  // Подробности — lib/walletConnectMobileFix.ts.
  useEffect(() => { void installWalletConnectMobileFix(); }, []);

  // В thirdweb v5 ThirdwebProvider не требует client и activeChain
  // Они передаются напрямую в компоненты (например, ConnectButton)
  return <ThirdwebProvider>{children}</ThirdwebProvider>;
}
