"use client";

import type { ReactNode } from "react";
import { ThirdwebProvider } from "thirdweb/react";

type ThirdwebProviderProps = {
  children: ReactNode;
};

export function ThirdwebAppProvider({ children }: ThirdwebProviderProps) {
  // В thirdweb v5 ThirdwebProvider не требует client и activeChain
  // Они передаются напрямую в компоненты (например, ConnectButton)
  return <ThirdwebProvider>{children}</ThirdwebProvider>;
}
