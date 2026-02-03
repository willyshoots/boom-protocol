'use client';

import { FC } from 'react';

interface Explosion {
  tokenSymbol: string;
  marketCapAtBoom: number;
  multiplier: number;
  timeAgo: string;
}

interface RecentExplosionsProps {
  explosions: Explosion[];
}

export const RecentExplosions: FC<RecentExplosionsProps> = ({ explosions }) => {
  return (
    <div className="boom-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-400">Recent Explosions</h3>
        <span className="text-2xl">💥</span>
      </div>
      
      <div className="space-y-3">
        {explosions.map((explosion, index) => (
          <div 
            key={index}
            className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-lg">
                💣
              </div>
              <div>
                <div className="font-bold text-white">${explosion.tokenSymbol}</div>
                <div className="text-sm text-gray-500">{explosion.timeAgo}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-green-400 font-bold text-lg">
                x{explosion.multiplier.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500">
                ${explosion.marketCapAtBoom.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="mt-4 pt-4 border-t border-gray-800">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-orange-400">
              ${Math.max(...explosions.map(e => e.marketCapAtBoom)).toLocaleString()}
            </div>
            <div className="text-xs text-gray-500">Biggest BOOM</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-400">
              x{Math.max(...explosions.map(e => e.multiplier)).toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">Best Multiplier</div>
          </div>
        </div>
      </div>
    </div>
  );
};
