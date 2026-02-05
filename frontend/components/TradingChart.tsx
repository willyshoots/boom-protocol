'use client';

import { FC, useEffect, useRef, useState, useCallback } from 'react';
import { 
  createChart, 
  ColorType, 
  CandlestickData, 
  Time, 
  IChartApi,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts';
import { useChartData, formatPrice, formatSol } from '../hooks/useChartData';

interface TradingChartProps {
  roundId: string | number;
  tokenSymbol?: string;
  onPriceUpdate?: (price: number | null) => void;
}

export const TradingChart: FC<TradingChartProps> = ({ 
  roundId,
  tokenSymbol = 'BOOM',
  onPriceUpdate,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  const volumeSeriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  
  const [priceChange, setPriceChange] = useState<number>(0);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('1m');
  
  // Fetch chart data from our API
  const { data, loading, error } = useChartData(roundId);
  
  // Notify parent of price updates
  useEffect(() => {
    if (onPriceUpdate && data?.currentPrice !== undefined) {
      onPriceUpdate(data.currentPrice);
    }
  }, [data?.currentPrice, onPriceUpdate]);

  // Calculate price change
  useEffect(() => {
    if (data?.candles && data.candles.length > 1) {
      const first = data.candles[0];
      const last = data.candles[data.candles.length - 1];
      const change = ((last.close - first.open) / first.open) * 100;
      setPriceChange(change);
    }
  }, [data?.candles]);

  // Initialize and update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart if it doesn't exist
    if (!chartRef.current) {
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
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: '#2a2a2a',
          scaleMargins: {
            top: 0.1,
            bottom: 0.2,
          },
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

      // Candlestick series
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      // Volume series
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      });

      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
    }

    // Update data
    if (data?.candles && data.candles.length > 0 && candleSeriesRef.current) {
      const candleData: CandlestickData<Time>[] = data.candles.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candleSeriesRef.current.setData(candleData);

      // Volume data
      if (volumeSeriesRef.current) {
        const volumeData = data.candles.map((c, i) => ({
          time: c.time as Time,
          value: c.volume,
          color: i > 0 && c.close >= data.candles[i - 1].close 
            ? 'rgba(34, 197, 94, 0.5)' 
            : 'rgba(239, 68, 68, 0.5)',
        }));
        volumeSeriesRef.current.setData(volumeData);
      }

      chartRef.current?.timeScale().fitContent();
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth 
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [data?.candles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Aggregate candles for different timeframes
  const aggregateCandles = useCallback((minutes: number) => {
    if (!data?.candles || data.candles.length === 0) return;
    
    const aggregated: CandlestickData<Time>[] = [];
    const interval = minutes * 60;
    
    let currentCandle: CandlestickData<Time> | null = null;
    
    for (const c of data.candles) {
      const candleTime = (Math.floor(c.time / interval) * interval) as Time;
      
      if (!currentCandle || currentCandle.time !== candleTime) {
        if (currentCandle) aggregated.push(currentCandle);
        currentCandle = {
          time: candleTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, c.high);
        currentCandle.low = Math.min(currentCandle.low, c.low);
        currentCandle.close = c.close;
      }
    }
    
    if (currentCandle) aggregated.push(currentCandle);
    
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(aggregated);
      chartRef.current?.timeScale().fitContent();
    }
  }, [data?.candles]);

  // Handle timeframe change
  useEffect(() => {
    const minutes = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[timeframe];
    aggregateCandles(minutes);
  }, [timeframe, aggregateCandles]);

  return (
    <div className="chart-container p-4 bg-gray-900/50 rounded-xl border border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold text-white">${tokenSymbol}</span>
          <span className={`px-2 py-1 text-sm rounded-full flex items-center gap-1 ${
            loading 
              ? 'bg-yellow-500/20 text-yellow-400'
              : error 
                ? 'bg-red-500/20 text-red-400'
                : 'bg-green-500/20 text-green-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              loading 
                ? 'bg-yellow-400 animate-pulse'
                : error 
                  ? 'bg-red-400'
                  : 'bg-green-400 animate-pulse'
            }`} />
            {loading ? 'LOADING' : error ? 'ERROR' : 'LIVE'}
          </span>
        </div>
        
        <div className="text-right">
          <div className="text-sm text-gray-400">Price (SOL)</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono">
              {formatPrice(data?.currentPrice ?? null)}
            </span>
            {data?.candles && data.candles.length > 1 && (
              <span className={`text-sm ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceChange >= 0 ? '↑' : '↓'} {Math.abs(priceChange).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Timeframe selector */}
      <div className="flex gap-2 mb-4">
        {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-3 py-1 text-sm rounded-lg transition ${
              timeframe === tf
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Pool stats */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
          <div className="p-2 bg-gray-800/50 rounded-lg">
            <span className="text-gray-400">SOL Reserve</span>
            <div className="text-white font-mono">{formatSol(data.solReserve)}</div>
          </div>
          <div className="p-2 bg-gray-800/50 rounded-lg">
            <span className="text-gray-400">Token Reserve</span>
            <div className="text-white font-mono">
              {data.tokenReserve > 1e9 
                ? `${(data.tokenReserve / 1e9).toFixed(2)}B`
                : data.tokenReserve > 1e6
                  ? `${(data.tokenReserve / 1e6).toFixed(2)}M`
                  : data.tokenReserve.toLocaleString()
              }
            </div>
          </div>
          <div className="p-2 bg-gray-800/50 rounded-lg">
            <span className="text-gray-400">Volume</span>
            <div className="text-white font-mono">{formatSol(data.totalVolume)} SOL</div>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && !data?.candles?.length && (
        <div className="mb-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* No data message */}
      {!loading && !error && (!data?.candles || data.candles.length === 0) && (
        <div className="mb-4 p-3 bg-orange-500/10 rounded-lg border border-orange-500/30 text-orange-400 text-sm">
          ⏳ No trading data yet. Chart will populate when swaps occur.
        </div>
      )}

      {/* Chart container */}
      <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />

      {/* Token info */}
      {data?.mint && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
          <span>Pool: {data.pool?.slice(0, 8)}...{data.pool?.slice(-6)}</span>
          <a 
            href={`https://solscan.io/token/${data.mint}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            View on Solscan ↗
          </a>
        </div>
      )}
    </div>
  );
};

export default TradingChart;
