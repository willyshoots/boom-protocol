'use client';

import { FC } from 'react';
import { BoomLogo } from './BoomLogo';
import { WalletButton } from './WalletButton';

interface HeaderProps {
  isLive: boolean;
  currentTokenSymbol?: string;
}

export const Header: FC<HeaderProps> = ({ isLive, currentTokenSymbol }) => {
  return (
    <header className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-lg border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <BoomLogo size="sm" animated={isLive} />
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
                BOOM Protocol
              </h1>
              <p className="text-xs text-gray-500">Crash gambling meets memecoins</p>
            </div>
          </div>

          {/* Status badge - hidden on mobile */}
          <div className="hidden md:flex items-center gap-4">
            {isLive && currentTokenSymbol ? (
              <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-full">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-green-400 font-medium">LIVE: ${currentTokenSymbol}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 border border-orange-500/30 rounded-full">
                <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                <span className="text-orange-400 font-medium">PRESALE ACTIVE</span>
              </div>
            )}
          </div>

          {/* Wallet Button */}
          <WalletButton />
        </div>
      </div>
    </header>
  );
};
