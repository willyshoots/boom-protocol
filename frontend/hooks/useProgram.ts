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
  PresaleExplosion,
  PayoutPool,
  PresaleToken,
  RoundSequencer,
  ExplosionReason,
  getPresaleRoundPDA,
  getUserDepositPDA,
  getProtocolPDA,
  getPresaleExplosionPDA,
  getPayoutPoolPDA,
  getPayoutVaultPDA,
  getPresaleTokenPDA,
  getRoundSequencerPDA,
} from '../lib/idl';

// Token2022 Program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

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

  /**
   * Fetch presale explosion data
   */
  const fetchPresaleExplosion = useCallback(async (roundId: number): Promise<PresaleExplosion | null> => {
    try {
      const [explosionPDA] = getPresaleExplosionPDA(new BN(roundId));
      const accountInfo = await connection.getAccountInfo(explosionPDA);
      
      if (!accountInfo) return null;

      const data = accountInfo.data.slice(8);
      let offset = 0;

      const roundIdVal = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const capHash = Array.from(data.slice(offset, offset + 32));
      offset += 32;

      const revealedCap = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const explosionDeadline = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const isExploded = data[offset] === 1;
      offset += 1;

      const explosionTime = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const explosionReason = data[offset] as ExplosionReason;
      offset += 1;

      const totalSolForPayout = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const bump = data[offset];

      return {
        roundId: roundIdVal,
        capHash,
        revealedCap,
        explosionDeadline,
        isExploded,
        explosionTime,
        explosionReason,
        totalSolForPayout,
        bump,
      };
    } catch (error) {
      console.error('Error fetching presale explosion:', error);
      return null;
    }
  }, [connection]);

  /**
   * Fetch payout pool data
   */
  const fetchPayoutPool = useCallback(async (roundId: number): Promise<PayoutPool | null> => {
    try {
      const [payoutPoolPDA] = getPayoutPoolPDA(new BN(roundId));
      const accountInfo = await connection.getAccountInfo(payoutPoolPDA);
      
      if (!accountInfo) return null;

      const data = accountInfo.data.slice(8);
      let offset = 0;

      const roundIdVal = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const totalSol = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const remainingSupply = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const claimedCount = data.readUInt32LE(offset);
      offset += 4;

      const bump = data[offset];

      return {
        roundId: roundIdVal,
        totalSol,
        remainingSupply,
        claimedCount,
        bump,
      };
    } catch (error) {
      console.error('Error fetching payout pool:', error);
      return null;
    }
  }, [connection]);

  /**
   * Fetch presale token data
   */
  const fetchPresaleToken = useCallback(async (roundId: number): Promise<PresaleToken | null> => {
    try {
      const [presaleTokenPDA] = getPresaleTokenPDA(new BN(roundId));
      const accountInfo = await connection.getAccountInfo(presaleTokenPDA);
      
      if (!accountInfo) return null;

      const data = accountInfo.data.slice(8);
      let offset = 0;

      const roundIdVal = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const totalSupply = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const tokensPerWinner = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const bump = data[offset];

      return {
        roundId: roundIdVal,
        mint,
        totalSupply,
        tokensPerWinner,
        bump,
      };
    } catch (error) {
      console.error('Error fetching presale token:', error);
      return null;
    }
  }, [connection]);

  /**
   * Fetch round sequencer data
   */
  const fetchRoundSequencer = useCallback(async (): Promise<RoundSequencer | null> => {
    try {
      const [sequencerPDA] = getRoundSequencerPDA();
      const accountInfo = await connection.getAccountInfo(sequencerPDA);
      
      if (!accountInfo) return null;

      const data = accountInfo.data.slice(8);
      let offset = 0;

      const authority = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const currentRound = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const lastExplosionRound = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const autoAdvanceEnabled = data[offset] === 1;
      offset += 1;

      const defaultCooldown = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const defaultLotterySpots = data.readUInt32LE(offset);
      offset += 4;

      const defaultMinDeposit = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const defaultMaxDeposit = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;

      const bump = data[offset];

      return {
        authority,
        currentRound,
        lastExplosionRound,
        autoAdvanceEnabled,
        defaultCooldown,
        defaultLotterySpots,
        defaultMinDeposit,
        defaultMaxDeposit,
        bump,
      };
    } catch (error) {
      console.error('Error fetching round sequencer:', error);
      return null;
    }
  }, [connection]);

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
   * Claim winner tokens (presale lottery winners claim their tokens)
   */
  const claimWinnerTokens = useCallback(async (roundId: number, mint: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [presalePDA] = getPresaleRoundPDA(roundIdBN);
    const [presaleTokenPDA] = getPresaleTokenPDA(roundIdBN);
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, wallet.publicKey);
    const [mintAuthorityPDA] = getPresaleTokenPDA(roundIdBN); // Note: using correct PDA

    // Get user's associated token account for Token2022
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .claimWinnerTokens()
      .accounts({
        presaleRound: presalePDA,
        presaleToken: presaleTokenPDA,
        userDeposit: userDepositPDA,
        mint: mint,
        mintAuthority: mintAuthorityPDA,
        winnerTokenAccount: userTokenAccount,
        depositor: wallet.publicKey,
        winner: wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Claim explosion payout (token holders burn tokens for SOL after explosion)
   */
  const claimExplosionPayout = useCallback(async (roundId: number, mint: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const roundIdBN = new BN(roundId);
    const [explosionPDA] = getPresaleExplosionPDA(roundIdBN);
    const [payoutPoolPDA] = getPayoutPoolPDA(roundIdBN);
    const [payoutVaultPDA] = getPayoutVaultPDA(roundIdBN);

    // Get user's token account
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .claimExplosionPayout()
      .accounts({
        presaleExplosion: explosionPDA,
        payoutPool: payoutPoolPDA,
        payoutVault: payoutVaultPDA,
        userTokenAccount: userTokenAccount,
        mint: mint,
        user: wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }, [program, wallet.publicKey]);

  /**
   * Auto start next round (anyone can call after explosion)
   */
  const autoStartNextRound = useCallback(async (newRoundId: number): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    const newRoundIdBN = new BN(newRoundId);
    const prevRoundIdBN = new BN(newRoundId - 1);
    const [sequencerPDA] = getRoundSequencerPDA();
    const [prevExplosionPDA] = getPresaleExplosionPDA(prevRoundIdBN);
    const [newPresalePDA] = getPresaleRoundPDA(newRoundIdBN);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (program as any).methods
      .autoStartNextRound(newRoundIdBN)
      .accounts({
        sequencer: sequencerPDA,
        previousExplosion: prevExplosionPDA,
        newPresaleRound: newPresalePDA,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
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
    fetchPresaleExplosion,
    fetchPayoutPool,
    fetchPresaleToken,
    fetchRoundSequencer,
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
    claimExplosionPayout,
    autoStartNextRound,
  };
}
