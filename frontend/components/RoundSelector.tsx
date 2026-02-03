'use client';

import { FC, useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { PROGRAM_ID, getPresaleRoundPDA } from '../lib/idl';

interface RoundSelectorProps {
  currentRound: number;
  onRoundChange: (round: number) => void;
}

interface RoundInfo {
  roundId: number;
  exists: boolean;
  isFinalized: boolean;
  totalDeposited: number;
}

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

export const RoundSelector: FC<RoundSelectorProps> = ({ currentRound, onRoundChange }) => {
  const [rounds, setRounds] = useState<RoundInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxRoundToCheck] = useState(10); // Check up to 10 rounds

  useEffect(() => {
    const fetchRounds = async () => {
      setLoading(true);
      const connection = new Connection(RPC_URL, 'confirmed');
      const foundRounds: RoundInfo[] = [];

      for (let i = 1; i <= maxRoundToCheck; i++) {
        try {
          const [pda] = getPresaleRoundPDA(new BN(i));
          const account = await connection.getAccountInfo(pda);
          
          if (account) {
            // Parse basic info from account data
            const data = account.data.slice(8); // Skip discriminator
            const isFinalized = data[88] === 1;
            const totalDeposited = new BN(data.slice(76, 84), 'le').toNumber();
            
            foundRounds.push({
              roundId: i,
              exists: true,
              isFinalized,
              totalDeposited: totalDeposited / 1e9, // Convert to SOL
            });
          }
        } catch {
          // Round doesn't exist, stop checking
          break;
        }
      }

      // Always show at least round 1
      if (foundRounds.length === 0) {
        foundRounds.push({ roundId: 1, exists: false, isFinalized: false, totalDeposited: 0 });
      }

      setRounds(foundRounds);
      setLoading(false);
    };

    fetchRounds();
  }, [maxRoundToCheck]);

  const getStatusBadge = (round: RoundInfo) => {
    if (!round.exists) {
      return <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded">Not Started</span>;
    }
    if (round.isFinalized) {
      return <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Finalized</span>;
    }
    return <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded animate-pulse">Active</span>;
  };

  return (
    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Select Round</h3>
      
      {loading ? (
        <div className="text-center py-4 text-gray-500">Loading rounds...</div>
      ) : (
        <div className="space-y-2">
          {rounds.map((round) => (
            <button
              key={round.roundId}
              onClick={() => onRoundChange(round.roundId)}
              className={`w-full p-3 rounded-lg flex items-center justify-between transition ${
                currentRound === round.roundId
                  ? 'bg-orange-500/20 border border-orange-500/50'
                  : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold ${
                  currentRound === round.roundId ? 'text-orange-400' : 'text-white'
                }`}>
                  Round #{round.roundId}
                </span>
                {getStatusBadge(round)}
              </div>
              
              {round.exists && (
                <span className="text-sm text-gray-400">
                  {round.totalDeposited.toFixed(2)} SOL
                </span>
              )}
            </button>
          ))}
          
          {/* Option to start new round (for admin) */}
          <button
            onClick={() => onRoundChange(rounds.length + 1)}
            className="w-full p-3 rounded-lg bg-gray-800/30 border border-dashed border-gray-600 
                       text-gray-500 hover:text-gray-400 hover:border-gray-500 transition flex items-center justify-center gap-2"
          >
            <span>+</span>
            <span>New Round #{rounds.length + 1}</span>
          </button>
        </div>
      )}
    </div>
  );
};
