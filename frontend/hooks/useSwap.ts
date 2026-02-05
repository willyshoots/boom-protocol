'use client';

import { useCallback, useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import {
  PROGRAM_ID,
  HOOK_PROGRAM_ID,
  getPoolPDA,
  getTokenVaultPDA,
  getSolVaultPDA,
  getExtraAccountMetasPDA,
  getHookConfigPDA,
  getHookWhitelistPDA,
  getPresaleTokenPDA,
} from '../lib/idl';
import * as crypto from 'crypto';

// Anchor instruction discriminator
function getDiscriminator(name: string): Buffer {
  return Buffer.from(
    crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8)
  );
}

interface PoolState {
  mint: PublicKey;
  solReserve: bigint;
  tokenReserve: bigint;
  feeBps: number;
}

interface SwapQuote {
  amountIn: number;
  amountOut: number;
  priceImpact: number;
  fee: number;
}

export function useSwap(roundId: number) {
  const { connection } = useConnection();
  const wallet = useWallet();
  
  const [loading, setLoading] = useState(false);
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [userTokenBalance, setUserTokenBalance] = useState<bigint>(BigInt(0));
  const [error, setError] = useState<string | null>(null);

  const roundIdBN = new BN(roundId);
  const [poolPda] = getPoolPDA(roundIdBN);
  const [tokenVaultPda] = getTokenVaultPDA(roundIdBN);
  const [solVaultPda] = getSolVaultPDA(roundIdBN);

  // Fetch pool state
  const fetchPoolState = useCallback(async () => {
    try {
      const accountInfo = await connection.getAccountInfo(poolPda);
      if (!accountInfo) {
        setPoolState(null);
        return;
      }

      // Parse Pool struct
      // Layout: discriminator (8) + round_id (8) + mint (32) + token_vault (32) + 
      //         sol_vault_bump (1) + token_vault_bump (1) + bump (1) + fee_bps (2) + ...
      //         sol_reserve (8) + token_reserve (8) + ...
      const data = accountInfo.data;
      const mint = new PublicKey(data.slice(16, 48));
      
      // Find sol_reserve and token_reserve positions
      // This may need adjustment based on actual struct layout
      // Let's read from a reasonable offset
      const solReserve = data.readBigUInt64LE(80);
      const tokenReserve = data.readBigUInt64LE(88);
      const feeBps = data.readUInt16LE(78);

      setPoolState({
        mint,
        solReserve,
        tokenReserve,
        feeBps,
      });
    } catch (err) {
      console.error('Error fetching pool state:', err);
    }
  }, [connection, poolPda]);

  // Fetch user's token balance
  const fetchUserBalance = useCallback(async () => {
    if (!wallet.publicKey || !poolState?.mint) return;
    
    try {
      const userAta = getAssociatedTokenAddressSync(
        poolState.mint,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const accountInfo = await getAccount(
        connection, 
        userAta, 
        'confirmed', 
        TOKEN_2022_PROGRAM_ID
      );
      setUserTokenBalance(accountInfo.amount);
    } catch {
      // Account doesn't exist
      setUserTokenBalance(BigInt(0));
    }
  }, [connection, wallet.publicKey, poolState?.mint]);

  // Refresh on mount and periodically
  useEffect(() => {
    fetchPoolState();
    const interval = setInterval(fetchPoolState, 10000);
    return () => clearInterval(interval);
  }, [fetchPoolState]);

  useEffect(() => {
    fetchUserBalance();
  }, [fetchUserBalance, poolState]);

  // Get quote for a swap
  const getQuote = useCallback((amountIn: number, isBuy: boolean): SwapQuote | null => {
    if (!poolState || poolState.solReserve === BigInt(0) || poolState.tokenReserve === BigInt(0)) {
      return null;
    }

    const feeFactor = BigInt(10000) - BigInt(poolState.feeBps);
    const amountIn128 = BigInt(Math.floor(amountIn * (isBuy ? LAMPORTS_PER_SOL : 1e9)));
    
    const reserveIn = isBuy ? poolState.solReserve : poolState.tokenReserve;
    const reserveOut = isBuy ? poolState.tokenReserve : poolState.solReserve;

    const numerator = reserveOut * amountIn128 * feeFactor;
    const denominator = reserveIn * BigInt(10000) + amountIn128 * feeFactor;
    
    const amountOut = numerator / denominator;
    
    // Calculate price impact
    const idealRate = Number(reserveOut) / Number(reserveIn);
    const actualRate = Number(amountOut) / Number(amountIn128);
    const priceImpact = Math.abs(1 - actualRate / idealRate) * 100;

    const fee = amountIn * (poolState.feeBps / 10000);

    return {
      amountIn,
      amountOut: Number(amountOut) / (isBuy ? 1e9 : LAMPORTS_PER_SOL),
      priceImpact,
      fee,
    };
  }, [poolState]);

  // Execute buy (SOL -> tokens)
  const buy = useCallback(async (solAmount: number, minTokensOut: number = 0): Promise<string> => {
    if (!wallet.publicKey || !wallet.signTransaction || !poolState) {
      throw new Error('Wallet not connected or pool not loaded');
    }

    setLoading(true);
    setError(null);

    try {
      const mint = poolState.mint;
      const userAta = getAssociatedTokenAddressSync(
        mint,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Check if ATA exists
      const ataInfo = await connection.getAccountInfo(userAta);
      
      // Hook PDAs
      const [extraAccountMetasPda] = getExtraAccountMetasPDA(mint);
      const [hookConfigPda] = getHookConfigPDA();
      const [hookWhitelistPda] = getHookWhitelistPDA(mint);

      // Build swap_atomic_buy instruction
      const solInLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
      const minTokens = BigInt(Math.floor(minTokensOut * 1e9));

      const buyData = Buffer.concat([
        getDiscriminator('swap_atomic_buy'),
        Buffer.from(new BN(solInLamports.toString()).toArray('le', 8)),
        Buffer.from(new BN(minTokens.toString()).toArray('le', 8)),
      ]);

      const buyIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
          { pubkey: hookConfigPda, isSigner: false, isWritable: false },
          { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
        ],
        data: buyData,
      });

      const tx = new Transaction();
      
      // Create ATA if needed
      if (!ataInfo) {
        tx.add(createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userAta,
          wallet.publicKey,
          mint,
          TOKEN_2022_PROGRAM_ID
        ));
      }
      
      tx.add(buyIx);

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      // Refresh balances
      await fetchPoolState();
      await fetchUserBalance();

      return sig;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Buy failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [wallet, poolState, connection, poolPda, tokenVaultPda, solVaultPda, fetchPoolState, fetchUserBalance]);

  // Execute sell (tokens -> SOL)
  const sell = useCallback(async (tokenAmount: number, minSolOut: number = 0): Promise<string> => {
    if (!wallet.publicKey || !wallet.signTransaction || !poolState) {
      throw new Error('Wallet not connected or pool not loaded');
    }

    setLoading(true);
    setError(null);

    try {
      const mint = poolState.mint;
      const userAta = getAssociatedTokenAddressSync(
        mint,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Hook PDAs
      const [extraAccountMetasPda] = getExtraAccountMetasPDA(mint);
      const [hookConfigPda] = getHookConfigPDA();
      const [hookWhitelistPda] = getHookWhitelistPDA(mint);

      const tokensToSell = BigInt(Math.floor(tokenAmount * 1e9));
      const minSol = BigInt(Math.floor(minSolOut * LAMPORTS_PER_SOL));

      // Atomic sell requires two instructions in the same transaction:
      // 1. User transfers tokens directly to vault (with hook accounts)
      // 2. User calls swap_atomic_sell to receive SOL

      // Build token transfer instruction
      const transferIx = createTransferCheckedInstruction(
        userAta,
        mint,
        tokenVaultPda,
        wallet.publicKey,
        tokensToSell,
        9, // decimals
        [],
        TOKEN_2022_PROGRAM_ID
      );

      // Add hook accounts to transfer
      transferIx.keys.push(
        { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
        { pubkey: hookConfigPda, isSigner: false, isWritable: false },
        { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
      );

      // Build swap_atomic_sell instruction
      const sellData = Buffer.concat([
        getDiscriminator('swap_atomic_sell'),
        Buffer.from(new BN(tokensToSell.toString()).toArray('le', 8)),
        Buffer.from(new BN(minSol.toString()).toArray('le', 8)),
      ]);

      const sellIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: sellData,
      });

      const tx = new Transaction().add(transferIx).add(sellIx);

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      // Refresh balances
      await fetchPoolState();
      await fetchUserBalance();

      return sig;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sell failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [wallet, poolState, connection, poolPda, tokenVaultPda, solVaultPda, fetchPoolState, fetchUserBalance]);

  return {
    loading,
    error,
    poolState,
    userTokenBalance,
    getQuote,
    buy,
    sell,
    refresh: async () => {
      await fetchPoolState();
      await fetchUserBalance();
    },
  };
}
