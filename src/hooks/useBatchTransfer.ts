"use client";

import { useCallback, useState } from "react";
import { useSendTransaction, useActiveAccount } from "thirdweb/react";
import { getContract, prepareContractCall, encode } from "thirdweb";
import { transferFrom } from "thirdweb/extensions/erc721";
import { apeChain, client } from "@/lib/thirdweb";

// 1. Достаем адрес админа из переменных окружения
const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS;

export function useBatchTransfer(contractAddress: string) {
    const account = useActiveAccount();
    const { mutateAsync: sendTx, isPending } = useSendTransaction();
    const [error, setError] = useState<string | null>(null);

    const transferBatch = useCallback(async (tokenIds: string[]) => {
        setError(null);

        // --- ПРОВЕРКИ ---
        if (!account) {
            throw new Error("Wallet not connected");
        }

        // Критическая проверка: если переменная не подтянулась, останавливаем всё
        if (!ADMIN_WALLET) {
            console.error("CRITICAL: NEXT_PUBLIC_ADMIN_WALLET_ADDRESS is missing in .env");
            throw new Error("System configuration error: Admin wallet not set.");
        }

        if (tokenIds.length === 0) return;

        try {
            // Инициализируем контракт
            const contract = getContract({
                client,
                chain: apeChain,
                address: contractAddress,
            });

            console.log(`Preparing to transfer ${tokenIds.length} items to ${ADMIN_WALLET}...`);

            // 2. Кодируем каждую операцию transferFrom
            // Мы не выполняем их, а превращаем в байт-код для упаковки
            const encodedCalls = await Promise.all(
                tokenIds.map(async (id) => {
                    const tx = transferFrom({
                        contract,
                        from: account.address,
                        to: ADMIN_WALLET, // Отправляем на адрес из .env
                        tokenId: BigInt(id),
                    });
                    return await encode(tx);
                })
            );

            // 3. Упаковываем все вызовы в одну транзакцию (Multicall)
            // Это позволяет отправить 19 штук, подписав всего 1 раз
            const batchTx = prepareContractCall({
                contract,
                method: "function multicall(bytes[] data) returns (bytes[] results)",
                params: [encodedCalls],
            });

            // 4. Отправляем пользователю на подпись
            const result = await sendTx(batchTx);

            console.log("Batch transfer success, Tx Hash:", result.transactionHash);
            return result; // Возвращаем объект результата (включая хэш)

        } catch (err: any) {
            console.error("Batch transfer failed:", err);
            // Форматируем ошибку, если пользователь отклонил транзакцию
            const errorMessage = err.message?.includes("rejected")
                ? "Transaction rejected by user"
                : (err.message || "Transfer failed");

            setError(errorMessage);
            throw new Error(errorMessage);
        }
    }, [account, contractAddress, sendTx]);

    return { transferBatch, isLoading: isPending, error };
}