'use client';

import { FC, useState } from 'react';
import { useCurrentToken } from '../hooks/useCurrentToken';

interface DexScreenerWidgetProps {
  roundId: number;
}

export const DexScreenerWidget: FC<DexScreenerWidgetProps> = ({ roundId }) => {
  const { tokenInfo, dexData } = useCurrentToken(roundId);
  const [isExpanded, setIsExpanded] = useState(true);

  // No token yet
  if (!tokenInfo.mint && !tokenInfo.loading) {
    return null;
  }

  // Loading
  if (tokenInfo.loading) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-3"></div>
          <div className="h-32 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  const mintAddress = tokenInfo.mint?.toBase58();
  const dexScreenerUrl = `https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0`;
  const dexScreenerLink = `https://dexscreener.com/solana/${mintAddress}`;

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <span className="font-semibold text-white">Live Chart</span>
          {dexData.priceUsd && (
            <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full animate-pulse">
              LIVE
            </span>
          )}
        </div>
        <svg 
          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isExpanded && (
        <>
          {/* Price Stats */}
          {dexData.priceUsd && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-800/50 rounded-lg p-2">
                <span className="text-gray-400 text-xs">Price</span>
                <div className="text-white font-mono">
                  ${parseFloat(dexData.priceUsd) < 0.01 
                    ? parseFloat(dexData.priceUsd).toFixed(8) 
                    : parseFloat(dexData.priceUsd).toFixed(4)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-2">
                <span className="text-gray-400 text-xs">24h Change</span>
                <div className={dexData.priceChange24h && dexData.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {dexData.priceChange24h !== null 
                    ? `${dexData.priceChange24h >= 0 ? '+' : ''}${dexData.priceChange24h.toFixed(2)}%`
                    : 'N/A'}
                </div>
              </div>
              {dexData.liquidity && (
                <div className="bg-gray-800/50 rounded-lg p-2">
                  <span className="text-gray-400 text-xs">Liquidity</span>
                  <div className="text-white">${dexData.liquidity.toLocaleString()}</div>
                </div>
              )}
              {dexData.volume24h && (
                <div className="bg-gray-800/50 rounded-lg p-2">
                  <span className="text-gray-400 text-xs">24h Volume</span>
                  <div className="text-white">${dexData.volume24h.toLocaleString()}</div>
                </div>
              )}
            </div>
          )}

          {/* No LP yet message */}
          {!dexData.priceUsd && !dexData.loading && (
            <div className="px-4 pb-3">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
                ⏳ Waiting for LP creation... Chart will appear once trading starts.
              </div>
            </div>
          )}

          {/* DexScreener Embed */}
          {dexData.priceUsd && (
            <div className="w-full h-[300px] bg-black">
              <iframe
                src={dexScreenerUrl}
                className="w-full h-full border-0"
                title="DexScreener Chart"
              />
            </div>
          )}

          {/* Footer Links */}
          <div className="p-3 border-t border-gray-800 flex items-center justify-between">
            <a
              href={`https://solscan.io/token/${mintAddress}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              View on Solscan →
            </a>
            {dexData.priceUsd && (
              <a
                href={dexScreenerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Open DexScreener →
              </a>
            )}
          </div>

          {/* Trade Button */}
          {dexData.pairAddress && (
            <div className="p-3 pt-0">
              <a
                href={`https://raydium.io/swap/?inputMint=sol&outputMint=${mintAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-lg text-center transition-all"
              >
                🚀 Trade on Raydium
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
};
