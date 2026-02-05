import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getPoolPDA, PROGRAM_ID } from '../../../../lib/idl';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const DATA_DIR = process.env.CHART_DATA_DIR || path.join(process.cwd(), '.chart-data');

// Candle interval in seconds
const CANDLE_INTERVAL = 60; // 1 minute candles

export interface Candle {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PoolState {
  solReserve: number;
  tokenReserve: number;
  price: number;
  timestamp: number;
}

// Parse Pool account data (skip 8-byte discriminator)
function parsePool(data: Buffer): { 
  roundId: BN; 
  mint: PublicKey; 
  solReserve: BN; 
  tokenReserve: BN;
  totalVolume: BN;
} | null {
  try {
    if (data.length < 8 + 8 + 32 + 32 + 32 + 8 + 8 + 2 + 16 + 16) return null;
    
    const accountData = data.slice(8); // Skip discriminator
    let offset = 0;
    
    const roundId = new BN(accountData.slice(offset, offset + 8), 'le');
    offset += 8;
    
    const mint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;
    
    // Skip token_vault and sol_vault
    offset += 64;
    
    const solReserve = new BN(accountData.slice(offset, offset + 8), 'le');
    offset += 8;
    
    const tokenReserve = new BN(accountData.slice(offset, offset + 8), 'le');
    offset += 8;
    
    // Skip fee_bps
    offset += 2;
    
    const totalVolume = new BN(accountData.slice(offset, offset + 16), 'le');
    
    return { roundId, mint, solReserve, tokenReserve, totalVolume };
  } catch {
    return null;
  }
}

// Calculate price from reserves
function calculatePrice(solReserve: number, tokenReserve: number): number {
  if (tokenReserve === 0) return 0;
  return solReserve / tokenReserve;
}

// Load existing candles from file
function loadCandles(poolKey: string): Candle[] {
  try {
    const filePath = path.join(DATA_DIR, `${poolKey}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading candles:', e);
  }
  return [];
}

// Save candles to file
function saveCandles(poolKey: string, candles: Candle[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const filePath = path.join(DATA_DIR, `${poolKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(candles, null, 2));
  } catch (e) {
    console.error('Error saving candles:', e);
  }
}

// Update or create candle from current price
function updateCandles(candles: Candle[], price: number, volume: number): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  const candleTime = Math.floor(now / CANDLE_INTERVAL) * CANDLE_INTERVAL;
  
  const lastCandle = candles[candles.length - 1];
  
  if (lastCandle && lastCandle.time === candleTime) {
    // Update existing candle
    lastCandle.high = Math.max(lastCandle.high, price);
    lastCandle.low = Math.min(lastCandle.low, price);
    lastCandle.close = price;
    lastCandle.volume = volume;
  } else {
    // Create new candle
    const open = lastCandle ? lastCandle.close : price;
    candles.push({
      time: candleTime,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume,
    });
    
    // Keep only last 1000 candles (~16 hours of 1-min data)
    if (candles.length > 1000) {
      candles.shift();
    }
  }
  
  return candles;
}

// GET /api/chart/[pool]?roundId=123
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pool: string }> }
) {
  try {
    const { pool } = await params;
    const { searchParams } = new URL(request.url);
    const roundIdParam = searchParams.get('roundId') || pool;
    
    // Parse round ID
    const roundId = new BN(roundIdParam);
    const [poolPDA] = getPoolPDA(roundId);
    const poolKey = poolPDA.toBase58();
    
    // Fetch current pool state
    const connection = new Connection(RPC_URL, 'confirmed');
    const accountInfo = await connection.getAccountInfo(poolPDA);
    
    if (!accountInfo) {
      return NextResponse.json({ 
        error: 'Pool not found',
        candles: [],
        currentPrice: null,
      });
    }
    
    const poolData = parsePool(accountInfo.data);
    if (!poolData) {
      return NextResponse.json({ 
        error: 'Failed to parse pool data',
        candles: [],
        currentPrice: null,
      });
    }
    
    // Calculate current price (in SOL per token)
    const solReserve = poolData.solReserve.toNumber() / 1e9; // lamports to SOL
    const tokenReserve = poolData.tokenReserve.toNumber();
    const currentPrice = calculatePrice(solReserve, tokenReserve);
    const totalVolume = poolData.totalVolume.toNumber() / 1e9;
    
    // Load and update candles
    let candles = loadCandles(poolKey);
    candles = updateCandles(candles, currentPrice, totalVolume);
    saveCandles(poolKey, candles);
    
    return NextResponse.json({
      pool: poolKey,
      roundId: roundIdParam,
      mint: poolData.mint.toBase58(),
      currentPrice,
      solReserve,
      tokenReserve,
      totalVolume,
      candles,
      candleInterval: CANDLE_INTERVAL,
    });
    
  } catch (error) {
    console.error('Chart API error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      candles: [],
      currentPrice: null,
    }, { status: 500 });
  }
}

// POST /api/chart/[pool] - For indexer to push price updates
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pool: string }> }
) {
  try {
    const { pool } = await params;
    const body = await request.json();
    const { price, volume, roundId } = body;
    
    if (typeof price !== 'number' || price <= 0) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
    }
    
    // Use roundId to derive pool key if provided
    let poolKey = pool;
    if (roundId) {
      const [poolPDA] = getPoolPDA(new BN(roundId));
      poolKey = poolPDA.toBase58();
    }
    
    // Load and update candles
    let candles = loadCandles(poolKey);
    candles = updateCandles(candles, price, volume || 0);
    saveCandles(poolKey, candles);
    
    return NextResponse.json({ 
      success: true, 
      candleCount: candles.length,
      latestCandle: candles[candles.length - 1],
    });
    
  } catch (error) {
    console.error('Chart POST error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
