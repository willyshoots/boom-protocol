'use client';

import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { 
  PROGRAM_ID, 
  IDL, 
  PresaleRound, 
  UserDeposit,
  getPresaleRoundPDA,
  getUserDepositPDA,
  getProtocolPDA,
} from '../lib/idl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoomProgram = Program<any>;

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // Create provider (read-only if not connected)
  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      // Return a read-only provider for fetching data
      return null;
    }
    return new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      },
      { commitment: 'confirmed' }
    );
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  // Create program instance (lazy - only when needed for writes)
  const program = useMemo(() => {
    if (!provider) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Program(IDL as any, provider) as BoomProgram;
    } catch (error) {
      console.error('Error creating Anchor program:', error);
      return null;
    }
  }, [provider]);

  // ==================== READ FUNCTIONS ====================

  /**
   * Fetch presale round data (raw deserialization - no Anchor coder)
   */
  const fetchPresaleRound = useCallback(async (roundId: number): Promise<PresaleRound | null> => {
    try {
      const [presalePDA] = getPresaleRoundPDA(new BN(roundId));
      const accountInfo = await connection.getAccountInfo(presalePDA);
      
      if (!accountInfo) return null;

      // Raw deserialization of PresaleRound account
      // Skip 8-byte discriminator
      const data = accountInfo.data.slice(8);
      let offset = 0;

      const authority = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const roundIdVal = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const startTime = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const endTime = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const lotterySpots = data.readUInt32LE(offset);
      offset += 4;

      const minDeposit = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const maxDeposit = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const totalDeposited = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const totalDepositors = data.readUInt32LE(offset);
      offset += 4;

      const isFinalized = data[offset] === 1;
      offset += 1;

      const bump = data[offset];

      return {
        authority,
        roundId: roundIdVal,
        startTime,
        endTime,
        lotterySpots,
        minDeposit,
        maxDeposit,
        totalDeposited,
        totalDepositors,
        isFinalized,
        bump,
      };
    } catch (error) {
      console.error('Error fetching presale round:', error);
      return null;
    }
  }, [connection]);

  /**
   * Fetch user deposit for a specific round (raw deserialization)
   */
  const fetchUserDeposit = useCallback(async (roundId: number, userPubkey: PublicKey): Promise<UserDeposit | null> => {
    try {
      const [depositPDA] = getUserDepositPDA(new BN(roundId), userPubkey);
      const accountInfo = await connection.getAccountInfo(depositPDA);
      
      if (!accountInfo) return null;

      // Raw deserialization of UserDeposit account
      // Skip 8-byte discriminator
      const data = accountInfo.data.slice(8);
      let offset = 0;

      const depositor = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const roundIdVal = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const amount = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const depositTime = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const isWinner = data[offset] === 1;
      offset += 1;

      const claimed = data[offset] === 1;
      offset += 1;

      const bump = data[offset];

      return {
        depositor,
        roundId: roundIdVal,
        amount,
        depositTime,
        isWinner,
        claimed,
        bump,
      };
    } catch (error) {
      console.error('Error fetching user deposit:', error);
      return null;
    }
  }, [connection]);

  /**
   * Check if protocol is initialized
   */
  const checkProtocolInitialized = useCallback(async (): Promise<boolean> => {
    try {
      const [protocolPDA] = getProtocolPDA();
      const accountInfo = await connection.getAccountInfo(protocolPDA);
      return accountInfo !== null;
    } catch (error) {
      console.error('Error checking protocol:', error);
      return false;
    }
  }, [connection]);

  /**
   * Check if presale round exists
   */
  const checkPresaleExists = useCallback(async (roundId: number): Promise<boolean> => {
    const round = await fetchPresaleRound(roundId);
    return round !== null;
  }, [fetchPresaleRound]);

  // ==================== WRITE FUNCTIONS ====================

  /**
   * Initialize the protocol (admin only)
   */
  const initializeProtocol = useCallback(async (
    treasuryPubkey: PublicKey,
    minCap: number,
    maxCap: number,
    feeBps: number
  ): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const [protocolPDA] = getProtocolPDA();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .initialize({
        minCap: new BN(minCap * LAMPORTS_PER_SOL),
        maxCap: new BN(maxCap * LAMPORTS_PER_SOL),
        feeBps,
      })
      .accounts({
        protocol: protocolPDA,
        treasury: treasuryPubkey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Start a new presale round (admin only)
   */
  const startPresale = useCallback(async (
    roundId: number,
    cooldownDurationSeconds: number,
    lotterySpots: number,
    minDepositSol: number,
    maxDepositSol: number
  ): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const [presalePDA] = getPresaleRoundPDA(new BN(roundId));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .startPresale(
        new BN(roundId),
        new BN(cooldownDurationSeconds),
        lotterySpots,
        new BN(minDepositSol * LAMPORTS_PER_SOL),
        new BN(maxDepositSol * LAMPORTS_PER_SOL)
      )
      .accounts({
        presaleRound: presalePDA,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Deposit SOL into presale
   */
  const depositPresale = useCallback(async (
    roundId: number,
    amountSol: number
  ): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [presalePDA] = getPresaleRoundPDA(roundIdBN);
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, wallet.publicKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .depositPresale(new BN(amountSol * LAMPORTS_PER_SOL))
      .accounts({
        presaleRound: presalePDA,
        userDeposit: userDepositPDA,
        depositor: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * End presale and finalize lottery (admin only)
   */
  const endPresaleAndLottery = useCallback(async (
    roundId: number,
    winnerIndexes: number[]
  ): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const [presalePDA] = getPresaleRoundPDA(new BN(roundId));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .endPresaleAndLottery(winnerIndexes)
      .accounts({
        presaleRound: presalePDA,
        authority: wallet.publicKey,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Mark a user as lottery winner (admin only)
   */
  const markWinner = useCallback(async (
    roundId: number,
    winnerPubkey: PublicKey
  ): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [presalePDA] = getPresaleRoundPDA(roundIdBN);
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, winnerPubkey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .markWinner()
      .accounts({
        presaleRound: presalePDA,
        userDeposit: userDepositPDA,
        authority: wallet.publicKey,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Claim refund (for non-winners)
   */
  const claimRefund = useCallback(async (roundId: number): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [presalePDA] = getPresaleRoundPDA(roundIdBN);
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, wallet.publicKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .claimRefund()
      .accounts({
        presaleRound: presalePDA,
        userDeposit: userDepositPDA,
        depositor: wallet.publicKey,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Claim winner tokens
   */
  const claimWinnerTokens = useCallback(async (roundId: number): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [presalePDA] = getPresaleRoundPDA(roundIdBN);
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, wallet.publicKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .claimWinnerTokens()
      .accounts({
        presaleRound: presalePDA,
        userDeposit: userDepositPDA,
        depositor: wallet.publicKey,
        winner: wallet.publicKey,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  return {
    // State
    program,
    connected: wallet.connected,
    publicKey: wallet.publicKey,
    
    // Read functions
    fetchPresaleRound,
    fetchUserDeposit,
    checkProtocolInitialized,
    checkPresaleExists,
    
    // Write functions
    initializeProtocol,
    startPresale,
    depositPresale,
    endPresaleAndLottery,
    markWinner,
    claimRefund,
    claimWinnerTokens,
  };
}
