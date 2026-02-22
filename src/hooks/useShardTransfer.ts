"use client";

import { useCallback, useState } from "react";
import { useSendTransaction, useActiveAccount } from "thirdweb/react";
import { getContract } from "thirdweb";
import { safeTransferFrom } from "thirdweb/extensions/erc1155";
import { apeChain, client } from "@/lib/thirdweb";

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS!;
const SHARD_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_SHARD_CONTRACT_ADDRESS!;
const SHARDS_PER_MERGE = 30;

export function useShardTransfer() {
    const account = useActiveAccount();
    const { mutateAsync: sendTx, isPending } = useSendTransaction();
    const [error, setError] = useState<string | null>(null);

    const transferShards = useCallback(async () => {
        setError(null);
        if (!account) throw new Error("Wallet not connected");
        if (!ADMIN_WALLET) throw new Error("Admin wallet not configured");
        if (!SHARD_CONTRACT_ADDRESS) throw new Error("Shard contract not configured");

        try {
            const contract = getContract({
                client,
                chain: apeChain,
                address: SHARD_CONTRACT_ADDRESS,
            });

            const tx = safeTransferFrom({
                contract,
                from: account.address,
                to: ADMIN_WALLET,
                tokenId: BigInt(0),
                value: BigInt(SHARDS_PER_MERGE),
                data: "0x",
            });

            const result = await sendTx(tx);
            console.log("✅ Shard transfer:", result.transactionHash);
            return result;
        } catch (err: any) {
            const msg = err.message?.includes("rejected")
                ? "Transaction rejected by user"
                : err.message || "Transfer failed";
            setError(msg);
            throw new Error(msg);
        }
    }, [account, sendTx]);

    return { transferShards, isLoading: isPending, error };
}
