"use client";

import { useCallback, useState } from "react";
import { useSendTransaction, useActiveAccount } from "thirdweb/react";
import { getContract, prepareContractCall, encode } from "thirdweb";
import { safeTransferFrom } from "thirdweb/extensions/erc1155";
import { apeChain, client } from "@/lib/thirdweb";

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS!;
const SHARD_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_SHARD_CONTRACT_ADDRESS!;
const SHARDS_PER_MERGE = 30;

export function useShardTransfer() {
    const account = useActiveAccount();
    const { mutateAsync: sendTx, isPending } = useSendTransaction();
    const [error, setError] = useState<string | null>(null);

    const transferShards = useCallback(async (shardCount: number = SHARDS_PER_MERGE) => {
        setError(null);
        if (!account) throw new Error("Wallet not connected");
        if (!ADMIN_WALLET) throw new Error("Admin wallet not configured");
        if (!SHARD_CONTRACT_ADDRESS) throw new Error("Shard contract not configured");
        if (shardCount < SHARDS_PER_MERGE || shardCount % SHARDS_PER_MERGE !== 0) {
            throw new Error(`Shard count must be a multiple of ${SHARDS_PER_MERGE}`);
        }

        try {
            const contract = getContract({
                client,
                chain: apeChain,
                address: SHARD_CONTRACT_ADDRESS,
            });

            const transferTx = safeTransferFrom({
                contract,
                from: account.address,
                to: ADMIN_WALLET,
                tokenId: BigInt(0),
                value: BigInt(shardCount),
                data: "0x",
            });

            // We encode the transaction and wrap it in a multicall to bypass an exact MetaMask UI parsing bug
            // ("e.startsWith is not a function") that triggers when parsing ERC1155 safeTransferFrom data
            const encodedTx = await encode(transferTx);

            const tx = prepareContractCall({
                contract,
                method: "function multicall(bytes[] data) returns (bytes[] results)",
                params: [[encodedTx]],
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
