// BOOM Protocol IDL - Generated from programs/boom/src/lib.rs
// Program ID: GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn
// Format: Anchor 0.30+ IDL spec

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

// IDL for Anchor 0.30+ program
export const IDL = {
  address: PROGRAM_ID.toString(),
  metadata: {
    name: 'boom',
    version: '0.1.0',
    spec: '0.1.0',
    description: 'BOOM Protocol - Crash gambling meets memecoins',
  },
  instructions: [
    {
      name: 'initialize',
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        { name: 'protocol', writable: true, pda: { seeds: [{ kind: 'const', value: [112, 114, 111, 116, 111, 99, 111, 108] }] } },
        { name: 'treasury' },
        { name: 'authority', writable: true, signer: true },
        { name: 'systemProgram', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'config', type: { defined: { name: 'protocolConfig' } } },
      ],
    },
    {
      name: 'startPresale',
      discriminator: [57, 19, 73, 191, 195, 254, 45, 223],
      accounts: [
        { name: 'presaleRound', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'systemProgram', address: '11111111111111111111111111111111' },
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
      discriminator: [37, 239, 88, 70, 200, 246, 132, 226],
      accounts: [
        { name: 'presaleRound', writable: true },
        { name: 'userDeposit', writable: true },
        { name: 'depositor', writable: true, signer: true },
        { name: 'systemProgram', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
      ],
    },
    {
      name: 'endPresaleAndLottery',
      discriminator: [117, 34, 197, 164, 125, 165, 180, 143],
      accounts: [
        { name: 'presaleRound', writable: true },
        { name: 'authority', signer: true },
      ],
      args: [
        { name: 'winnerIndexes', type: { vec: 'u32' } },
      ],
    },
    {
      name: 'markWinner',
      discriminator: [29, 136, 100, 12, 201, 144, 5, 82],
      accounts: [
        { name: 'presaleRound' },
        { name: 'userDeposit', writable: true },
        { name: 'authority', signer: true },
      ],
      args: [],
    },
    {
      name: 'claimRefund',
      discriminator: [15, 16, 30, 161, 255, 228, 97, 60],
      accounts: [
        { name: 'presaleRound', writable: true },
        { name: 'userDeposit', writable: true },
        { name: 'depositor', writable: true, signer: true },
      ],
      args: [],
    },
    {
      name: 'claimWinnerTokens',
      discriminator: [92, 255, 51, 208, 230, 254, 244, 164],
      accounts: [
        { name: 'presaleRound' },
        { name: 'presaleToken' },
        { name: 'userDeposit', writable: true },
        { name: 'mint', writable: true },
        { name: 'mintAuthority' },
        { name: 'winnerTokenAccount', writable: true },
        { name: 'depositor' },
        { name: 'winner', writable: true, signer: true },
        { name: 'tokenProgram', address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
      ],
      args: [],
    },
    {
      name: 'createPresaleToken',
      discriminator: [241, 122, 30, 15, 79, 63, 229, 27],
      accounts: [
        { name: 'presaleRound' },
        { name: 'mint', writable: true, signer: true },
        { name: 'mintAuthority' },
        { name: 'presaleToken', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'tokenProgram', address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
        { name: 'systemProgram', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'roundId', type: 'u64' },
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'totalSupply', type: 'u64' },
        { name: 'tokensPerWinner', type: 'u64' },
      ],
    },
  ],
  accounts: [
    {
      name: 'protocol',
      discriminator: [45, 39, 101, 43, 115, 72, 131, 40],
    },
    {
      name: 'presaleRound',
      discriminator: [148, 104, 131, 197, 137, 163, 64, 135],
    },
    {
      name: 'userDeposit',
      discriminator: [69, 238, 23, 217, 255, 137, 185, 35],
    },
    {
      name: 'presaleToken',
      discriminator: [154, 81, 120, 23, 104, 12, 70, 176],
    },
  ],
  types: [
    {
      name: 'protocol',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'treasury', type: 'pubkey' },
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
      name: 'presaleRound',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
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
      name: 'userDeposit',
      type: {
        kind: 'struct',
        fields: [
          { name: 'depositor', type: 'pubkey' },
          { name: 'roundId', type: 'u64' },
          { name: 'amount', type: 'u64' },
          { name: 'depositTime', type: 'i64' },
          { name: 'isWinner', type: 'bool' },
          { name: 'claimed', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'presaleToken',
      type: {
        kind: 'struct',
        fields: [
          { name: 'roundId', type: 'u64' },
          { name: 'mint', type: 'pubkey' },
          { name: 'totalSupply', type: 'u64' },
          { name: 'tokensPerWinner', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'protocolConfig',
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
    { code: 6000, name: 'alreadyExploded', msg: 'Token has already exploded' },
    { code: 6001, name: 'capAlreadySet', msg: 'Secret cap has already been set' },
    { code: 6002, name: 'invalidCapReveal', msg: 'Invalid cap reveal - hash mismatch' },
    { code: 6003, name: 'presaleFinalized', msg: 'Presale has been finalized' },
    { code: 6004, name: 'presaleNotFinalized', msg: 'Presale has not been finalized yet' },
    { code: 6005, name: 'presaleEnded', msg: 'Presale period has ended' },
    { code: 6006, name: 'presaleNotEnded', msg: 'Presale period has not ended yet' },
    { code: 6007, name: 'depositTooSmall', msg: 'Deposit amount is below minimum' },
    { code: 6008, name: 'depositTooLarge', msg: 'Deposit amount exceeds maximum' },
    { code: 6009, name: 'overflow', msg: 'Arithmetic overflow' },
    { code: 6010, name: 'tooManyWinners', msg: 'Too many winners specified' },
    { code: 6011, name: 'alreadyWinner', msg: 'User is already marked as winner' },
    { code: 6012, name: 'winnerCannotRefund', msg: 'Winners cannot claim refund' },
    { code: 6013, name: 'alreadyClaimed', msg: 'Already claimed' },
    { code: 6014, name: 'nothingToRefund', msg: 'Nothing to refund' },
    { code: 6015, name: 'notAWinner', msg: 'Not a lottery winner' },
    { code: 6016, name: 'invalidMint', msg: 'Invalid mint for this presale' },
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

export function getPresaleTokenPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

export function getMintAuthorityPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}
