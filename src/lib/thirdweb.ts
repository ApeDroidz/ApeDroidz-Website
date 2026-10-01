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
// Свой RPC, а не дефолтный шлюз thirdweb: шлюз режет по лимиту тарифа
// (из-за него падали выдачи призов в Glitch Cards), а тяжёлые запросы вроде
// eth_getLogs на странице минта он просто не тянул. Серверная половина живёт
// в lib/apechain.ts; переопределяется через NEXT_PUBLIC_APECHAIN_RPC_URL.
export const APECHAIN_RPC_URL =
  process.env.NEXT_PUBLIC_APECHAIN_RPC_URL || "https://rpc.apechain.com/http";

// Имя, валюта и эксплорер — не украшение: когда кошельку на телефоне нужно ДОБАВИТЬ ApeChain
// (wallet.switchChain → wallet_addEthereumChain), thirdweb берёт chainName/nativeCurrency/
// blockExplorerUrls ровно отсюда. С одним id и rpc в запрос уходили undefined, и MetaMask
// отказывал — кнопка «Add ApeChain» на /droidz_survival не могла сработать (01.10.2026).
export const apeChain = defineChain({
  id: 33139,
  rpc: APECHAIN_RPC_URL,
  name: "ApeChain",
  nativeCurrency: { name: "ApeCoin", symbol: "APE", decimals: 18 },
  blockExplorers: [{ name: "ApeScan", url: "https://apescan.io" }],
});