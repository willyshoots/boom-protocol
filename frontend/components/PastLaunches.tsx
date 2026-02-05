'use client';

import { FC, useState } from 'react';
import { usePoolList, formatPrice, formatSol } from '../hooks/useChartData';

interface PastLaunchesProps {
  onSelectRound: (roundId: string) => void;
  currentRoundId?: string;
}

export const PastLaunches: FC<PastLaunchesProps> = ({ 
  onSelectRound,
  currentRoundId,
}) => {
  const { pools, currentRound, loading, error, refresh } = usePoolList();
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="p-4 bg-gray-900/50 rounded-xl border border-gray-800">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Loading past launches...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 rounded-xl border border-red-800">
        <div className="text-red-400 text-sm">{error}</div>
        <button 
          onClick={refresh}
          className="mt-2 text-xs text-red-300 hover:text-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="p-4 bg-gray-900/50 rounded-xl border border-gray-800">
        <div className="text-gray-400 text-sm">No launches yet</div>
      </div>
    );
  }

  const displayPools = expanded ? pools : pools.slice(0, 5);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-white">📜 Past Launches</span>
          <span className="text-sm text-gray-400">({pools.length})</span>
        </div>
        <button
          onClick={refresh}
          className="text-gray-400 hover:text-white transition"
          title="Refresh"
        >
          🔄
        </button>
      </div>

      {/* Pool list */}
      <div className="divide-y divide-gray-800">
        {displayPools.map((pool) => {
          const isCurrentRound = pool.roundId === currentRound;
          const isSelected = pool.roundId === currentRoundId;
          
          return (
            <button
              key={pool.roundId}
              onClick={() => onSelectRound(pool.roundId)}
              className={`w-full p-4 text-left hover:bg-gray-800/50 transition ${
                isSelected ? 'bg-orange-500/10 border-l-2 border-orange-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Round badge */}
                  <div className={`px-2 py-1 rounded text-xs font-mono ${
                    isCurrentRound 
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}>
                    R{pool.roundId.slice(-6)}
                  </div>
                  
                  {/* Token address */}
                  <div className="text-sm">
                    <span className="text-gray-300 font-mono">
                      {pool.mint.slice(0, 6)}...{pool.mint.slice(-4)}
                    </span>
                  </div>
                </div>

                {/* Price */}
                <div className="text-right">
                  <div className="text-white font-mono text-sm">
                    {formatPrice(pool.currentPrice)}
                  </div>
                  {pool.hasChartData && (
                    <div className="text-xs text-gray-500">
                      {pool.candleCount} candles
                    </div>
                  )}
                </div>
              </div>

              {/* Status tags */}
              <div className="mt-2 flex items-center gap-2">
                {isCurrentRound && (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                    LIVE
                  </span>
                )}
                {pool.hasChartData && (
                  <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
                    📊 Chart
                  </span>
                )}
                {!pool.hasChartData && (
                  <span className="px-2 py-0.5 bg-gray-700 text-gray-400 text-xs rounded-full">
                    No data
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Show more button */}
      {pools.length > 5 && (
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-center text-sm text-gray-400 hover:text-white transition"
          >
            {expanded ? 'Show less ↑' : `Show ${pools.length - 5} more ↓`}
          </button>
        </div>
      )}
    </div>
  );
};

export default PastLaunches;
