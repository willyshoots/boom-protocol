'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  ColorType, 
  CandlestickData, 
  Time, 
  IChartApi,
  CandlestickSeries
} from 'lightweight-charts';
import { useCurrentToken } from '../hooks/useCurrentToken';

interface TradingChartProps {
  tokenSymbol: string;
  marketCap: number;
  roundId?: number;
}

// Generate mock candlestick data (fallback when no real data)
const generateMockData = (basePrice: number = 0.001): CandlestickData<Time>[] => {
  const data: CandlestickData<Time>[] = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  
  for (let i = 100; i >= 0; i--) {
    const time = (now - i * 60) as Time;
    const volatility = 0.05;
    const trend = Math.random() > 0.45 ? 1 : -1;
    
    const open = price;
    const change = price * volatility * Math.random() * trend;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    
    data.push({ time, open, high, low, close });
    price = close;
  }
  
  return data;
};

export const TradingChart: FC<TradingChartProps> = ({ 
  tokenSymbol, 
  marketCap,
  roundId = 1 
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  const dataRef = useRef<CandlestickData<Time>[]>([]);
  
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [showDexScreener, setShowDexScreener] = useState(false);

  // Get current token data
  const { tokenInfo, dexData } = useCurrentToken(roundId);

  // Update price from DexScreener data
  useEffect(() => {
    if (dexData.priceUsd) {
      setCurrentPrice(parseFloat(dexData.priceUsd));
    }
    if (dexData.priceChange24h !== null) {
      setPriceChange(dexData.priceChange24h);
    }
  }, [dexData]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(42, 42, 42, 0.5)' },
        horzLines: { color: 'rgba(42, 42, 42, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        borderColor: '#2a2a2a',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
      },
      crosshair: {
        vertLine: {
          color: '#ff6b35',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: '#ff6b35',
          width: 1,
          style: 2,
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Use real price as base if available, otherwise mock
    const basePrice = dexData.priceUsd ? parseFloat(dexData.priceUsd) : 0.001;
    const data = generateMockData(basePrice);
    dataRef.current = data;
    candlestickSeries.setData(data);

    const lastCandle = data[data.length - 1];
    if (!dexData.priceUsd) {
      setCurrentPrice(lastCandle.close);
      const firstCandle = data[0];
      const change = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
      setPriceChange(change);
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Simulate live updates
    const interval = setInterval(() => {
      const currentData = dataRef.current;
      const lastData = currentData[currentData.length - 1];
      const volatility = 0.03;
      const trend = Math.random() > 0.45 ? 1 : -1;
      
      const newTime = ((lastData.time as number) + 60) as Time;
      const open = lastData.close;
      const changeVal = open * volatility * Math.random() * trend;
      const close = open + changeVal;
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      
      const newCandle: CandlestickData<Time> = { time: newTime, open, high, low, close };
      currentData.push(newCandle);
      candlestickSeries.update(newCandle);
      
      // Only update price if no DexScreener data
      if (!dexData.priceUsd) {
        setCurrentPrice(close);
        const priceChangePercent = ((close - currentData[0].open) / currentData[0].open) * 100;
        setPriceChange(priceChangePercent);
      }
    }, 3000);

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(interval);
      chart.remove();
    };
  }, [dexData.priceUsd]);

  // DexScreener embed URL
  const dexScreenerUrl = tokenInfo.mint 
    ? `https://dexscreener.com/solana/${tokenInfo.mint.toBase58()}?embed=1&theme=dark&trades=0&info=0`
    : null;

  return (
    <div className="chart-container p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold text-white">${tokenSymbol}</span>
          <span className="px-2 py-1 bg-green-500/20 text-green-400 text-sm rounded-full flex items-center gap-1">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            {dexData.priceUsd ? 'LIVE' : 'DEMO'}
          </span>
          {dexScreenerUrl && (
            <button
              onClick={() => setShowDexScreener(!showDexScreener)}
              className="px-2 py-1 bg-blue-500/20 text-blue-400 text-sm rounded-full hover:bg-blue-500/30 transition"
            >
              {showDexScreener ? 'Simple Chart' : 'DexScreener'}
            </button>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-400">
            {dexData.priceUsd ? 'Price (USD)' : 'Price (Demo)'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">
              ${currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(4)}
            </span>
            <span className={`text-sm ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {priceChange >= 0 ? '↑' : '↓'} {Math.abs(priceChange).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* Token Info Banner */}
      {tokenInfo.mint && (
        <div className="mb-4 p-2 bg-gray-800/50 rounded-lg flex items-center justify-between text-sm">
          <span className="text-gray-400">Token:</span>
          <a 
            href={`https://solscan.io/token/${tokenInfo.mint.toBase58()}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 font-mono"
          >
            {tokenInfo.mint.toBase58().slice(0, 8)}...{tokenInfo.mint.toBase58().slice(-6)}
          </a>
          {dexData.liquidity && (
            <span className="text-gray-400">
              Liquidity: <span className="text-white">${dexData.liquidity.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}

      {/* Loading state for token */}
      {tokenInfo.loading && (
        <div className="mb-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 text-yellow-400 text-sm">
          Loading token data...
        </div>
      )}

      {/* Token not created yet */}
      {!tokenInfo.loading && !tokenInfo.mint && (
        <div className="mb-4 p-3 bg-orange-500/10 rounded-lg border border-orange-500/30 text-orange-400 text-sm">
          ⏳ Token not created yet for Round {roundId}. Showing demo chart.
        </div>
      )}

      {/* No LP yet */}
      {tokenInfo.mint && !dexData.loading && dexData.error && (
        <div className="mb-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/30 text-blue-400 text-sm">
          📊 {dexData.error}. Showing simulated chart based on token data.
        </div>
      )}

      {/* Market Cap Banner */}
      <div className="mb-4 p-3 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 rounded-lg border border-orange-500/30">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Market Cap</span>
          <span className="text-2xl font-bold text-orange-400">
            ${marketCap.toLocaleString()}
          </span>
        </div>
        <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-all duration-500"
            style={{ width: `${Math.min((marketCap / 10000000) * 100, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>$0</span>
          <span className="text-orange-400">💥 Secret Threshold</span>
          <span>$10M</span>
        </div>
      </div>

      {/* Chart - either DexScreener embed or lightweight-charts */}
      {showDexScreener && dexScreenerUrl ? (
        <div className="w-full h-[400px] rounded-lg overflow-hidden">
          <iframe
            src={dexScreenerUrl}
            className="w-full h-full border-0"
            title="DexScreener Chart"
          />
        </div>
      ) : (
        <div ref={chartContainerRef} />
      )}

      {/* Volume/Liquidity stats */}
      {dexData.volume24h !== null && (
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <span className="text-gray-400">24h Volume</span>
            <div className="text-lg font-bold text-white">
              ${dexData.volume24h?.toLocaleString() || '0'}
            </div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <span className="text-gray-400">DEX</span>
            <div className="text-lg font-bold text-white capitalize">
              {dexData.dexId || 'N/A'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
