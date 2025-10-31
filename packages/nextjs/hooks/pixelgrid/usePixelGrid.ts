"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useDeployedContractInfo } from "../helper";
import { getParsedErrorWithAllAbis } from "~~/utils/helper/contract";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import type { AllowedChainIds } from "~~/utils/helper/networks";

type PixelState = {
  exists: boolean;
  owner?: string;
  priceWei: bigint;
  colorRgb: number; // 0xRRGGBB
};

export function usePixelGrid() {
  const { chainId, ethersReadonlyProvider, ethersSigner, isConnected, accounts } = useWagmiEthers();
  const allowedChainId = typeof chainId === "number" ? (chainId as AllowedChainIds) : undefined;
  const { data: pixelGrid } = useDeployedContractInfo({ contractName: "PixelGrid", chainId: allowedChainId });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [pixels, setPixels] = useState<Record<number, PixelState>>({});

  const hasContract = Boolean(pixelGrid?.address && pixelGrid?.abi);
  const hasProvider = Boolean(ethersReadonlyProvider);
  const hasSigner = Boolean(ethersSigner);

  const contractRead = useMemo(() => {
    if (!hasContract || !hasProvider) return undefined;
    return new ethers.Contract(pixelGrid!.address, pixelGrid!.abi as any, ethersReadonlyProvider);
  }, [hasContract, hasProvider, pixelGrid?.address, pixelGrid?.abi, ethersReadonlyProvider]);

  const contractWrite = useMemo(() => {
    if (!hasContract || !hasSigner) return undefined;
    return new ethers.Contract(pixelGrid!.address, pixelGrid!.abi as any, ethersSigner);
  }, [hasContract, hasSigner, pixelGrid?.address, pixelGrid?.abi, ethersSigner]);

  const refresh = useCallback(async () => {
    if (!contractRead) return;
    setIsRefreshing(true);
    try {
      const next: Record<number, PixelState> = {};
      const BATCH_SIZE = 500; // 한 번에 500개씩 읽기
      const TOTAL_PIXELS = 10000;
      
      // 병렬로 배치 호출 (20개의 배치를 동시에 처리)
      const batchPromises = [];
      for (let startId = 0; startId < TOTAL_PIXELS; startId += BATCH_SIZE) {
        batchPromises.push(
          contractRead.getPixelBatch(startId, BATCH_SIZE).then((pixels: any[]) => ({
            startId,
            pixels,
          }))
        );
      }
      
      const batchResults = await Promise.all(batchPromises);
      
      // 결과 병합
      for (const { startId, pixels: batchPixels } of batchResults) {
        batchPixels.forEach((pixel: any, index: number) => {
          const id = startId + index;
          next[id] = {
            exists: pixel.exists,
            owner: pixel.owner !== ethers.ZeroAddress ? pixel.owner : undefined,
            priceWei: BigInt(pixel.price),
            colorRgb: Number(pixel.color),
          };
        });
      }
      
      setPixels(next);
      setMessage("Refreshed");
    } catch (e) {
      console.error("Refresh error:", e);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [contractRead]);

  useEffect(() => {
    if (hasContract && hasProvider) refresh();
  }, [hasContract, hasProvider, refresh]);

  const mint = useCallback(
    async (tokenId: number) => {
      if (!contractWrite) return;
      setMessage(`Mint ${tokenId}...`);
      try {
        const tx = await contractWrite.mintPixel(tokenId, "", { gasLimit: 300000n });
        await tx.wait();
        setMessage(`Minted #${tokenId}`);
        await refresh();
      } catch (e: any) {
        const parsed = allowedChainId ? getParsedErrorWithAllAbis(e, allowedChainId) : (e?.message ?? String(e));
        setMessage(parsed);
      }
    },
    [contractWrite, refresh, allowedChainId],
  );

  const setPrice = useCallback(
    async (tokenId: number, priceWei: bigint) => {
      if (!contractWrite) return;
      setMessage(`Set price ${tokenId} -> ${priceWei} wei`);
      try {
        const tx = await contractWrite.setPrice(tokenId, priceWei, { gasLimit: 200000n });
        await tx.wait();
        setMessage(`Price set #${tokenId}`);
        await refresh();
      } catch (e: any) {
        const parsed = allowedChainId ? getParsedErrorWithAllAbis(e, allowedChainId) : (e?.message ?? String(e));
        setMessage(parsed);
      }
    },
    [contractWrite, refresh, allowedChainId],
  );

  const buy = useCallback(
    async (tokenId: number, priceWei: bigint) => {
      if (!contractWrite) return;
      setMessage(`Buy ${tokenId} for ${priceWei} wei...`);
      try {
        const tx = await contractWrite.buy(tokenId, { value: priceWei, gasLimit: 200000n });
        await tx.wait();
        setMessage(`Bought #${tokenId}`);
        await refresh();
      } catch (e: any) {
        const parsed = allowedChainId ? getParsedErrorWithAllAbis(e, allowedChainId) : (e?.message ?? String(e));
        setMessage(parsed);
      }
    },
    [contractWrite, refresh, allowedChainId],
  );

  const setColor = useCallback(
    async (tokenId: number, rgbHex: string) => {
      if (!contractWrite) return;
      const normalized = rgbHex.startsWith("#") ? rgbHex.slice(1) : rgbHex;
      const rgb = BigInt("0x" + normalized);
      setMessage(`Set color #${tokenId} -> ${rgbHex}`);
      try {
        const tx = await contractWrite.setColor(tokenId, rgb, { gasLimit: 120000n });
        await tx.wait();
        setMessage(`Color set #${tokenId}`);
        await refresh();
      } catch (e: any) {
        const parsed = allowedChainId ? getParsedErrorWithAllAbis(e, allowedChainId) : (e?.message ?? String(e));
        setMessage(parsed);
      }
    },
    [contractWrite, refresh, allowedChainId],
  );

  return {
    address: pixelGrid?.address,
    isConnected,
    account: accounts?.[0],
    message,
    isRefreshing,
    pixels,
    refresh,
    mint,
    setPrice,
    buy,
    setColor,
  } as const;
}


