'use client';

import { FC } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BoomLogo } from './BoomLogo';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface HeaderProps {
  isLive?: boolean;
  currentTokenSymbol?: string;
}

export const Header: FC<HeaderProps> = ({ isLive, currentTokenSymbol }) => {
  const pathname = usePathname();
  
  const tabs = [
    { name: 'Trade', href: '/' },
    { name: 'Claims', href: '/claims' },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#1a2332]/95 backdrop-blur-lg border-b border-[#2a3545]">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <BoomLogo size="sm" />
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-[#d4c4a8] to-[#e07020] bg-clip-text text-transparent">
                BOOM Protocol
              </h1>
              <p className="text-xs text-gray-500">Crash gambling meets memecoins</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-[#1c2433]/80 rounded-xl p-1">
            {tabs.map((tab) => {
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-6 py-2 rounded-lg font-medium transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-[#c9a66b] to-[#e07020] text-[#0d1117]'
                      : 'text-gray-400 hover:text-white hover:bg-[#2a3545]'
                  }`}
                >
                  {tab.name}
                </Link>
              );
            })}
          </nav>

          {/* Wallet Button */}
          <WalletMultiButton className="!bg-gradient-to-r !from-orange-500 !to-red-500 hover:!from-orange-600 hover:!to-red-600 !rounded-xl !font-bold !transition-all hover:!scale-105" />
        </div>
      </div>
    </header>
  );
};
