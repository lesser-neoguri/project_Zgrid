"use client";

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatEther } from "viem";
import type { PriceChangeEvent } from "~~/utils/priceHistory";

interface PriceHistoryChartProps {
  history: PriceChangeEvent[];
  pixelId: number;
}

export const PriceHistoryChart = ({ history, pixelId }: PriceHistoryChartProps) => {
  const chartData = useMemo(() => {
    // 거래(sale)만 필터링하여 시간순으로 정렬
    const sales = history.filter(e => e.eventType === "sale");
    const sorted = [...sales].sort((a, b) => a.timestamp - b.timestamp);

    return sorted.map((event) => ({
      time: new Date(event.timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: event.timestamp,
      price: Number(formatEther(event.priceWei)),
      block: event.blockNumber,
    }));
  }, [history]);

  if (chartData.length === 0) {
    return (
      <div className="w-full">
        <h3 className="text-base font-semibold mb-2 text-white">Price History</h3>
        <div className="flex items-center justify-center h-64 bg-black rounded">
          <p className="text-gray-400">No transactions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-base font-semibold mb-2 text-white">Price History</h3>
      <div className="bg-black rounded p-2">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart 
            data={chartData}
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickFormatter={(value) => `${value.toFixed(2)}`}
              width={50}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded p-2 shadow-lg">
                      <p className="font-semibold text-xs text-white">{data.time}</p>
                      <p className="text-xs text-gray-300">Price: {data.price.toFixed(4)} ETH</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line
              type="linear"
              dataKey="price"
              stroke="#FFD208"
              strokeWidth={1}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
              style={{
                filter: "drop-shadow(0 0 2px rgba(255, 210, 8, 0.8)) drop-shadow(0 0 4px rgba(255, 210, 8, 0.4))",
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

