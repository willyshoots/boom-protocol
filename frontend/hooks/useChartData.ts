'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartData {
  pool: string;
  roundId: string;
  mint: string;
  currentPrice: number | null;
  solReserve: number;
  tokenReserve: number;
  totalVolume: number;
  candles: Candle[];
  candleInterval: number;
}

export interface PoolListItem {
  roundId: string;
  poolAddress: string;
  mint: string;
  hasChartData: boolean;
  candleCount: number;
  lastUpdate: number | null;
  currentPrice: number | null;
}

export interface UseChartDataResult {
  data: ChartData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface UsePoolListResult {
  pools: PoolListItem[];
  currentRound: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Fetch chart data for a specific round
export function useChartData(roundId: string | number | null): UseChartDataResult {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    if (!roundId) {
      setData(null);
      return;
    }

    try {
      const response = await fetch(`/api/chart/${roundId}?roundId=${roundId}`);
      const result = await response.json();

      if (result.error && !result.candles?.length) {
        setError(result.error);
        setData(null);
      } else {
        setError(null);
        setData(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch chart data');
    }
  }, [roundId]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Poll for updates every 5 seconds
  useEffect(() => {
    if (!roundId) return;

    intervalRef.current = setInterval(fetchData, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [roundId, fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}

// Fetch list of all pools
export function usePoolList(): UsePoolListResult {
  const [pools, setPools] = useState<PoolListItem[]>([]);
  const [currentRound, setCurrentRound] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPools = useCallback(async () => {
    try {
      const response = await fetch('/api/pools');
      const result = await response.json();

      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setPools(result.pools || []);
        setCurrentRound(result.currentRound);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch pools');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPools().finally(() => setLoading(false));
  }, [fetchPools]);

  return {
    pools,
    currentRound,
    loading,
    error,
    refresh: fetchPools,
  };
}

// Format price for display
export function formatPrice(price: number | null): string {
  if (price === null) return '—';
  if (price === 0) return '0';
  
  // Very small prices (typical for meme tokens)
  if (price < 0.000001) {
    return price.toExponential(4);
  }
  if (price < 0.0001) {
    return price.toFixed(10);
  }
  if (price < 0.01) {
    return price.toFixed(8);
  }
  if (price < 1) {
    return price.toFixed(6);
  }
  if (price < 100) {
    return price.toFixed(4);
  }
  return price.toFixed(2);
}

// Format SOL amount
export function formatSol(amount: number): string {
  if (amount < 0.001) return '<0.001';
  if (amount < 1) return amount.toFixed(4);
  if (amount < 1000) return amount.toFixed(2);
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
