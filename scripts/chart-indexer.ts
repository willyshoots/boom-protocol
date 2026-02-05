/**
 * BOOM Chart Indexer
 * 
 * Watches pool accounts and populates candle data for the chart API.
 * Run alongside the frontend: npx ts-node scripts/chart-indexer.ts
 * 
 * Features:
 * - Polls pool state every few seconds
 * - Detects new pools automatically
 * - Stores candle data in JSON files
 * - Supports multiple pools simultaneously
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const POLL_INTERVAL_MS = 5000; // 5 seconds
const CANDLE_INTERVAL_SEC = 60; // 1 minute candles
const DATA_DIR = process.env.CHART_DATA_DIR || path.join(__dirname, '../frontend/.chart-data');
const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PoolState {
  roundId: number;
  mint: string;
  solReserve: number;
  tokenReserve: number;
  price: number;
  totalVolume: number;
  lastUpdate: number;
}

// Active pools being tracked
const pools = new Map<string, PoolState>();

// Connection
const connection = new Connection(RPC_URL, 'confirmed');

// PDA helpers
function getPoolPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function getRoundSequencerPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );
}

// Parse Pool account
function parsePool(data: Buffer): PoolState | null {
  try {
    if (data.length < 8 + 8 + 32 + 32 + 32 + 8 + 8 + 2 + 16) return null;
    
    const accountData = data.slice(8); // Skip discriminator
    let offset = 0;
    
    const roundId = new BN(accountData.slice(offset, offset + 8), 'le').toNumber();
    offset += 8;
    
    const mint = new PublicKey(accountData.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    // Skip vaults
    offset += 64;
    
    const solReserve = new BN(accountData.slice(offset, offset + 8), 'le').toNumber() / 1e9;
    offset += 8;
    
    const tokenReserve = new BN(accountData.slice(offset, offset + 8), 'le').toNumber();
    offset += 8;
    
    // Skip fee_bps
    offset += 2;
    
    const totalVolume = new BN(accountData.slice(offset, offset + 16), 'le').toNumber() / 1e9;
    
    const price = tokenReserve > 0 ? solReserve / tokenReserve : 0;
    
    return {
      roundId,
      mint,
      solReserve,
      tokenReserve,
      price,
      totalVolume,
      lastUpdate: Date.now(),
    };
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

// Parse RoundSequencer
function parseRoundSequencer(data: Buffer): { currentRound: number } | null {
  try {
    if (data.length < 8 + 32 + 8) return null;
    const accountData = data.slice(8);
    const currentRound = new BN(accountData.slice(32, 40), 'le').toNumber();
    return { currentRound };
  } catch {
    return null;
  }
}

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }
}

// Load existing candles
function loadCandles(poolKey: string): Candle[] {
  try {
    const filePath = path.join(DATA_DIR, `${poolKey}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error loading candles for ${poolKey}:`, e);
  }
  return [];
}

// Save candles
function saveCandles(poolKey: string, candles: Candle[]) {
  try {
    const filePath = path.join(DATA_DIR, `${poolKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(candles, null, 2));
  } catch (e) {
    console.error(`Error saving candles for ${poolKey}:`, e);
  }
}

// Update candles with new price
function updateCandles(poolKey: string, price: number, volume: number): number {
  const now = Math.floor(Date.now() / 1000);
  const candleTime = Math.floor(now / CANDLE_INTERVAL_SEC) * CANDLE_INTERVAL_SEC;
  
  let candles = loadCandles(poolKey);
  const lastCandle = candles[candles.length - 1];
  
  if (lastCandle && lastCandle.time === candleTime) {
    // Update existing candle
    lastCandle.high = Math.max(lastCandle.high, price);
    lastCandle.low = Math.min(lastCandle.low, price);
    lastCandle.close = price;
    lastCandle.volume = volume;
  } else {
    // New candle
    const open = lastCandle ? lastCandle.close : price;
    candles.push({
      time: candleTime,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume,
    });
    
    // Keep last 2000 candles (~33 hours of 1-min data)
    if (candles.length > 2000) {
      candles = candles.slice(-2000);
    }
  }
  
  saveCandles(poolKey, candles);
  return candles.length;
}

// Check for pool at given round
async function checkPool(roundId: number): Promise<boolean> {
  try {
    const [poolPDA] = getPoolPDA(new BN(roundId));
    const poolKey = poolPDA.toBase58();
    
    const accountInfo = await connection.getAccountInfo(poolPDA);
    if (!accountInfo) return false;
    
    const poolState = parsePool(accountInfo.data);
    if (!poolState) return false;
    
    // Track this pool
    const isNew = !pools.has(poolKey);
    pools.set(poolKey, poolState);
    
    // Update candles
    const candleCount = updateCandles(poolKey, poolState.price, poolState.totalVolume);
    
    if (isNew) {
      console.log(`📊 New pool discovered: Round ${roundId}`);
      console.log(`   Mint: ${poolState.mint}`);
      console.log(`   Price: ${poolState.price.toExponential(4)} SOL`);
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

// Get current round from sequencer
async function getCurrentRound(): Promise<number | null> {
  try {
    const [sequencerPDA] = getRoundSequencerPDA();
    const accountInfo = await connection.getAccountInfo(sequencerPDA);
    if (!accountInfo) return null;
    
    const parsed = parseRoundSequencer(accountInfo.data);
    return parsed?.currentRound ?? null;
  } catch {
    return null;
  }
}

// Main polling loop
async function poll() {
  // Get current round
  const currentRound = await getCurrentRound();
  
  // Check current round and recent rounds
  const roundsToCheck: number[] = [];
  
  if (currentRound) {
    for (let i = 0; i < 10; i++) {
      roundsToCheck.push(currentRound - i);
    }
  }
  
  // Also check any pools we're already tracking
  for (const [, state] of pools) {
    if (!roundsToCheck.includes(state.roundId)) {
      roundsToCheck.push(state.roundId);
    }
  }
  
  // Check all rounds
  let activeCount = 0;
  for (const roundId of roundsToCheck) {
    if (roundId > 0) {
      const found = await checkPool(roundId);
      if (found) activeCount++;
    }
  }
  
  // Log status periodically
  const now = new Date().toISOString().slice(11, 19);
  if (pools.size > 0) {
    const prices = Array.from(pools.entries())
      .map(([key, state]) => `R${state.roundId}: ${state.price.toExponential(2)}`)
      .join(', ');
    process.stdout.write(`\r[${now}] Tracking ${pools.size} pool(s): ${prices}    `);
  } else {
    process.stdout.write(`\r[${now}] Waiting for pools... (Current round: ${currentRound || 'unknown'})    `);
  }
}

// Entry point
async function main() {
  console.log('🚀 BOOM Chart Indexer');
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   Data dir: ${DATA_DIR}`);
  console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`   Candle interval: ${CANDLE_INTERVAL_SEC}s`);
  console.log('');
  
  ensureDataDir();
  
  // Initial poll
  await poll();
  
  // Start polling loop
  setInterval(poll, POLL_INTERVAL_MS);
  
  console.log('\nIndexer running. Press Ctrl+C to stop.\n');
}

main().catch(console.error);
