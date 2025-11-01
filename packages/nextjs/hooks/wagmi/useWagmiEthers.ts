"use client";

import { useEffect, useMemo, useRef } from "react";
import { ethers } from "ethers";
import { useAccount, useWalletClient } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

export const useWagmiEthers = (initialMockChains?: Readonly<Record<number, string>>) => {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();

  // 배포 환경 감지
  const isProduction = typeof window !== "undefined" && window.location.protocol === "https:";
  
  // 배포 환경에서는 Sepolia를 기본으로 사용
  const defaultChainId = isProduction 
    ? scaffoldConfig.targetNetworks.find(n => n.id === 11155111)?.id ?? scaffoldConfig.targetNetworks[0]?.id
    : scaffoldConfig.targetNetworks[0]?.id;
  const walletChainId = chain?.id ?? walletClient?.chain?.id;
  const viewChainId = isConnected ? walletChainId ?? defaultChainId : defaultChainId;
  const accounts = address ? [address] : undefined;

  const ethersProvider = useMemo(() => {
    // 우선 표준 지갑 주입 객체를 직접 사용해 ethers의 에러 정규화를 보장
    if (typeof window !== "undefined" && (window as any).ethereum) {
      return new ethers.BrowserProvider((window as any).ethereum as ethers.Eip1193Provider);
    }

    // fallback: wagmi walletClient를 EIP-1193 어댑터로 감싸서 사용
    if (!walletClient) return undefined;

    const eip1193Provider = {
      request: async (args: any) => {
        return await walletClient.request(args);
      },
      on: () => {
        console.log("Provider events not fully implemented for wagmi");
      },
      removeListener: () => {
        console.log("Provider removeListener not fully implemented for wagmi");
      },
    } as ethers.Eip1193Provider;

    return new ethers.BrowserProvider(eip1193Provider);
  }, [walletClient]);

  const readonlyRpcUrl = useMemo(() => {
    const preferredChainId = viewChainId;
    const mockUrl = initialMockChains?.[preferredChainId || 0];
    if (mockUrl) return mockUrl;

    const overrideUrl = scaffoldConfig.rpcOverrides?.[preferredChainId as number];
    if (overrideUrl) return overrideUrl;

    // 배포 환경(HTTPS)에서는 Hardhat 로컬 네트워크 사용 불가 (Mixed Content 오류)
    if (preferredChainId === 31337) {
      if (isProduction) {
        console.warn("Hardhat local network (31337) is not available in production. Falling back to Sepolia.");
        // 프로덕션에서는 Sepolia로 폴백
        return scaffoldConfig.alchemyApiKey
          ? `https://eth-sepolia.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`
          : "https://rpc.sepolia.org";
      }
      const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      // localhost가 아니면 HTTPS를 시도하지 않음
      if (host === "localhost" || host === "127.0.0.1") {
        return `http://${host}:8545`;
      }
      // localhost가 아닌 경우 Sepolia로 폴백
      return scaffoldConfig.alchemyApiKey
        ? `https://eth-sepolia.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`
        : "https://rpc.sepolia.org";
    }

    if (preferredChainId === 11155111) {
      return scaffoldConfig.alchemyApiKey
        ? `https://eth-sepolia.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`
        : "https://rpc.sepolia.org";
    }

    return undefined;
  }, [initialMockChains, viewChainId, isProduction]);

  const ethersReadonlyProvider = useMemo(() => {
    if (readonlyRpcUrl) {
      try {
        // 네트워크 정보를 명시적으로 제공하여 감지 실패 문제 해결
        // 배포 환경에서는 Hardhat 사용 불가
        const network = viewChainId === 11155111
          ? { name: "sepolia", chainId: 11155111 }
          : viewChainId === 31337 && !isProduction
          ? { name: "hardhat", chainId: 31337 }
          : undefined;
        
        return network 
          ? new ethers.JsonRpcProvider(readonlyRpcUrl, network)
          : new ethers.JsonRpcProvider(readonlyRpcUrl);
      } catch (e) {
        console.error("Failed to create JsonRpcProvider:", e);
        return ethersProvider;
      }
    }

    return ethersProvider;
  }, [readonlyRpcUrl, ethersProvider, viewChainId]);

  const ethersSigner = useMemo(() => {
    if (!ethersProvider || !address) return undefined;
    try {
      return ethersProvider.getSigner(address);
    } catch (e) {
      console.error("Failed to create ethers signer:", e);
      return undefined;
    }
  }, [ethersProvider, address]);

  // Stable refs consumers can reuse
  const ropRef = useRef<typeof ethersReadonlyProvider>(ethersReadonlyProvider);
  const chainIdRef = useRef<number | undefined>(viewChainId);

  useEffect(() => {
    ropRef.current = ethersReadonlyProvider;
  }, [ethersReadonlyProvider]);

  useEffect(() => {
    chainIdRef.current = viewChainId;
  }, [viewChainId]);

  return {
    chainId: viewChainId,
    accounts,
    isConnected,
    ethersProvider,
    ethersReadonlyProvider,
    ethersSigner,
    ropRef,
    chainIdRef,
  } as const;
};
