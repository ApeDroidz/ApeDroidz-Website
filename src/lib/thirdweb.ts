import { createThirdwebClient, defineChain } from "thirdweb";

// ✅ Достаем Client ID
const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;

if (!clientId) {
  throw new Error("No Client ID found in .env");
}

export const client = createThirdwebClient({
  clientId: clientId,
});

// === MAINNET (APECHAIN) ===
// В v5 достаточно просто указать ID сети, всё остальное подтянется само
export const apeChain = defineChain(33139);