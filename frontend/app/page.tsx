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
  ExplosionOverlay
} from '@/components';

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
  const { connected, publicKey } = useWallet();
  const [isPresale, setIsPresale] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [marketCap, setMarketCap] = useState(MOCK_TOKEN.marketCap);
  
  // Mock user holdings
  const [userHoldings, setUserHoldings] = useState({
    tokenBalance: 4200,
    tokenValue: 1847,
    solBalance: 2.5
  });

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

  const handlePresaleDeposit = (amount: number) => {
    console.log('Presale deposit:', amount, 'SOL');
  };

  // Cooldown ends in 5 minutes for demo
  const cooldownEndsAt = new Date(Date.now() + 5 * 60 * 1000);

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
            <div className="lg:col-span-2">
              <PresalePanel
                cooldownEndsAt={cooldownEndsAt}
                totalDeposits={125.5}
                yourDeposit={connected ? 0.5 : 0}
                lotterySpots={50}
                onDeposit={handlePresaleDeposit}
              />
            </div>
            <div className="space-y-6">
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

              <RecentExplosions explosions={MOCK_EXPLOSIONS} />
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
    </div>
  );
}
