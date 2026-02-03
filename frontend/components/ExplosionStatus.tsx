'use client';

import { FC } from 'react';
import { useExplosion } from '../hooks/useExplosion';
import { ExplosionCountdown } from './CountdownTimer';
import { ExplosionReason } from '../lib/idl';

interface ExplosionStatusProps {
  roundId: number;
  onExplosion?: () => void;
  className?: string;
}

export const ExplosionStatus: FC<ExplosionStatusProps> = ({
  roundId,
  onExplosion,
  className = '',
}) => {
  const {
    loading,
    isExploded,
    explosionReason,
    explosionReasonText,
    explosionDeadline,
    explosionTime,
    hasPayoutPool,
    totalPayoutSol,
    claimedCount,
    refresh,
  } = useExplosion(roundId);

  if (loading) {
    return (
      <div className={`boom-card ${className}`}>
        <div className="animate-pulse flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-700 rounded-full"></div>
          <div className="h-4 bg-gray-700 rounded w-32"></div>
        </div>
      </div>
    );
  }

  // Already exploded
  if (isExploded) {
    return (
      <div className={`boom-card border-2 border-red-500/50 ${className}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-2xl">
            💥
          </div>
          <div>
            <h3 className="text-xl font-bold text-red-400">EXPLODED!</h3>
            <p className="text-sm text-gray-400">{explosionReasonText}</p>
          </div>
        </div>

        {explosionTime && (
          <p className="text-sm text-gray-400 mb-2">
            Exploded at: {explosionTime.toLocaleString()}
          </p>
        )}

        {hasPayoutPool && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-green-400 font-bold">
              💰 Payout Pool: {totalPayoutSol.toFixed(2)} SOL
            </p>
            <p className="text-sm text-gray-400">
              {claimedCount} claims processed
            </p>
          </div>
        )}
      </div>
    );
  }

  // Timer not started yet (deadline is 0)
  if (!explosionDeadline || explosionDeadline.getTime() <= 0) {
    return (
      <div className={`boom-card border border-gray-700 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xl">
            ⏳
          </div>
          <div>
            <p className="text-gray-400">Awaiting LP creation...</p>
            <p className="text-xs text-gray-500">Timer starts after liquidity is added</p>
          </div>
        </div>
      </div>
    );
  }

  // Timer is active - show countdown
  return (
    <div className={`boom-card border-2 border-yellow-500/50 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-500 to-red-500 flex items-center justify-center text-2xl animate-pulse">
            💣
          </div>
          <div>
            <h3 className="text-lg font-bold text-yellow-400">LIVE</h3>
            <p className="text-xs text-gray-400">Token is trading</p>
          </div>
        </div>
        <ExplosionCountdown 
          deadline={explosionDeadline}
          className="text-xl"
          onComplete={() => {
            refresh();
            onExplosion?.();
          }}
        />
      </div>
    </div>
  );
};
