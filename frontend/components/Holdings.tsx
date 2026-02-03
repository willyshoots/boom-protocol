'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface HoldingsProps {
  tokenSymbol: string;
  tokenBalance: number;
  tokenValue: number;
  solBalance: number;
}

export const Holdings: FC<HoldingsProps> = ({
  tokenSymbol,
  tokenBalance,
  tokenValue,
  solBalance
}) => {
  const { connected } = useWallet();

  if (!connected) {
    return (
      <div className="boom-card">
        <h3 className="text-lg font-bold text-gray-400 mb-4">Your Holdings</h3>
        <div className="text-center py-8 text-gray-500">
          Connect wallet to view holdings
        </div>
      </div>
    );
  }

  return (
    <div className="boom-card">
      <h3 className="text-lg font-bold text-gray-400 mb-4">Your Holdings</h3>
      
      {/* Token holdings */}
      <div className="mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-yellow-500/10 rounded-lg border border-orange-500/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400">Token</span>
          <span className="text-xl font-bold text-white">${tokenSymbol}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-3xl font-bold text-white">{tokenBalance.toLocaleString()}</span>
            <span className="text-gray-400 ml-2">tokens</span>
          </div>
          <div className="text-right">
            <div className="text-green-400 font-bold">${tokenValue.toLocaleString()}</div>
            <div className="text-xs text-gray-500">value</div>
          </div>
        </div>
      </div>

      {/* SOL balance */}
      <div className="p-4 bg-gray-800/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500" />
            <span className="text-gray-400">SOL Balance</span>
          </div>
          <span className="font-bold text-white">{solBalance.toFixed(4)} SOL</span>
        </div>
      </div>

      {/* Payout estimate */}
      <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-green-400 text-sm">💰 If BOOM happens now:</span>
          <span className="text-green-400 font-bold">~${(tokenValue * 1.2).toLocaleString()}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Estimated payout based on current holdings
        </p>
      </div>
    </div>
  );
};
