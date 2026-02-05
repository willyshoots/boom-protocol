'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Header,
  BuySellPanel,
  RecentExplosions,
  PresalePanel,
  ExplosionOverlay,
  WalletNotInstalled,
  TradingChart,
  PastLaunches,
} from '@/components';

// Current active presale - in production this comes from backend/chain
const CURRENT_PRESALE = {
  roundId: 1770266776769, // Round from atomic swap tests
  ticker: 'CHAOS',
  symbol: 'CHAOS'
};

const MOCK_EXPLOSIONS = [
  { tokenSymbol: 'YOLO', marketCapAtBoom: 1200000, multiplier: 1.18, timeAgo: '14 minutes ago' },
  { tokenSymbol: 'DEGEN', marketCapAtBoom: 2300000, multiplier: 1.77, timeAgo: '32 minutes ago' },
  { tokenSymbol: 'MOON', marketCapAtBoom: 890000, multiplier: 1.34, timeAgo: '51 minutes ago' },
  { tokenSymbol: 'FOMO', marketCapAtBoom: 5600000, multiplier: 2.15, timeAgo: '1 hour ago' },
  { tokenSymbol: 'APE', marketCapAtBoom: 3400000, multiplier: 1.89, timeAgo: '2 hours ago' },
];

export default function Home() {
  useWallet(); // Keep hook for wallet connection
  const [isExploding, setIsExploding] = useState(false);
  const [showWalletNotInstalled, setShowWalletNotInstalled] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState<string>(CURRENT_PRESALE.roundId.toString());

  const handleExplosionClose = () => {
    setIsExploding(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#1a2332]">
      <Header 
        isLive={true} 
        currentTokenSymbol={CURRENT_PRESALE.symbol} 
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* Top Section: Chart + Buy/Sell */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <TradingChart 
              roundId={selectedRoundId}
              tokenSymbol={CURRENT_PRESALE.symbol}
            />
          </div>
          <div>
            <BuySellPanel
              tokenSymbol={CURRENT_PRESALE.symbol}
              roundId={CURRENT_PRESALE.roundId}
            />
          </div>
        </div>

        {/* Main content: Presale + Sidebar */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Presale Panel */}
          <div className="lg:col-span-2">
            <PresalePanel 
              roundId={CURRENT_PRESALE.roundId} 
              upcomingTicker={CURRENT_PRESALE.ticker}
            />
          </div>

          {/* Right: Sidebar */}
          <div className="space-y-6">
            {/* Past Launches Archive */}
            <PastLaunches 
              onSelectRound={setSelectedRoundId}
              currentRoundId={selectedRoundId}
            />
            
            {/* Recent Explosions */}
            <RecentExplosions explosions={MOCK_EXPLOSIONS} />
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>💥 BOOM Protocol - Crash gambling meets memecoins</p>
          <p className="mt-1">
            Built for{' '}
            <span className="text-orange-400">Colosseum Agent Hackathon</span>
          </p>
        </div>
      </footer>

      {/* Explosion overlay */}
      <ExplosionOverlay
        isExploding={isExploding}
        tokenSymbol={CURRENT_PRESALE.symbol}
        payout={1847 * 1.2}
        multiplier={1.2}
        onClose={handleExplosionClose}
      />

      {/* Wallet not installed modal */}
      {showWalletNotInstalled && (
        <WalletNotInstalled onClose={() => setShowWalletNotInstalled(false)} />
      )}
    </div>
  );
}
