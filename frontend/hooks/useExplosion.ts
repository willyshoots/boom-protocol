'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useProgram } from './useProgram';
import { PresaleExplosion, PayoutPool, PresaleToken, ExplosionReason } from '../lib/idl';

export interface ExplosionState {
  explosion: PresaleExplosion | null;
  payoutPool: PayoutPool | null;
  presaleToken: PresaleToken | null;
  loading: boolean;
  error: string | null;
}

export function useExplosion(roundId: number) {
  const { publicKey } = useWallet();
  const { 
    fetchPresaleExplosion, 
    fetchPayoutPool,
    fetchPresaleToken,
    claimExplosionPayout,
    connected,
  } = useProgram();

  const [state, setState] = useState<ExplosionState>({
    explosion: null,
    payoutPool: null,
    presaleToken: null,
    loading: true,
    error: null,
  });

  const [txLoading, setTxLoading] = useState(false);

  // Fetch explosion data
  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const [explosion, payoutPool, presaleToken] = await Promise.all([
        fetchPresaleExplosion(roundId),
        fetchPayoutPool(roundId),
        fetchPresaleToken(roundId),
      ]);

      setState({
        explosion,
        payoutPool,
        presaleToken,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error fetching explosion data:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch explosion data',
      }));
    }
  }, [roundId, fetchPresaleExplosion, fetchPayoutPool, fetchPresaleToken]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Claim payout handler
  const claimPayout = useCallback(async (): Promise<string> => {
    if (!connected) {
      throw new Error('Wallet not connected');
    }
    if (!state.presaleToken?.mint) {
      throw new Error('No token mint found');
    }

    setTxLoading(true);
    try {
      const signature = await claimExplosionPayout(roundId, state.presaleToken.mint);
      await refresh();
      return signature;
    } finally {
      setTxLoading(false);
    }
  }, [connected, roundId, state.presaleToken, claimExplosionPayout, refresh]);

  // Computed values
  const isExploded = state.explosion?.isExploded ?? false;
  const explosionReason = state.explosion?.explosionReason ?? ExplosionReason.None;
  const explosionReasonText = explosionReason === ExplosionReason.CapHit 
    ? '🎯 Market Cap Hit!' 
    : explosionReason === ExplosionReason.TimeLimit 
    ? '⏰ Time Limit Reached!' 
    : 'Not Exploded';
  
  const revealedCapSol = state.explosion 
    ? state.explosion.revealedCap.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const explosionDeadline = state.explosion?.explosionDeadline.toNumber() 
    ? new Date(state.explosion.explosionDeadline.toNumber() * 1000) 
    : null;

  const explosionTime = state.explosion?.explosionTime.toNumber() 
    ? new Date(state.explosion.explosionTime.toNumber() * 1000) 
    : null;

  const totalPayoutSol = state.payoutPool 
    ? state.payoutPool.totalSol.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const claimedCount = state.payoutPool?.claimedCount ?? 0;
  const hasPayoutPool = state.payoutPool !== null && state.payoutPool.totalSol.toNumber() > 0;
  
  const tokenMint = state.presaleToken?.mint ?? null;

  return {
    // Raw state
    explosion: state.explosion,
    payoutPool: state.payoutPool,
    presaleToken: state.presaleToken,
    loading: state.loading,
    txLoading,
    error: state.error,

    // Computed values
    isExploded,
    explosionReason,
    explosionReasonText,
    revealedCapSol,
    explosionDeadline,
    explosionTime,
    totalPayoutSol,
    claimedCount,
    hasPayoutPool,
    tokenMint,

    // Actions
    refresh,
    claimPayout,
  };
}
