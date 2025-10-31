"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent, type MouseEvent } from "react";
import { usePixelGrid } from "../hooks/pixelgrid/usePixelGrid";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function Home() {
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
  const { pixels, isRefreshing, refresh, mint, setPrice, buy, setColor, account, message } = usePixelGrid() as any;
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});
  const [colorInput, setColorInput] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") return;
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // MapLibre 지도 초기화
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // 약간의 딜레이 후 초기화 (컨테이너 크기 확정 대기)
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            "carto-dark": {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
                "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
                "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            },
          },
          layers: [
            {
              id: "carto-dark-layer",
              type: "raster",
              source: "carto-dark",
              minzoom: 0,
              maxzoom: 20,
            },
          ],
        },
        center: [0, 20], // 중심 좌표 (경도, 위도)
        zoom: 2, // 초기 줌 레벨
        interactive: false, // 지도 상호작용 비활성화 (Canvas가 상호작용 처리)
      });

      map.on('load', () => {
        console.log('Map loaded successfully');
      });

      mapRef.current = map;
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 지도와 픽셀 그리드 zoom/pan 동기화
  useEffect(() => {
    if (!mapRef.current || !viewport.width || !viewport.height) return;

    const map = mapRef.current;
    
    // 픽셀 그리드 zoom을 지도 zoom으로 매핑 (더 보수적으로)
    // zoom 1.0 -> map zoom 2
    // zoom 2.0 -> map zoom ~2.5
    const baseZoom = 2;
    const zoomFactor = Math.log2(zoom) * 0.5; // 0.5로 더 보수적으로
    const mapZoom = baseZoom + zoomFactor;
    const clampedMapZoom = Math.max(1, Math.min(10, mapZoom)); // 1~10 범위로 제한
    
    // 기본 중심점
    const baseLng = 0;
    const baseLat = 20;
    
    // Pan을 경도/위도 오프셋으로 변환
    // 간단한 선형 매핑으로 변경
    const panSensitivity = 0.5; // 민감도 조정 가능
    const lngOffset = -(pan.x / viewport.width) * 180 * panSensitivity / zoom;
    const latOffset = (pan.y / viewport.height) * 90 * panSensitivity / zoom;
    
    const centerLng = baseLng + lngOffset;
    const centerLat = baseLat + latOffset;
    
    // 위도를 -85~85도로 제한 (Web Mercator 한계)
    const clampedLng = ((centerLng + 180) % 360) - 180; // -180~180으로 순환
    const clampedLat = Math.max(-85, Math.min(85, centerLat));

    // 지도 업데이트 (애니메이션 없이)
    map.jumpTo({
      center: [clampedLng, clampedLat],
      zoom: clampedMapZoom,
    });
  }, [zoom, pan, viewport.width, viewport.height]);

  const selected = useMemo(() => (selectedId != null ? pixels?.[selectedId] : undefined), [selectedId, pixels]);
  const selectedOwned = Boolean(selected?.exists);
  const selectedForSale = (selected?.priceWei ?? 0n) > 0n;
  const isSelectedOwner = selectedOwned && selected?.owner && account && selected.owner.toLowerCase() === String(account).toLowerCase();

  const gridSize = 100;
  const baseCellSize = useMemo(() => {
    const paddingHorizontal = 160;
    const paddingVertical = 220;
    const gapTotal = (gridSize - 1) * 1; // 99개의 1px gap
    const availableWidth = Math.max(320, viewport.width - paddingHorizontal - gapTotal);
    const availableHeight = Math.max(320, viewport.height - paddingVertical - gapTotal);
    const candidate = Math.floor(Math.min(availableWidth, availableHeight) / gridSize);
    return Math.max(3, Math.min(candidate, 50));
  }, [viewport.width, viewport.height]);

  const cellSize = useMemo(() => Math.round(baseCellSize * zoom), [baseCellSize, zoom]);
  const gap = 1;

  const canvasSize = useMemo(() => {
    const total = cellSize * gridSize + gap * (gridSize - 1);
    return total;
  }, [cellSize, gap, gridSize]);

  // Canvas 렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 캔버스 크기 설정
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    // 배경 투명
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // zoom이 너무 작으면 렌더링 생략 (최적화)
    const MIN_ZOOM_FOR_RENDER = 0.2;
    if (zoom < MIN_ZOOM_FOR_RENDER) {
      return;
    }

    // 각 픽셀 그리기
    for (let id = 0; id < gridSize * gridSize; id++) {
      const row = Math.floor(id / gridSize);
      const col = id % gridSize;
      const x = col * (cellSize + gap);
      const y = row * (cellSize + gap);

      const p = pixels[id];
      const colorRgb = p?.colorRgb ?? 0;
      const hasColor = colorRgb !== 0;
      
      // 색칠된 픽셀만 배경 그리기
      if (hasColor) {
        const hex = colorRgb.toString(16).padStart(6, "0");
        ctx.fillStyle = `#${hex}`;
        ctx.fillRect(x, y, cellSize, cellSize);
      }

      // 테두리 - 선택되었거나 색칠된 픽셀만 표시
      if (selectedId === id) {
        // 선택된 픽셀: 진한 파란 테두리
        ctx.strokeStyle = "#2563eb"; // blue-600
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellSize, cellSize);
      } else if (hasColor) {
        // 색칠된 픽셀: 얇은 테두리
        ctx.strokeStyle = "rgba(156, 163, 175, 0.4)"; // gray-400 with 40% opacity
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellSize, cellSize);
      }
      // 색칠되지 않은 픽셀은 테두리 없음 (지도가 보이게)
    }
  }, [pixels, cellSize, gap, canvasSize, selectedId, gridSize, zoom]);

  const handleZoomWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    // 모든 휠 이벤트를 확대/축소로 처리 (스크롤 방지)
    event.preventDefault();
    event.stopPropagation();
    
    const delta = -event.deltaY * 0.0012;
    if (delta === 0) return;

    setZoom(prev => {
      const next = prev + delta;
      const bounded = Math.max(0.05, next);
      return Number(bounded.toFixed(3));
    });
  }, []);

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

    console.log('Calculated:', { row, col, id: row * gridSize + col });

    if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) {
      const id = row * gridSize + col;
      setSelectedId(id);
    }
  }, [cellSize, gap, gridSize, pan, isDragging]);

  return (
    <div className="h-screen w-full flex flex-col items-center gap-4 overflow-hidden" style={{ background: '#1a1a1a' }}>
      {message && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-md shadow-lg z-50 text-sm">
          {message}
        </div>
      )}
      <div 
        ref={containerRef}
        className="flex-1 w-full relative overflow-hidden"
        style={{ position: 'relative' }}
      >
        {/* 배경: MapLibre 지도 */}
        <div 
          ref={mapContainerRef} 
          className="absolute inset-0"
          style={{ 
            opacity: 0.6,
            zIndex: 0,
            width: '100%',
            height: '100%'
          }}
        />
        
        {/* 전면: 픽셀 그리드 Canvas */}
        <div 
          className="absolute inset-0 flex items-center justify-center px-6"
          style={{ zIndex: 10, pointerEvents: 'none' }}
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
              pointerEvents: 'auto'
            }}
          />
        </div>
      </div>

      {/* 하단 옵션 바 */}
      {selectedId != null && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md shadow-lg border bg-gray-900 text-white px-4 py-3 flex items-center gap-3 z-50">
          <span className="text-sm font-medium">#{selectedId}</span>
          {!selectedOwned ? (
            <button
              className="px-3 h-8 bg-[#FFD208] border text-black text-sm"
              onClick={() => mint(selectedId)}
              aria-label="mint"
              title="mint"
            >Mint</button>
          ) : isSelectedOwner ? (
            <>
              <input
                className="w-24 text-xs border px-2 h-8 bg-white text-black"
                placeholder={`price (units) 1=0.01 ETH`}
                value={priceInput[selectedId] ?? ""}
                onChange={e => setPriceInput(s => ({ ...s, [selectedId]: e.target.value.replace(/[^0-9]/g, "") }))}
              />
              <button
                className="px-3 h-8 bg-black text-white text-sm"
                onClick={() => {
                  const units = BigInt(priceInput[selectedId] ?? "0");
                  const wei = unitsToWei(units);
                  setPrice(selectedId, wei);
                }}
                aria-label="set-price"
                title="set-price"
              >Set Price</button>
              <input
                type="color"
                className="w-10 h-8 p-0 border bg-white"
                value={colorInput[selectedId] ?? `#${((selected?.colorRgb && selected.colorRgb !== 0) ? selected.colorRgb : 0xFFFFFF).toString(16).padStart(6, "0")}`}
                onChange={e => setColorInput(s => ({ ...s, [selectedId]: e.target.value }))}
              />
              <button
                className="px-3 h-8 bg-green-700 text-white text-sm"
                onClick={() => setColor(selectedId, colorInput[selectedId] ?? `#${((selected?.colorRgb && selected.colorRgb !== 0) ? selected.colorRgb : 0xFFFFFF).toString(16).padStart(6, "0")}`)}
                aria-label="set-color"
                title="set-color"
              >Set Color</button>
            </>
          ) : selectedForSale ? (
            <button
              className="px-3 h-8 bg-green-600 text-white text-sm"
              onClick={() => buy(selectedId, selected!.priceWei)}
              aria-label="buy"
              title="buy"
            >Buy</button>
          ) : (
            <span className="text-xs text-gray-300">No actions available</span>
          )}
          {(!isSelectedOwner && selectedForSale) && (
            <span className="text-xs text-gray-300">Price: {weiToUnits(selected!.priceWei).toString()} u (~{formatWeiToEth(selected!.priceWei)} ETH)</span>
          )}
          <button
            className="px-2 h-8 border border-gray-600 bg-gray-700 text-white text-sm"
            onClick={() => setSelectedId(null)}
            aria-label="close"
            title="close"
          >Close</button>
        </div>
      )}
    </div>
  );
}
