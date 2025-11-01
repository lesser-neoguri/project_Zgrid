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

  // 로컬 스토리지에서 캐시된 픽셀 데이터 로드
  useEffect(() => {
    if (!pixelGrid?.address) return;
    
    try {
      const cacheKey = `pixelGrid_${pixelGrid.address}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { pixels: cachedPixels, timestamp } = JSON.parse(cached);
        // 5분 이내 캐시면 사용
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          // BigInt 복원
          const restored: Record<number, PixelState> = {};
          for (const [idStr, pixel] of Object.entries(cachedPixels as any)) {
            const pixelData = pixel as any;
            restored[Number(idStr)] = {
              exists: pixelData.exists ?? false,
              owner: pixelData.owner,
              priceWei: BigInt(pixelData.priceWei),
              colorRgb: pixelData.colorRgb ?? 0,
            };
          }
          setPixels(restored);
        }
      }
    } catch (e) {
      console.error("Failed to load cache:", e);
    }
  }, [pixelGrid?.address]);

  const refresh = useCallback(async () => {
    if (!contractRead) return;
    setIsRefreshing(true);
    try {
      const next: Record<number, PixelState> = {};
      const BATCH_SIZE = 500; // 한 번에 500개씩 읽기
      const TOTAL_PIXELS = 192 * 108; // 20736
      
      // 먼저 일부만 로드해서 빠르게 표시 (첫 4개 배치 = 2000개 픽셀)
      const INITIAL_BATCHES = 4;
      const initialBatchPromises = [];
      for (let startId = 0; startId < INITIAL_BATCHES * BATCH_SIZE; startId += BATCH_SIZE) {
        initialBatchPromises.push(
          contractRead.getPixelBatch(startId, BATCH_SIZE).then((pixels: any[]) => ({
            startId,
            pixels,
          }))
        );
      }
      
      // 첫 배치들을 먼저 처리
      const initialResults = await Promise.all(initialBatchPromises);
      for (const { startId, pixels: batchPixels } of initialResults) {
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
      
      // 부분 데이터로 먼저 화면 업데이트
      setPixels({ ...next });
      
      // 나머지 배치들을 백그라운드에서 로드
      const remainingBatchPromises = [];
      for (let startId = INITIAL_BATCHES * BATCH_SIZE; startId < TOTAL_PIXELS; startId += BATCH_SIZE) {
        remainingBatchPromises.push(
          contractRead.getPixelBatch(startId, BATCH_SIZE).then((pixels: any[]) => ({
            startId,
            pixels,
          }))
        );
      }
      
      const remainingResults = await Promise.all(remainingBatchPromises);
      
      // 나머지 결과 병합
      for (const { startId, pixels: batchPixels } of remainingResults) {
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
      
      // 전체 데이터로 업데이트
      setPixels(next);
      
      // 로컬 스토리지에 캐시 (BigInt를 문자열로 변환)
      try {
        const cacheKey = `pixelGrid_${pixelGrid!.address}`;
        const cacheData = {
          pixels: Object.fromEntries(
            Object.entries(next).map(([id, pixel]) => [
              id,
              {
                ...pixel,
                priceWei: pixel.priceWei.toString(), // BigInt를 문자열로 변환
              },
            ])
          ),
          timestamp: Date.now(),
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
      } catch (e) {
        console.error("Failed to save cache:", e);
      }
      
      setMessage("Refreshed");
    } catch (e) {
      console.error("Refresh error:", e);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [contractRead, pixelGrid?.address]);

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


