"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent, type MouseEvent } from "react";
import { usePixelGrid } from "../../hooks/pixelgrid/usePixelGrid";
import { usePriceHistory } from "../../hooks/pixelgrid/usePriceHistory";
import { PriceHistoryChart } from "../../components/PriceHistoryChart";

export default function CanvasPage() {
  const formatWeiToEth = (wei: bigint) => {
    const s = wei.toString();
    const decimals = 18;
    if (s.length <= decimals) {
      const padded = s.padStart(decimals, "0");
      const intPart = "0";
      const fracPart = padded;
      return `${intPart}.${fracPart}`.replace(/\.?0+$/, "");
    }
    const intPart = s.slice(0, s.length - decimals);
    const fracRaw = s.slice(s.length - decimals);
    const fracPart = fracRaw.replace(/0+$/, "");
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  };

  // Pricing scale: 1 unit = 0.01 ETH = 1e16 wei
  const UNIT_TO_WEI = 10n ** 16n;
  const unitsToWei = (units: bigint) => units * UNIT_TO_WEI;
  const weiToUnits = (wei: bigint) => wei / UNIT_TO_WEI;
  const { pixels, isRefreshing, mint, setPrice, buy, setColor, account } = usePixelGrid() as any;
  const { getPriceHistory, saleEventCount } = usePriceHistory();
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});
  const [colorInput, setColorInput] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showOwnedPixels, setShowOwnedPixels] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") return;
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // 선택된 픽셀의 가격 이력 로드
  useEffect(() => {
    if (selectedId !== null) {
      getPriceHistory(selectedId).then(setPriceHistory);
    } else {
      setPriceHistory([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 거래 발생 시 선택된 픽셀의 가격 이력 자동 새로고침
  useEffect(() => {
    if (selectedId !== null && saleEventCount > 0) {
      // 거래가 발생했을 때 해당 픽셀의 이력이면 새로고침
      getPriceHistory(selectedId).then(setPriceHistory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleEventCount, selectedId]);

  const selected = useMemo(() => (selectedId != null ? pixels?.[selectedId] : undefined), [selectedId, pixels]);
  const selectedOwned = Boolean(selected?.exists);
  const selectedForSale = (selected?.priceWei ?? 0n) > 0n;
  const isSelectedOwner = selectedOwned && selected?.owner && account && selected.owner.toLowerCase() === String(account).toLowerCase();

  // 계정이 소유한 픽셀 목록
  const ownedPixels = useMemo(() => {
    if (!account || !pixels) return [];
    const owned: Array<{ id: number; colorRgb: number; priceWei: bigint }> = [];
    for (const [idStr, pixel] of Object.entries(pixels)) {
      const p = pixel as { exists: boolean; owner?: string; colorRgb: number; priceWei: bigint };
      if (p.exists && p.owner && p.owner.toLowerCase() === String(account).toLowerCase()) {
        owned.push({
          id: Number(idStr),
          colorRgb: p.colorRgb,
          priceWei: p.priceWei,
        });
      }
    }
    return owned.sort((a, b) => a.id - b.id);
  }, [account, pixels]);

  // 소유한 픽셀 ID Set (빠른 조회용)
  const ownedPixelIds = useMemo(() => {
    return new Set(ownedPixels.map(p => p.id));
  }, [ownedPixels]);

  const gridWidth = 192; // 16:9 비율
  const gridHeight = 108;
  const baseCellSize = useMemo(() => {
    const paddingHorizontal = 160;
    const paddingVertical = 220;
    const gapHorizontal = (gridWidth - 1) * 1;
    const gapVertical = (gridHeight - 1) * 1;
    const availableWidth = Math.max(320, viewport.width - paddingHorizontal - gapHorizontal);
    const availableHeight = Math.max(320, viewport.height - paddingVertical - gapVertical);
    const candidateWidth = Math.floor(availableWidth / gridWidth);
    const candidateHeight = Math.floor(availableHeight / gridHeight);
    const candidate = Math.min(candidateWidth, candidateHeight);
    return Math.max(3, Math.min(candidate, 50));
  }, [viewport.width, viewport.height, gridWidth, gridHeight]);

  const cellSize = useMemo(() => Math.round(baseCellSize * zoom), [baseCellSize, zoom]);
  const gap = 1;

  const canvasWidth = useMemo(() => {
    return cellSize * gridWidth + gap * (gridWidth - 1);
  }, [cellSize, gap, gridWidth]);

  const canvasHeight = useMemo(() => {
    return cellSize * gridHeight + gap * (gridHeight - 1);
  }, [cellSize, gap, gridHeight]);

  // Canvas 렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 캔버스 크기 설정
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // 배경 투명
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 각 픽셀 그리기
    for (let id = 0; id < gridWidth * gridHeight; id++) {
      const row = Math.floor(id / gridWidth);
      const col = id % gridWidth;
      const x = col * (cellSize + gap);
      const y = row * (cellSize + gap);

      const p = pixels[id];
      const colorRgb = p?.colorRgb ?? 0;
      
      // 배경색
      if (colorRgb === 0) {
        ctx.fillStyle = "transparent";
      } else {
        const hex = colorRgb.toString(16).padStart(6, "0");
        ctx.fillStyle = `#${hex}`;
      }
      ctx.fillRect(x, y, cellSize, cellSize);

      // 소유한 픽셀인지 확인
      const isOwned = showOwnedPixels && account && ownedPixelIds.has(id);
      
      // 테두리: 선택됨(파랑) > 소유한 픽셀(노란색 네온) > 가격 미설정(연회색) / 기본(회색)
      if (selectedId === id) {
        ctx.strokeStyle = "#2563eb"; // blue-600
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellSize, cellSize);
      } else if (isOwned) {
        // 노란색 네온 이펙트 (다중 레이어로 글로우 효과 생성)
        // 외곽 글로우 레이어 1 (가장 넓은 글로우)
        ctx.shadowColor = "#FFD208";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = "#FFD208";
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 1, y - 1, cellSize + 2, cellSize + 2);
        // 외곽 글로우 레이어 2 (중간 글로우)
        ctx.shadowBlur = 4;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, y, cellSize, cellSize);
        // 메인 테두리 (밝은 노란색)
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#FFD208";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellSize, cellSize);
        // 내부 테두리 (더 밝은 노란색)
        ctx.strokeStyle = "#FFF700";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      } else if (!p || (p.priceWei ?? 0n) === 0n) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#d1d5db"; // gray-300 for not priced
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellSize, cellSize);
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#9ca3af"; // gray-400
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellSize, cellSize);
      }
    }
  }, [pixels, cellSize, gap, canvasWidth, canvasHeight, selectedId, gridWidth, gridHeight, zoom, showOwnedPixels, account, ownedPixelIds]);

  const handleZoomWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    // 모든 휠 이벤트를 확대/축소로 처리 (스크롤 방지)
    event.preventDefault();
    event.stopPropagation();
    
    const delta = -event.deltaY * 0.0012;
    if (delta === 0) return;

    setZoom(prev => {
      const next = prev + delta;
      // 최소 줌: 그리드가 보이도록 baseCellSize가 최소 1픽셀이 되도록 제한
      // cellSize = baseCellSize * zoom이므로, zoom이 너무 작아지면 안됨
      const minZoom = 1 / baseCellSize; // 최소 1픽셀 셀 크기 보장
      const bounded = Math.max(minZoom, Math.min(next, 5)); // 최대 5배까지 확대 가능
      return Number(bounded.toFixed(3));
    });
  }, [baseCellSize]);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const newPan = {
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    };
    setPan(newPan);
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleCanvasClick = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    // 드래그가 아니고 단순 클릭인 경우에만 선택
    if (isDragging) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // 캔버스 transform을 고려한 좌표 계산
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    console.log('Click:', { 
      clientX: event.clientX, 
      clientY: event.clientY,
      rectLeft: rect.left, 
      rectTop: rect.top,
      canvasX, 
      canvasY,
      pan,
      cellSize,
      gap
    });

    const col = Math.floor(canvasX / (cellSize + gap));
    const row = Math.floor(canvasY / (cellSize + gap));

    console.log('Calculated:', { row, col, id: row * gridWidth + col });

    if (col >= 0 && col < gridWidth && row >= 0 && row < gridHeight) {
      const id = row * gridWidth + col;
      setSelectedId(id);
      setIsPanelOpen(true); // 픽셀 선택 시 패널 자동 열기
    }
  }, [cellSize, gap, gridWidth, gridHeight, pan, isDragging]);

  // 로딩 화면 표시
  if (isRefreshing) {
    return (
      <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center">
        <div 
          className="w-16 h-16 animate-spin"
          style={{
            backgroundColor: 'rgb(255, 210, 8)',
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col items-center gap-4 overflow-hidden bg-white">
      <div 
        ref={containerRef}
        className="flex-1 w-full flex items-center justify-center overflow-hidden px-6" 
        onWheel={handleZoomWheel}
      >
        <canvas
          ref={canvasRef}
          className={isDragging ? "cursor-grabbing" : "cursor-crosshair"}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ 
            imageRendering: "pixelated",
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        />
      </div>

      {/* 하단 토글 버튼 */}
      <button
        className="fixed bottom-4 right-4 w-12 h-12 bg-gray-900 text-white shadow-lg z-50 flex items-center justify-center hover:bg-gray-800 transition-colors"
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        aria-label="toggle panel"
        title={isPanelOpen ? "Close panel" : "Open panel"}
      >
        <svg 
          className={`w-6 h-6 transition-transform ${isPanelOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 하단 패널 */}
      <div 
        className={`fixed bottom-0 left-0 right-0 bg-black border-t border-gray-700 shadow-2xl z-40 transition-transform duration-300 ${
          isPanelOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '50vh' }}
      >
        <div className="flex flex-col h-full">
          {/* 소유한 픽셀 목록 */}
          {account && (
            <div className="border-b border-gray-700 p-4" style={{ backgroundColor: '#FFD208' }}>
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setShowOwnedPixels(!showOwnedPixels)}
                  className={`w-6 h-6 flex items-center justify-center rounded transition-all ${
                    showOwnedPixels 
                      ? 'bg-yellow-600 text-black' 
                      : 'bg-black bg-opacity-20 hover:bg-opacity-30 text-black'
                  }`}
                  title={showOwnedPixels ? "숨기기" : "표시하기"}
                  aria-label={showOwnedPixels ? "Hide owned pixels" : "Show owned pixels"}
                >
                  <div className={`transition-opacity ${showOwnedPixels ? 'opacity-100' : 'opacity-0'}`}>
                    {showOwnedPixels ? (
                      <svg 
                        className="w-4 h-4" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      </svg>
                    ) : (
                      <svg 
                        className="w-4 h-4" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </div>
                </button>
                <h3 className="text-sm font-semibold text-black">
                  My Pixels ({ownedPixels.length})
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {ownedPixels.length === 0 ? (
                  <span className="text-xs text-gray-700">No pixels owned</span>
                ) : (
                  ownedPixels.map((pixel) => {
                    const hex = pixel.colorRgb !== 0 
                      ? `#${pixel.colorRgb.toString(16).padStart(6, "0")}` 
                      : "#ffffff";
                    return (
                      <button
                        key={pixel.id}
                        className="flex items-center gap-2 px-2 py-1 text-xs border border-gray-800 hover:bg-yellow-600 transition-colors bg-white"
                        onClick={() => {
                          setSelectedId(pixel.id);
                          setIsPanelOpen(true);
                        }}
                      >
                        <div 
                          className="w-4 h-4 border border-gray-800"
                          style={{ backgroundColor: hex }}
                        />
                        <span className="text-gray-900">#{pixel.id}</span>
                        {pixel.priceWei > 0n && (
                          <span className="text-green-700">
                            {weiToUnits(pixel.priceWei).toString()}u
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* 선택된 픽셀 옵션 */}
          {selectedId != null && (
            <div className="p-4 border-t border-gray-700 overflow-y-auto">
              {/* 가격 변동 차트 */}
              <div className="mb-4">
                <PriceHistoryChart history={priceHistory} pixelId={selectedId} />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-white">#{selectedId}</span>
                
                {!selectedOwned ? (
                  <button
                    className="px-3 h-8 text-white text-xs transition-colors"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                    onClick={() => mint(selectedId)}
                  >
                    Mint
                  </button>
                ) : isSelectedOwner ? (
                  <>
                    <input
                      className="w-20 text-xs border border-gray-300 px-2 h-8 bg-white text-black"
                      placeholder="price (units)"
                      value={priceInput[selectedId] ?? ""}
                      onChange={e => setPriceInput(s => ({ ...s, [selectedId]: e.target.value.replace(/[^0-9]/g, "") }))}
                    />
                    <button
                      className="px-3 h-8 border border-white text-black text-xs hover:bg-yellow-600 transition-colors"
                      style={{ backgroundColor: '#FFD208' }}
                      onClick={() => {
                        const units = BigInt(priceInput[selectedId] ?? "0");
                        const wei = unitsToWei(units);
                        setPrice(selectedId, wei);
                      }}
                    >
                      Set Price
                    </button>
                    <input
                      type="color"
                      className="w-8 h-8 p-0 border border-gray-300 cursor-pointer"
                      value={colorInput[selectedId] ?? `#${((selected?.colorRgb && selected.colorRgb !== 0) ? selected.colorRgb : 0xFFFFFF).toString(16).padStart(6, "0")}`}
                      onChange={e => setColorInput(s => ({ ...s, [selectedId]: e.target.value }))}
                      title="Pick color"
                    />
                    <input
                      className="w-28 text-xs border border-gray-300 px-2 h-8 bg-white text-black font-mono"
                      placeholder="#RRGGBB"
                      value={colorInput[selectedId] ?? `#${((selected?.colorRgb && selected.colorRgb !== 0) ? selected.colorRgb : 0xFFFFFF).toString(16).padStart(6, "0")}`}
                      onChange={e => {
                        const v = e.target.value.trim();
                        // 허용: #RRGGBB 또는 RRGGBB
                        const normalized = v.startsWith('#') ? v : `#${v}`;
                        // 0-9a-fA-F 6자리까지만 유지
                        const m = normalized.match(/^#([0-9a-fA-F]{0,6})$/);
                        if (m) {
                          setColorInput(s => ({ ...s, [selectedId]: `#${m[1].padEnd(0)}` }));
                        }
                      }}
                      title="Enter hex color code"
                    />
                    <button
                      className="px-3 h-8 border border-white text-black text-xs hover:bg-yellow-600 transition-colors"
                      style={{ backgroundColor: '#FFD208' }}
                      onClick={() => setColor(selectedId, colorInput[selectedId] ?? `#${((selected?.colorRgb && selected.colorRgb !== 0) ? selected.colorRgb : 0xFFFFFF).toString(16).padStart(6, "0")}`)}
                    >
                      Set Color
                    </button>
                  </>
                ) : selectedForSale ? (
                  <>
                    <button
                      className="px-3 h-8 bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
                      onClick={() => buy(selectedId, selected!.priceWei)}
                    >
                      Buy
                    </button>
                    <span className="text-xs text-gray-400">
                      {weiToUnits(selected!.priceWei).toString()}u (~{formatWeiToEth(selected!.priceWei)} ETH)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">No actions available</span>
                )}
                
                <button
                  className="px-3 h-8 border border-gray-600 text-gray-300 text-xs hover:bg-gray-800 transition-colors"
                  onClick={() => setSelectedId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {selectedId == null && account && ownedPixels.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-400">
              Select a pixel or click a pixel to interact
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

