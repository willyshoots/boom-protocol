import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getPoolPDA, getRoundSequencerPDA, PROGRAM_ID } from '../../../lib/idl';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const DATA_DIR = process.env.CHART_DATA_DIR || path.join(process.cwd(), '.chart-data');

interface PoolInfo {
  roundId: string;
  poolAddress: string;
  mint: string;
  hasChartData: boolean;
  candleCount: number;
  lastUpdate: number | null;
  currentPrice: number | null;
}

// Parse Pool account
function parsePool(data: Buffer): { 
  roundId: BN; 
  mint: PublicKey; 
  solReserve: BN; 
  tokenReserve: BN;
} | null {
  try {
    if (data.length < 8 + 8 + 32 + 32 + 32 + 8 + 8) return null;
    
    const accountData = data.slice(8);
    let offset = 0;
    
    const roundId = new BN(accountData.slice(offset, offset + 8), 'le');
    offset += 8;
    
    const mint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32 + 64; // skip vaults
    
    const solReserve = new BN(accountData.slice(offset, offset + 8), 'le');
    offset += 8;
    
    const tokenReserve = new BN(accountData.slice(offset, offset + 8), 'le');
    
    return { roundId, mint, solReserve, tokenReserve };
  } catch {
    return null;
  }
}

// Parse RoundSequencer to get current round
function parseRoundSequencer(data: Buffer): { currentRound: BN } | null {
  try {
    if (data.length < 8 + 32 + 8) return null;
    const accountData = data.slice(8);
    // Skip authority (32 bytes)
    const currentRound = new BN(accountData.slice(32, 40), 'le');
    return { currentRound };
  } catch {
    return null;
  }
}

// Get list of pools with chart data
function getPoolsWithChartData(): Map<string, { candleCount: number; lastUpdate: number }> {
  const pools = new Map();
  
  try {
    if (!fs.existsSync(DATA_DIR)) return pools;
    
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const poolKey = file.replace('.json', '');
      const filePath = path.join(DATA_DIR, file);
      const stats = fs.statSync(filePath);
      
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        pools.set(poolKey, {
          candleCount: Array.isArray(data) ? data.length : 0,
          lastUpdate: stats.mtimeMs,
        });
      } catch {
        pools.set(poolKey, { candleCount: 0, lastUpdate: stats.mtimeMs });
      }
    }
  } catch (e) {
    console.error('Error reading chart data dir:', e);
  }
  
  return pools;
}

// GET /api/pools - List all pools with chart data
export async function GET(request: NextRequest) {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const pools: PoolInfo[] = [];
    const chartData = getPoolsWithChartData();
    
    // Get current round from sequencer
    const [sequencerPDA] = getRoundSequencerPDA();
    let currentRoundId: BN | null = null;
    
    try {
      const sequencerInfo = await connection.getAccountInfo(sequencerPDA);
      if (sequencerInfo) {
        const parsed = parseRoundSequencer(sequencerInfo.data);
        if (parsed) currentRoundId = parsed.currentRound;
      }
    } catch (e) {
      console.error('Error fetching sequencer:', e);
    }
    
    // Check recent rounds (last 20)
    // Use BigInt for safe handling of large round IDs
    let startRound: bigint;
    try {
      startRound = currentRoundId ? BigInt(currentRoundId.toString()) : BigInt(Date.now());
    } catch {
      startRound = BigInt(Date.now());
    }
    const roundsToCheck: bigint[] = [];
    
    // Add current round and work backwards
    for (let i = 0; i < 20; i++) {
      roundsToCheck.push(startRound - BigInt(i));
    }
    
    // Also add any rounds we have chart data for
    for (const [poolKey] of chartData) {
      // Pool keys are base58 addresses, we need to find the round ID
      // For now, just include what we know about
    }
    
    // Fetch pool accounts in parallel
    const poolPromises = roundsToCheck.map(async (roundNum) => {
      try {
        const roundId = new BN(roundNum.toString());
        const [poolPDA] = getPoolPDA(roundId);
        const poolKey = poolPDA.toBase58();
        
        const accountInfo = await connection.getAccountInfo(poolPDA);
        if (!accountInfo) return null;
        
        const poolData = parsePool(accountInfo.data);
        if (!poolData) return null;
        
        // Safely convert large numbers
        const solReserve = Number(poolData.solReserve.toString()) / 1e9;
        const tokenReserve = parseFloat(poolData.tokenReserve.toString());
        const price = tokenReserve > 0 ? solReserve / tokenReserve : null;
        
        const chartInfo = chartData.get(poolKey);
        
        return {
          roundId: roundNum.toString(),
          poolAddress: poolKey,
          mint: poolData.mint.toBase58(),
          hasChartData: !!chartInfo,
          candleCount: chartInfo?.candleCount || 0,
          lastUpdate: chartInfo?.lastUpdate || null,
          currentPrice: price,
        };
      } catch {
        return null;
      }
    });
    
    const results = await Promise.all(poolPromises);
    
    for (const result of results) {
      if (result) pools.push(result);
    }
    
    // Sort by round ID descending (most recent first)
    pools.sort((a, b) => {
      const aId = BigInt(a.roundId);
      const bId = BigInt(b.roundId);
      return bId > aId ? 1 : bId < aId ? -1 : 0;
    });
    
    return NextResponse.json({
      currentRound: currentRoundId?.toString() || null,
      pools,
      totalPools: pools.length,
    });
    
  } catch (error) {
    console.error('Pools API error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      pools: [],
    }, { status: 500 });
  }
}
