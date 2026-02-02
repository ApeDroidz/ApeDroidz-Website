import { createThirdwebClient, defineChain } from "thirdweb";

// ✅ ПРАВИЛЬНО: Достаем значение из .env
const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;

if (!clientId) {
  throw new Error("No Client ID found in .env");
}

export const client = createThirdwebClient({
  clientId: clientId,
});

// === ТЕСТОВАЯ СЕТЬ (CURTIS) ===
export const apeChain = defineChain({
  id: 33111,
  name: "ApeChain Curtis",
  rpc: "https://curtis.rpc.caldera.xyz/http",
  testnet: true,
  nativeCurrency: {
    name: "ApeCoin",
    symbol: "APE",
    decimals: 18,
  },
});