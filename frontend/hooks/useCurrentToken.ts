'use client';

import { useState, useEffect, useCallback } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getPresaleTokenPDA, PROGRAM_ID } from '../lib/idl';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

export interface TokenInfo {
  roundId: number;
  mint: PublicKey | null;
  totalSupply: BN | null;
  tokensPerWinner: BN | null;
  loading: boolean;
  error: string | null;
}

export interface DexScreenerData {
  priceUsd: string | null;
  priceChange24h: number | null;
  volume24h: number | null;
  liquidity: number | null;
  pairAddress: string | null;
  dexId: string | null;
  loading: boolean;
  error: string | null;
}

// Parse PresaleToken account data (skip 8-byte discriminator)
function parsePresaleToken(data: Buffer): { roundId: BN; mint: PublicKey; totalSupply: BN; tokensPerWinner: BN } | null {
  try {
    if (data.length < 8 + 8 + 32 + 8 + 8 + 1) return null;
    
    const accountData = data.slice(8); // Skip discriminator
    const roundId = new BN(accountData.slice(0, 8), 'le');
    const mint = new PublicKey(accountData.slice(8, 40));
    const totalSupply = new BN(accountData.slice(40, 48), 'le');
    const tokensPerWinner = new BN(accountData.slice(48, 56), 'le');
    
    return { roundId, mint, totalSupply, tokensPerWinner };
  } catch {
    return null;
  }
}

export function useCurrentToken(roundId: number = 1) {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo>({
    roundId,
    mint: null,
    totalSupply: null,
    tokensPerWinner: null,
    loading: true,
    error: null,
  });

  const [dexData, setDexData] = useState<DexScreenerData>({
    priceUsd: null,
    priceChange24h: null,
    volume24h: null,
    liquidity: null,
    pairAddress: null,
    dexId: null,
    loading: false,
    error: null,
  });

  // Fetch token info from chain
  const fetchTokenInfo = useCallback(async () => {
    setTokenInfo(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const [presaleTokenPDA] = getPresaleTokenPDA(new BN(roundId));
      
      const accountInfo = await connection.getAccountInfo(presaleTokenPDA);
      
      if (!accountInfo) {
        setTokenInfo({
          roundId,
          mint: null,
          totalSupply: null,
          tokensPerWinner: null,
          loading: false,
          error: 'Token not created yet for this round',
        });
        return;
      }

      const parsed = parsePresaleToken(accountInfo.data);
      
      if (!parsed) {
        setTokenInfo({
          roundId,
          mint: null,
          totalSupply: null,
          tokensPerWinner: null,
          loading: false,
          error: 'Failed to parse token data',
        });
        return;
      }

      setTokenInfo({
        roundId,
        mint: parsed.mint,
        totalSupply: parsed.totalSupply,
        tokensPerWinner: parsed.tokensPerWinner,
        loading: false,
        error: null,
      });
    } catch (err) {
      setTokenInfo({
        roundId,
        mint: null,
        totalSupply: null,
        tokensPerWinner: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch token',
      });
    }
  }, [roundId]);

  // Fetch DexScreener data for the token
  const fetchDexScreener = useCallback(async (mintAddress: string) => {
    setDexData(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      // DexScreener API - free, no auth needed
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`
      );
      
      if (!response.ok) {
        throw new Error('DexScreener API error');
      }

      const data = await response.json();
      
      if (!data.pairs || data.pairs.length === 0) {
        setDexData({
          priceUsd: null,
          priceChange24h: null,
          volume24h: null,
          liquidity: null,
          pairAddress: null,
          dexId: null,
          loading: false,
          error: 'No trading pairs found (LP may not exist yet)',
        });
        return;
      }

      // Get the first/most liquid pair
      const pair = data.pairs[0];
      
      setDexData({
        priceUsd: pair.priceUsd || null,
        priceChange24h: pair.priceChange?.h24 || null,
        volume24h: pair.volume?.h24 || null,
        liquidity: pair.liquidity?.usd || null,
        pairAddress: pair.pairAddress || null,
        dexId: pair.dexId || null,
        loading: false,
        error: null,
      });
    } catch (err) {
      setDexData({
        priceUsd: null,
        priceChange24h: null,
        volume24h: null,
        liquidity: null,
        pairAddress: null,
        dexId: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch price data',
      });
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchTokenInfo();
  }, [fetchTokenInfo]);

  // Fetch DexScreener when mint is available
  useEffect(() => {
    if (tokenInfo.mint) {
      fetchDexScreener(tokenInfo.mint.toBase58());
      
      // Poll every 30 seconds for price updates
      const interval = setInterval(() => {
        if (tokenInfo.mint) {
          fetchDexScreener(tokenInfo.mint.toBase58());
        }
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [tokenInfo.mint, fetchDexScreener]);

  return {
    tokenInfo,
    dexData,
    refresh: fetchTokenInfo,
    refreshPrice: () => tokenInfo.mint && fetchDexScreener(tokenInfo.mint.toBase58()),
  };
}
