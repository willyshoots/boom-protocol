'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Header,
  TradingChart,
  BuySellPanel,
  Holdings,
  RecentExplosions,
  PresalePanel,
  AdminPanel,
  ExplosionOverlay,
  WalletNotInstalled,
  ExplosionStatus,
  ClaimPayout
} from '@/components';
import { RoundSelector } from '@/components/RoundSelector';

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

// Check if Phantom is installed
const isPhantomInstalled = () => {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as { phantom?: { solana?: unknown } }).phantom?.solana;
};

export default function Home() {
  const { connected, publicKey } = useWallet();
  const [isPresale, setIsPresale] = useState(true); // Start in presale mode for testing
  const [isExploding, setIsExploding] = useState(false);
  const [marketCap, setMarketCap] = useState(MOCK_TOKEN.marketCap);
  const [showWalletNotInstalled, setShowWalletNotInstalled] = useState(false);
  const [phantomChecked, setPhantomChecked] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  
  // Mock user holdings
  const [userHoldings, setUserHoldings] = useState({
    tokenBalance: 4200,
    tokenValue: 1847,
    solBalance: 2.5
  });

  // Check for Phantom on mount
  useEffect(() => {
    // Small delay to let wallet extensions inject
    const timer = setTimeout(() => {
      setPhantomChecked(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Simulate market cap increase
  useEffect(() => {
    if (isPresale) return;
    
    const interval = setInterval(() => {
      setMarketCap(prev => {
        const increase = Math.random() * 5000 + 1000;
        return prev + increase;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isPresale]);

  // Check for explosion (demo: explode at $5M)
  useEffect(() => {
    if (marketCap >= 5000000 && !isExploding && !isPresale) {
      triggerExplosion();
    }
  }, [marketCap, isExploding, isPresale]);

  const triggerExplosion = () => {
    setIsExploding(true);
  };

  const handleExplosionClose = () => {
    setIsExploding(false);
    setIsPresale(true);
    // Reset for next round
    setTimeout(() => {
      setIsPresale(false);
      setMarketCap(50000 + Math.random() * 100000);
    }, 60000); // 1 minute presale for demo
  };

  const handleBuy = (amount: number) => {
    // Check if wallet is connected first
    if (!connected) {
      // Check if Phantom is installed
      if (!isPhantomInstalled()) {
        setShowWalletNotInstalled(true);
        return;
      }
      return;
    }
    
    console.log('Buying:', amount, 'SOL');
    // Mock purchase
    const tokensReceived = amount / MOCK_TOKEN.price;
    setUserHoldings(prev => ({
      ...prev,
      tokenBalance: prev.tokenBalance + tokensReceived,
      tokenValue: prev.tokenValue + amount * 100,
      solBalance: prev.solBalance - amount
    }));
  };

  const handleSell = (amount: number) => {
    if (!connected) {
      if (!isPhantomInstalled()) {
        setShowWalletNotInstalled(true);
        return;
      }
      return;
    }
    
    console.log('Selling:', amount, 'tokens');
    // Mock sale
    const solReceived = amount * MOCK_TOKEN.price;
    setUserHoldings(prev => ({
      ...prev,
      tokenBalance: prev.tokenBalance - amount,
      tokenValue: prev.tokenValue - amount * MOCK_TOKEN.price * 100,
      solBalance: prev.solBalance + solReceived
    }));
  };

  // Admin panel toggle
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        isLive={!isPresale} 
        currentTokenSymbol={isPresale ? undefined : MOCK_TOKEN.symbol} 
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {isPresale ? (
          // Presale view
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <PresalePanel roundId={currentRound} />
              
              {/* Admin toggle */}
              <button
                onClick={() => setShowAdmin(!showAdmin)}
                className="w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
              >
                {showAdmin ? '🔼 Hide Admin Panel' : '🔐 Show Admin Panel'}
              </button>
              
              {showAdmin && <AdminPanel />}
            </div>
            <div className="space-y-6">
              <RoundSelector 
                currentRound={currentRound} 
                onRoundChange={setCurrentRound} 
              />
              {/* Explosion Status - shows timer or exploded state */}
              <ExplosionStatus roundId={currentRound} />
              {/* Claim Payout - shows after explosion + LP unwind */}
              <ClaimPayout roundId={currentRound} />
              <RecentExplosions explosions={MOCK_EXPLOSIONS} />
            </div>
          </div>
        ) : (
          // Trading view
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main chart area */}
            <div className="lg:col-span-2 space-y-6">
              <TradingChart 
                tokenSymbol={MOCK_TOKEN.symbol} 
                marketCap={marketCap}
                roundId={currentRound}
              />
              
              {/* Mobile buy/sell - shown below chart on mobile */}
              <div className="lg:hidden">
                <BuySellPanel
                  tokenSymbol={MOCK_TOKEN.symbol}
                  currentPrice={MOCK_TOKEN.price}
                  onBuy={handleBuy}
                  onSell={handleSell}
                />
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Desktop buy/sell */}
              <div className="hidden lg:block">
                <BuySellPanel
                  tokenSymbol={MOCK_TOKEN.symbol}
                  currentPrice={MOCK_TOKEN.price}
                  onBuy={handleBuy}
                  onSell={handleSell}
                />
              </div>

              <Holdings
                tokenSymbol={MOCK_TOKEN.symbol}
                tokenBalance={userHoldings.tokenBalance}
                tokenValue={userHoldings.tokenValue}
                solBalance={userHoldings.solBalance}
              />

              <RoundSelector 
                currentRound={currentRound} 
                onRoundChange={setCurrentRound} 
              />

              <RecentExplosions explosions={MOCK_EXPLOSIONS} />
            </div>
          </div>
        )}

        {/* Phantom not installed prompt */}
        {phantomChecked && !isPhantomInstalled() && !connected && (
          <div className="fixed bottom-4 right-4 max-w-sm bg-purple-900/90 border border-purple-500/50 rounded-xl p-4 shadow-xl z-40">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-700 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
                  <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white mb-1">Get Phantom Wallet</h4>
                <p className="text-sm text-purple-200 mb-3">
                  Install Phantom to connect and trade on BOOM Protocol.
                </p>
                <a
                  href="https://phantom.app/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium text-white transition-colors"
                >
                  Install Phantom
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" x2="21" y1="14" y2="3" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        )}
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
        payout={userHoldings.tokenValue * 1.2}
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
