"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

type ReactQueryProviderProps = {
  children: ReactNode;
};

export function ReactQueryProvider({ children }: ReactQueryProviderProps) {
  // Создаем один экземпляр QueryClient на время жизни компонента
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
