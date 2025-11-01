"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePixelGrid } from "~~/hooks/pixelgrid/usePixelGrid";

export default function Home() {
  const { pixels, isRefreshing, address } = usePixelGrid();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const hasRenderedRef = useRef(false);

  const gridWidth = 192;
  const gridHeight = 108;
  const thumbnailCellSize = 4; // 미리보기용 셀 크기
  const gap = 0;

  // 캔버스 이미지 생성 및 미리보기 변환 (점진적 업데이트)
  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number | null = null;
    
    const renderCanvas = () => {
      if (!isMounted) return;
      
      const canvas = canvasRef.current;
      if (!canvas) {
        console.warn("[Canvas Preview] Canvas element not found");
        return;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        console.warn("[Canvas Preview] Failed to get 2d context");
        return;
      }

      const canvasWidth = thumbnailCellSize * gridWidth;
      const canvasHeight = thumbnailCellSize * gridHeight;

      // 캔버스 크기 설정
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // 캔버스 초기화 및 배경 흰색으로 명시적으로 설정
      // 캔버스는 기본적으로 투명하지만, 이미지 변환 시 검은색으로 보일 수 있으므로 명시적으로 흰색 설정
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // 렌더링 후 검증: 첫 픽셀 색상 확인
      const imageData = ctx.getImageData(0, 0, 1, 1);
      const pixelData = imageData.data;
      console.log("[Canvas Preview] Canvas initialized, first pixel RGB:", pixelData[0], pixelData[1], pixelData[2]);

      // 픽셀 데이터가 있으면 그리기
      let pixelsDrawn = 0;
      if (pixels && typeof pixels === 'object' && Object.keys(pixels).length > 0) {
        // 각 픽셀 그리기 (일부만 있어도 렌더링)
        for (let id = 0; id < gridWidth * gridHeight; id++) {
          const row = Math.floor(id / gridWidth);
          const col = id % gridWidth;
          const x = col * thumbnailCellSize;
          const y = row * thumbnailCellSize;

          const p = pixels[id];
          
          if (p && typeof p === 'object') {
            const colorRgb = p.colorRgb ?? 0;
            if (colorRgb !== 0 && typeof colorRgb === 'number') {
              const hex = colorRgb.toString(16).padStart(6, "0");
              ctx.fillStyle = `#${hex}`;
              ctx.fillRect(x, y, thumbnailCellSize, thumbnailCellSize);
              pixelsDrawn++;
            }
          }
        }
      }

      console.log(`[Canvas Preview] Rendered: ${pixelsDrawn} pixels drawn, total pixels: ${Object.keys(pixels || {}).length}, isRefreshing: ${isRefreshing}`);

      // 최종 검증: 캔버스 중앙 픽셀 확인 (흰색이어야 함)
      const centerX = Math.floor(canvas.width / 2);
      const centerY = Math.floor(canvas.height / 2);
      const centerImageData = ctx.getImageData(centerX, centerY, 1, 1);
      const centerPixel = centerImageData.data;
      console.log("[Canvas Preview] Center pixel RGB:", centerPixel[0], centerPixel[1], centerPixel[2], "should be (255, 255, 255)");

      // 캔버스를 이미지 데이터 URL로 변환 (항상 변환 - 데이터가 없어도 빈 그리드 표시)
      try {
        // PNG 형식으로 명시적으로 변환 (배경 투명도 보존)
        const imageDataUrl = canvas.toDataURL("image/png");
        if (imageDataUrl && imageDataUrl.length > 100 && imageDataUrl.startsWith('data:image')) {
          // 항상 업데이트하여 빈 그리드도 표시
          console.log("[Canvas Preview] Image generated successfully, length:", imageDataUrl.length, "first render:", !hasRenderedRef.current);
          setPreviewImage(imageDataUrl);
          hasRenderedRef.current = true;
        } else {
          console.warn("[Canvas Preview] Invalid image data URL", { 
            length: imageDataUrl?.length, 
            startsWith: imageDataUrl?.substring(0, 20) 
          });
        }
      } catch (error) {
        console.error("[Canvas Preview] Failed to convert canvas to image:", error);
      }
    };

    // 렌더링 함수를 requestAnimationFrame으로 안전하게 실행
    const scheduleRender = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(() => {
        renderCanvas();
      });
    };

    // 초기 렌더링 - 여러 시점에서 시도
    scheduleRender();
    
    const timeoutId1 = setTimeout(scheduleRender, 50);
    const timeoutId2 = setTimeout(scheduleRender, 200);
    const timeoutId3 = setTimeout(scheduleRender, 500);
    
    return () => {
      isMounted = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      clearTimeout(timeoutId3);
    };
  }, [pixels, gridWidth, gridHeight, thumbnailCellSize, isRefreshing]);

  // 통계 및 참여자 계산
  const { stats, participants, firstMintDate } = useMemo<{
    stats: { total: number; minted: number; forSale: number };
    participants: string[];
    firstMintDate: Date | null;
  }>(() => {
    if (!pixels) {
      return {
        stats: { total: 0, minted: 0, forSale: 0 },
        participants: [],
        firstMintDate: null,
      };
    }
    
    let minted = 0;
    let forSale = 0;
    const participantSet = new Set<string>();
    let earliestDate: Date | null = null;
    
    for (const pixel of Object.values(pixels)) {
      if (pixel.exists) {
        minted++;
        if (pixel.priceWei > 0n) {
          forSale++;
        }
        if (pixel.owner) {
          participantSet.add(pixel.owner.toLowerCase());
        }
      }
    }
    
    return {
      stats: {
        total: gridWidth * gridHeight,
        minted,
        forSale,
      },
      participants: Array.from(participantSet),
      firstMintDate: earliestDate,
    };
  }, [pixels, gridWidth, gridHeight]);

  // 주소 단축
  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* 미니멀한 갤러리 레이아웃 */}
        <div className="flex flex-col items-center">
          {/* 캔버스 이미지 - 박물관 작품처럼 */}
          <div className="w-full">
            {/* 렌더링용 캔버스 (화면 밖에 배치하되 렌더링 가능하도록) */}
            <canvas 
              ref={canvasRef}
              width={thumbnailCellSize * gridWidth}
              height={thumbnailCellSize * gridHeight}
              style={{ 
                position: "fixed",
                left: "-9999px",
                top: "-9999px",
                width: `${thumbnailCellSize * gridWidth}px`,
                height: `${thumbnailCellSize * gridHeight}px`,
              }}
            />
            
            <Link 
              href="/canvas" 
              className="group block bg-white" 
              style={{ 
                backgroundColor: "#ffffff",
                color: "inherit",
                textDecoration: "none",
                display: "block",
              }}
            >
              {previewImage ? (
                <div className="relative bg-white border border-gray-300 shadow-sm group-hover:shadow-md transition-shadow overflow-hidden" style={{ backgroundColor: "#ffffff" }}>
                  <img
                    src={previewImage}
                    alt="Pixel Canvas Preview"
                    className="block w-full h-auto bg-white"
                    style={{ 
                      imageRendering: "pixelated",
                      maxWidth: "100%",
                      width: "100%",
                      height: "auto",
                      aspectRatio: `${gridWidth} / ${gridHeight}`, // 16:9 비율 고정
                      backgroundColor: "#ffffff", // 배경색 명시
                      display: "block",
                    }}
                    onError={(e) => {
                      console.error("[Canvas Preview] Image load error", e);
                      // 이미지 로드 실패 시 previewImage를 null로 설정하여 fallback 표시
                      setPreviewImage(null);
                    }}
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement;
                      console.log("[Canvas Preview] Image loaded successfully", {
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        srcLength: img.src.length,
                        srcPreview: img.src.substring(0, 50),
                      });
                    }}
                  />
                  {/* 호버 시 오버레이 완전히 제거 - 검은색 없음 */}
                </div>
              ) : (
                <div 
                  className="relative bg-white border border-gray-300 shadow-sm overflow-hidden flex items-center justify-center"
                  style={{
                    aspectRatio: `${gridWidth} / ${gridHeight}`, // 16:9 비율 고정
                    maxWidth: "100%",
                    width: "100%",
                    minHeight: "200px",
                    backgroundColor: "#ffffff",
                  }}
                >
                  {isRefreshing ? (
                    <div className="text-gray-500 text-sm">불러오는 중...</div>
                  ) : (
                    <div className="text-gray-400 text-sm">로딩 중...</div>
                  )}
                </div>
              )}
            </Link>
          </div>

          {/* 작품 설명 - 박물관 스타일 */}
          <div className="mt-8 w-full space-y-1 text-left">
            <h2 className="text-2xl font-normal text-black tracking-tight">Pixel Canvas #1</h2>
            
            <div className="text-xs text-gray-600 space-y-0.5 mt-3">
              <div>
                {address ? (
                  <>
                    <span className="font-medium">Contract:</span>{" "}
                    <span className="font-mono">{shortenAddress(address)}</span>
                  </>
                ) : (
                  <span>Contract: Not deployed</span>
                )}
              </div>
              <div>
                <span className="font-medium">Dimensions:</span> {gridWidth} × {gridHeight} pixels
              </div>
              <div>
                <span className="font-medium">Total Pixels:</span> {stats.total.toLocaleString()}
              </div>
              <div>
                <span className="font-medium">Minted:</span> {stats.minted.toLocaleString()} (
                {stats.total > 0 
                  ? ((stats.minted / stats.total) * 100).toFixed(1) 
                  : "0"}%)
              </div>
              <div>
                <span className="font-medium">For Sale:</span> {stats.forSale.toLocaleString()}
              </div>
              {firstMintDate instanceof Date && (
                <div>
                  <span className="font-medium">Created:</span>{" "}
                  {firstMintDate.toLocaleDateString("ko-KR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
              )}
            </div>

            {/* 참여자 목록 */}
            {participants.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="text-xs text-gray-600 mb-3">
                  <span className="font-medium">Participants:</span> {participants.length}
                </div>
                <div className="flex flex-wrap gap-2">
                  {participants.map((address, index) => (
                    <div
                      key={index}
                      className="text-xs font-mono text-gray-700 bg-gray-50 px-2 py-1 border border-gray-200"
                    >
                      {shortenAddress(address)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}