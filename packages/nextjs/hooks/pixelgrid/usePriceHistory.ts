"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPriceHistory,
  getPriceHistoryByType,
  getLatestPrice,
  getPriceStats,
  savePriceChange,
  type PriceChangeEvent,
} from "~~/utils/priceHistory";
import { useDeployedContractInfo } from "../helper";
import { getParsedErrorWithAllAbis } from "~~/utils/helper/contract";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import type { AllowedChainIds } from "~~/utils/helper/networks";
import { ethers } from "ethers";

export function usePriceHistory() {
  const { chainId, ethersReadonlyProvider, accounts } = useWagmiEthers();
  const allowedChainId = typeof chainId === "number" ? (chainId as AllowedChainIds) : undefined;
  const { data: pixelGrid } = useDeployedContractInfo({ contractName: "PixelGrid", chainId: allowedChainId });

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saleEventCount, setSaleEventCount] = useState(0); // 거래 이벤트 발생 시 증가

  const hasContract = Boolean(pixelGrid?.address && pixelGrid?.abi);
  const hasProvider = Boolean(ethersReadonlyProvider);

  const contractRead = hasContract && hasProvider
    ? new ethers.Contract(pixelGrid!.address, pixelGrid!.abi as any, ethersReadonlyProvider)
    : undefined;

  // 이벤트 리스닝 시작 (거래만 기록)
  const startListeningToEvents = useCallback(async () => {
    if (!contractRead) return;

    try {
      // PixelSale 이벤트만 리스닝 (거래가 이루어진 경우만 기록)
      contractRead.on("PixelSale", async (from: string, to: string, tokenId: bigint, price: bigint, event: any) => {
        const block = await event.getBlock();
        const timestamp = Number(block.timestamp) * 1000;

        await savePriceChange({
          pixelId: Number(tokenId),
          timestamp,
          priceWei: price,
          eventType: "sale",
          fromAddress: from,
          toAddress: to,
          blockNumber: Number(event.blockNumber),
          txHash: event.transactionHash,
        });

        // 거래 발생 시 카운터 증가 (컴포넌트 리렌더링 트리거)
        setSaleEventCount(prev => prev + 1);
      });

      setMessage("Event listener started");
    } catch (e: any) {
      console.error("Event listener error:", e);
      setMessage(e?.message ?? String(e));
    }
  }, [contractRead]);

  // 과거 이벤트 불러오기 (초기 로딩 시 - 거래만 기록)
  const loadHistoricalEvents = useCallback(async () => {
    if (!contractRead) return;
    setIsLoading(true);
    try {
      const currentBlock = await ethersReadonlyProvider!.getBlockNumber();
      const fromBlock = currentBlock > 10000 ? currentBlock - 10000 : 0; // 최근 10,000 블록 (약 1-2일치, 체인에 따라 다름)

      // PixelSale 이벤트만 조회 (거래가 이루어진 경우만 기록)
      const saleFilter = contractRead.filters.PixelSale();
      const saleEvents = await contractRead.queryFilter(saleFilter, fromBlock);

      // DB에 저장 (거래만)
      for (const event of saleEvents) {
        const block = await event.getBlock();
        const timestamp = Number(block.timestamp) * 1000;

        if ("eventName" in event && event.eventName === "PixelSale") {
          const [from, to, tokenId, price] = (event as any).args as any;
          await savePriceChange({
            pixelId: Number(tokenId),
            timestamp,
            priceWei: price,
            eventType: "sale",
            fromAddress: from,
            toAddress: to,
            blockNumber: Number(event.blockNumber),
            txHash: event.transactionHash,
          });
        }
      }

      setMessage(`Loaded ${saleEvents.length} historical sales`);
    } catch (e: any) {
      console.error("Load historical events error:", e);
      setMessage(e?.message ?? String(e));
    } finally {
      setIsLoading(false);
    }
  }, [contractRead, ethersReadonlyProvider]);

  // 이벤트 리스너 시작
  useEffect(() => {
    if (hasContract && hasProvider) {
      startListeningToEvents();
      loadHistoricalEvents();
    }

    return () => {
      if (contractRead) {
        contractRead.removeAllListeners();
      }
    };
  }, [hasContract, hasProvider, startListeningToEvents, loadHistoricalEvents, contractRead]);

  return useMemo(() => ({
    message,
    isLoading,
    getPriceHistory,
    getPriceHistoryByType,
    getLatestPrice,
    getPriceStats,
    saleEventCount, // 거래 이벤트 카운터 (거래 발생 감지용)
  }), [message, isLoading, saleEventCount]);
}

