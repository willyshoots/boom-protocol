'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Header,
  BuySellPanel,
  RecentExplosions,
  PresalePanel,
  ExplosionOverlay,
  WalletNotInstalled,
  DexScreenerWidget
} from '@/components';
// RoundSelector removed per design feedback

// Mock data for demonstration
const MOCK_TOKEN = {
  symbol: 'CHAOS',
  marketCap: 847291,
  price: 0.00142
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
  const [currentRound, setCurrentRound] = useState(11);
  
  // Mock: presale status - in reality this comes from on-chain data
  // For demo, presale is "closed" when viewing a finalized round
  const [presaleOpen, setPresaleOpen] = useState(true);

  // Update presale status based on round selection
  useEffect(() => {
    // Round 10 is our active test round
    setPresaleOpen(currentRound >= 10);
  }, [currentRound]);

  const handleExplosionClose = () => {
    setIsExploding(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#1a2332]">
      <Header 
        isLive={true} 
        currentTokenSymbol={MOCK_TOKEN.symbol} 
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* Top Section: Chart + Buy/Sell */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <DexScreenerWidget roundId={currentRound} />
          </div>
          <div>
            <BuySellPanel
              tokenSymbol={MOCK_TOKEN.symbol}
              currentPrice={MOCK_TOKEN.price}
              onBuy={(amount) => console.log('Buy:', amount)}
              onSell={(amount) => console.log('Sell:', amount)}
            />
          </div>
        </div>

        {/* Main content: Presale + Sidebar */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Presale Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Presale Section */}
            <div className={`relative ${!presaleOpen ? 'opacity-60' : ''}`}>
              {/* Closed overlay */}
              {!presaleOpen && (
                <div className="absolute inset-0 z-10 bg-gray-900/50 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <div className="text-center p-6">
                    <div className="text-4xl mb-3">⏸️</div>
                    <h3 className="text-xl font-bold text-white mb-2">Presale Closed</h3>
                    <p className="text-gray-400 text-sm">
                      Round #{currentRound} presale has ended. Select an active round or wait for the next one.
                    </p>
                  </div>
                </div>
              )}
              
              <PresalePanel roundId={currentRound} />
            </div>

          </div>

          {/* Right: Sidebar */}
          <div className="space-y-6">
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
        tokenSymbol={MOCK_TOKEN.symbol}
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
