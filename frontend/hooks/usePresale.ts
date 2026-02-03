'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useProgram } from './useProgram';
import { PresaleRound, UserDeposit } from '../lib/idl';

// Default round ID - can be configured via env or props
const DEFAULT_ROUND_ID = 1;

export interface PresaleState {
  round: PresaleRound | null;
  userDeposit: UserDeposit | null;
  loading: boolean;
  error: string | null;
  roundId: number;
}

export function usePresale(roundId: number = DEFAULT_ROUND_ID) {
  const { publicKey } = useWallet();
  const { 
    fetchPresaleRound, 
    fetchUserDeposit, 
    depositPresale,
    claimRefund,
    claimWinnerTokens,
    connected,
  } = useProgram();

  const [state, setState] = useState<PresaleState>({
    round: null,
    userDeposit: null,
    loading: true,
    error: null,
    roundId,
  });

  const [txLoading, setTxLoading] = useState(false);

  // Fetch presale data
  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const round = await fetchPresaleRound(roundId);
      
      let userDeposit: UserDeposit | null = null;
      if (publicKey && round) {
        userDeposit = await fetchUserDeposit(roundId, publicKey);
      }

      setState({
        round,
        userDeposit,
        loading: false,
        error: null,
        roundId,
      });
    } catch (err) {
      console.error('Error fetching presale data:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch presale data',
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, publicKey?.toBase58()]); // Use string key to prevent object reference changes

  // Initial fetch + refresh when wallet changes
  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, publicKey?.toBase58()]); // Don't depend on refresh to avoid loop

  // Deposit handler
  const deposit = useCallback(async (amountSol: number): Promise<string> => {
    if (!connected) {
      throw new Error('Wallet not connected');
    }

    setTxLoading(true);
    try {
      const signature = await depositPresale(roundId, amountSol);
      // Refresh state after deposit
      await refresh();
      return signature;
    } finally {
      setTxLoading(false);
    }
  }, [connected, roundId, depositPresale, refresh]);

  // Claim refund handler
  const refund = useCallback(async (): Promise<string> => {
    if (!connected) {
      throw new Error('Wallet not connected');
    }

    setTxLoading(true);
    try {
      const signature = await claimRefund(roundId);
      await refresh();
      return signature;
    } finally {
      setTxLoading(false);
    }
  }, [connected, roundId, claimRefund, refresh]);

  // Claim winner tokens handler
  const claimWinner = useCallback(async (): Promise<string> => {
    if (!connected) {
      throw new Error('Wallet not connected');
    }

    setTxLoading(true);
    try {
      const signature = await claimWinnerTokens(roundId);
      await refresh();
      return signature;
    } finally {
      setTxLoading(false);
    }
  }, [connected, roundId, claimWinnerTokens, refresh]);

  // Computed values
  const isActive = state.round && !state.round.isFinalized && 
    Date.now() < state.round.endTime.toNumber() * 1000;
  
  const hasEnded = state.round && 
    Date.now() >= state.round.endTime.toNumber() * 1000;
  
  const isFinalized = state.round?.isFinalized ?? false;

  const totalDepositedSol = state.round 
    ? state.round.totalDeposited.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const userDepositSol = state.userDeposit 
    ? state.userDeposit.amount.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const minDepositSol = state.round 
    ? state.round.minDeposit.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const maxDepositSol = state.round 
    ? state.round.maxDeposit.toNumber() / LAMPORTS_PER_SOL 
    : 0;

  const endTime = state.round 
    ? new Date(state.round.endTime.toNumber() * 1000) 
    : new Date();

  const lotterySpots = state.round?.lotterySpots ?? 0;
  const totalDepositors = state.round?.totalDepositors ?? 0;

  const isWinner = state.userDeposit?.isWinner ?? false;
  const hasClaimed = state.userDeposit?.claimed ?? false;

  return {
    // Raw state
    round: state.round,
    userDeposit: state.userDeposit,
    loading: state.loading,
    txLoading,
    error: state.error,
    roundId,

    // Computed values
    isActive,
    hasEnded,
    isFinalized,
    totalDepositedSol,
    userDepositSol,
    minDepositSol,
    maxDepositSol,
    endTime,
    lotterySpots,
    totalDepositors,
    isWinner,
    hasClaimed,
    roundExists: state.round !== null,

    // Actions
    refresh,
    deposit,
    refund,
    claimWinner,
  };
}
