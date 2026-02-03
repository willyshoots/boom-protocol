'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useProgram } from './useProgram';

export type ClaimStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseTokenClaimResult {
  /** Current claim status */
  status: ClaimStatus;
  /** Loading state for claim transaction */
  isLoading: boolean;
  /** Success state */
  isSuccess: boolean;
  /** Error state */
  isError: boolean;
  /** Error message if claim failed */
  errorMessage: string | null;
  /** Transaction signature if successful */
  txSignature: string | null;
  /** Execute the claim */
  claim: () => Promise<string>;
  /** Reset state to idle */
  reset: () => void;
}

/**
 * Hook for claiming winner tokens from a presale round.
 * 
 * @param roundId - The presale round ID
 * @param tokenMint - The token mint address
 * @param isWinner - Whether the user is a lottery winner
 * @param hasClaimed - Whether the user has already claimed
 * @param onSuccess - Optional callback on successful claim
 * @param onError - Optional callback on claim error
 */
export function useTokenClaim(
  roundId: number,
  tokenMint: PublicKey | null,
  isWinner: boolean,
  hasClaimed: boolean,
  onSuccess?: (signature: string) => void,
  onError?: (error: Error) => void
): UseTokenClaimResult {
  const { connected } = useWallet();
  const { claimWinnerTokens } = useProgram();

  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const claim = useCallback(async (): Promise<string> => {
    // Pre-flight checks
    if (!connected) {
      const error = new Error('Wallet not connected');
      setStatus('error');
      setErrorMessage(error.message);
      onError?.(error);
      throw error;
    }

    if (!isWinner) {
      const error = new Error('You are not a lottery winner');
      setStatus('error');
      setErrorMessage(error.message);
      onError?.(error);
      throw error;
    }

    if (hasClaimed) {
      const error = new Error('Tokens have already been claimed');
      setStatus('error');
      setErrorMessage(error.message);
      onError?.(error);
      throw error;
    }

    if (!tokenMint) {
      const error = new Error('Token not yet created for this round');
      setStatus('error');
      setErrorMessage(error.message);
      onError?.(error);
      throw error;
    }

    // Execute claim
    setStatus('loading');
    setErrorMessage(null);
    setTxSignature(null);

    try {
      const signature = await claimWinnerTokens(roundId, tokenMint);
      setStatus('success');
      setTxSignature(signature);
      onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Claim failed');
      
      // Parse common Solana errors for better UX
      let friendlyMessage = error.message;
      if (error.message.includes('0x1770')) {
        friendlyMessage = 'Not a lottery winner';
      } else if (error.message.includes('0x1773')) {
        friendlyMessage = 'Already claimed';
      } else if (error.message.includes('User rejected')) {
        friendlyMessage = 'Transaction cancelled';
      } else if (error.message.includes('insufficient funds')) {
        friendlyMessage = 'Insufficient SOL for transaction fees';
      }

      setStatus('error');
      setErrorMessage(friendlyMessage);
      onError?.(new Error(friendlyMessage));
      throw new Error(friendlyMessage);
    }
  }, [connected, isWinner, hasClaimed, tokenMint, roundId, claimWinnerTokens, onSuccess, onError]);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
    setTxSignature(null);
  }, []);

  return {
    status,
    isLoading: status === 'loading',
    isSuccess: status === 'success',
    isError: status === 'error',
    errorMessage,
    txSignature,
    claim,
    reset,
  };
}
