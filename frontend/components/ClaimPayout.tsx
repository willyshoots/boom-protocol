'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useExplosion } from '../hooks/useExplosion';

interface ClaimPayoutProps {
  roundId: number;
  className?: string;
}

export const ClaimPayout: FC<ClaimPayoutProps> = ({ roundId, className = '' }) => {
  const { connected } = useWallet();
  const {
    loading,
    txLoading,
    isExploded,
    hasPayoutPool,
    totalPayoutSol,
    claimedCount,
    tokenMint,
    claimPayout,
    error,
  } = useExplosion(roundId);

  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const handleClaim = async () => {
    setClaimError(null);
    setTxSignature(null);
    
    try {
      const sig = await claimPayout();
      setTxSignature(sig);
      setClaimed(true);
    } catch (err) {
      console.error('Claim payout error:', err);
      setClaimError(err instanceof Error ? err.message : 'Claim failed');
    }
  };

  // Not exploded yet - don't show
  if (!isExploded) {
    return null;
  }

  // No payout pool yet (LP not unwound)
  if (!hasPayoutPool) {
    return (
      <div className={`boom-card border border-gray-700 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-xl animate-pulse">
            ⏳
          </div>
          <div>
            <p className="text-yellow-400 font-medium">Awaiting LP Unwind</p>
            <p className="text-xs text-gray-500">Payout pool will be available shortly</p>
          </div>
        </div>
      </div>
    );
  }

  // Already claimed
  if (claimed) {
    return (
      <div className={`boom-card border-2 border-green-500/50 ${className}`}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">✅</span>
          <div>
            <h3 className="text-lg font-bold text-green-400">Payout Claimed!</h3>
            <p className="text-sm text-gray-400">Your SOL has been sent to your wallet</p>
          </div>
        </div>
        {txSignature && (
          <a 
            href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:underline"
          >
            View transaction →
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`boom-card border-2 border-green-500/50 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-2xl">
          💰
        </div>
        <div>
          <h3 className="text-xl font-bold text-green-400">Claim Your SOL</h3>
          <p className="text-sm text-gray-400">Burn tokens → receive proportional SOL</p>
        </div>
      </div>

      {/* Pool info */}
      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400">Total Payout Pool:</span>
          <span className="text-white font-bold">{totalPayoutSol.toFixed(4)} SOL</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Claims Processed:</span>
          <span className="text-gray-300">{claimedCount}</span>
        </div>
      </div>

      {claimError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm">❌ {claimError}</p>
        </div>
      )}

      {!connected ? (
        <p className="text-center text-gray-400 py-2">Connect wallet to claim</p>
      ) : !tokenMint ? (
        <p className="text-center text-gray-400 py-2">No token found for this round</p>
      ) : (
        <button
          onClick={handleClaim}
          disabled={txLoading || loading}
          className="w-full py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {txLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Claiming...
            </>
          ) : (
            '🔥 CLAIM SOL PAYOUT'
          )}
        </button>
      )}

      <p className="text-xs text-gray-500 mt-3 text-center">
        Your tokens will be burned and you&apos;ll receive SOL based on your share
      </p>
    </div>
  );
};
