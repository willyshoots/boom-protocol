// BOOM Protocol IDL - Generated from programs/boom/src/lib.rs
// Program ID: GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

// Account types
export interface Protocol {
  authority: PublicKey;
  treasury: PublicKey;
  minCap: BN;
  maxCap: BN;
  feeBps: number;
  totalLaunches: BN;
  totalExplosions: BN;
  bump: number;
}

export interface PresaleRound {
  authority: PublicKey;
  roundId: BN;
  startTime: BN;
  endTime: BN;
  lotterySpots: number;
  minDeposit: BN;
  maxDeposit: BN;
  totalDeposited: BN;
  totalDepositors: number;
  isFinalized: boolean;
  bump: number;
}

export interface UserDeposit {
  depositor: PublicKey;
  roundId: BN;
  amount: BN;
  depositTime: BN;
  isWinner: boolean;
  claimed: boolean;
  bump: number;
}

// Config types
export interface ProtocolConfig {
  minCap: BN;
  maxCap: BN;
  feeBps: number;
}

// IDL for Anchor program
export const IDL = {
  version: '0.1.0',
  name: 'boom',
  address: PROGRAM_ID.toString(),
  metadata: {
    name: 'boom',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [
    {
      name: 'initialize',
      accounts: [
        { name: 'protocol', isMut: true, isSigner: false },
        { name: 'treasury', isMut: false, isSigner: false },
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'config', type: { defined: 'ProtocolConfig' } },
      ],
    },
    {
      name: 'startPresale',
      accounts: [
        { name: 'presaleRound', isMut: true, isSigner: false },
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'roundId', type: 'u64' },
        { name: 'cooldownDuration', type: 'i64' },
        { name: 'lotterySpots', type: 'u32' },
        { name: 'minDeposit', type: 'u64' },
        { name: 'maxDeposit', type: 'u64' },
      ],
    },
    {
      name: 'depositPresale',
      accounts: [
        { name: 'presaleRound', isMut: true, isSigner: false },
        { name: 'userDeposit', isMut: true, isSigner: false },
        { name: 'depositor', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'amount', type: 'u64' },
      ],
    },
    {
      name: 'endPresaleAndLottery',
      accounts: [
        { name: 'presaleRound', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [
        { name: 'winnerIndexes', type: { vec: 'u32' } },
      ],
    },
    {
      name: 'markWinner',
      accounts: [
        { name: 'presaleRound', isMut: false, isSigner: false },
        { name: 'userDeposit', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [],
    },
    {
      name: 'claimRefund',
      accounts: [
        { name: 'presaleRound', isMut: true, isSigner: false },
        { name: 'userDeposit', isMut: true, isSigner: false },
        { name: 'depositor', isMut: true, isSigner: true },
      ],
      args: [],
    },
    {
      name: 'claimWinnerTokens',
      accounts: [
        { name: 'presaleRound', isMut: false, isSigner: false },
        { name: 'userDeposit', isMut: true, isSigner: false },
        { name: 'depositor', isMut: false, isSigner: false },
        { name: 'winner', isMut: false, isSigner: true },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'Protocol',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'treasury', type: 'publicKey' },
          { name: 'minCap', type: 'u64' },
          { name: 'maxCap', type: 'u64' },
          { name: 'feeBps', type: 'u16' },
          { name: 'totalLaunches', type: 'u64' },
          { name: 'totalExplosions', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'PresaleRound',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'roundId', type: 'u64' },
          { name: 'startTime', type: 'i64' },
          { name: 'endTime', type: 'i64' },
          { name: 'lotterySpots', type: 'u32' },
          { name: 'minDeposit', type: 'u64' },
          { name: 'maxDeposit', type: 'u64' },
          { name: 'totalDeposited', type: 'u64' },
          { name: 'totalDepositors', type: 'u32' },
          { name: 'isFinalized', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'UserDeposit',
      type: {
        kind: 'struct',
        fields: [
          { name: 'depositor', type: 'publicKey' },
          { name: 'roundId', type: 'u64' },
          { name: 'amount', type: 'u64' },
          { name: 'depositTime', type: 'i64' },
          { name: 'isWinner', type: 'bool' },
          { name: 'claimed', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  types: [
    {
      name: 'ProtocolConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'minCap', type: 'u64' },
          { name: 'maxCap', type: 'u64' },
          { name: 'feeBps', type: 'u16' },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: 'AlreadyExploded', msg: 'Token has already exploded' },
    { code: 6001, name: 'CapAlreadySet', msg: 'Secret cap has already been set' },
    { code: 6002, name: 'InvalidCapReveal', msg: 'Invalid cap reveal - hash mismatch' },
    { code: 6003, name: 'PresaleFinalized', msg: 'Presale has been finalized' },
    { code: 6004, name: 'PresaleNotFinalized', msg: 'Presale has not been finalized yet' },
    { code: 6005, name: 'PresaleEnded', msg: 'Presale period has ended' },
    { code: 6006, name: 'PresaleNotEnded', msg: 'Presale period has not ended yet' },
    { code: 6007, name: 'DepositTooSmall', msg: 'Deposit amount is below minimum' },
    { code: 6008, name: 'DepositTooLarge', msg: 'Deposit amount exceeds maximum' },
    { code: 6009, name: 'Overflow', msg: 'Arithmetic overflow' },
    { code: 6010, name: 'TooManyWinners', msg: 'Too many winners specified' },
    { code: 6011, name: 'AlreadyWinner', msg: 'User is already marked as winner' },
    { code: 6012, name: 'WinnerCannotRefund', msg: 'Winners cannot claim refund' },
    { code: 6013, name: 'AlreadyClaimed', msg: 'Already claimed' },
    { code: 6014, name: 'NothingToRefund', msg: 'Nothing to refund' },
    { code: 6015, name: 'NotAWinner', msg: 'Not a lottery winner' },
  ],
} as const;

// PDA derivation helpers
export function getProtocolPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')],
    PROGRAM_ID
  );
}

export function getPresaleRoundPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

export function getUserDepositPDA(roundId: BN, depositor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundId.toArrayLike(Buffer, 'le', 8), depositor.toBuffer()],
    PROGRAM_ID
  );
}
