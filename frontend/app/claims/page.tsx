'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Header, ClaimPayout } from '@/components';
import { usePresale } from '@/hooks/usePresale';

// Token tickers for each round (in production, this would come from on-chain metadata)
const ROUND_TICKERS: Record<number, string> = {
  1: 'BOOM',
  2: 'CHAOS',
  3: 'YOLO',
  4: 'DEGEN',
  5: 'MOON',
};

function ClaimCard({ roundId, ticker }: { roundId: number; ticker: string }) {
  const { userDeposit, isWinner, hasClaimed, isFinalized, loading } = usePresale(roundId);
  
  // Determine claim status
  let status = '';
  let statusColor = 'text-gray-400';
  
  if (loading) {
    status = 'Loading...';
  } else if (hasClaimed) {
    status = 'Claimed ✓';
    statusColor = 'text-green-400';
  } else if (isWinner && isFinalized) {
    status = 'Ready to claim!';
    statusColor = 'text-yellow-400';
  } else if (isFinalized && !isWinner) {
    status = 'Refund available';
    statusColor = 'text-blue-400';
  } else {
    status = 'Pending';
    statusColor = 'text-orange-400';
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-bold">
            {ticker.charAt(0)}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">${ticker}</h2>
            <p className="text-sm text-gray-500">Round #{roundId}</p>
          </div>
        </div>
        <span className={`text-sm font-medium ${statusColor}`}>{status}</span>
      </div>
      <div className="p-4">
        <ClaimPayout roundId={roundId} />
      </div>
    </div>
  );
}

function UserClaimsList() {
  const { publicKey } = useWallet();
  const [userRounds, setUserRounds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Check all rounds for user participation
  // In production, this would be a single indexed query
  const round1 = usePresale(1);
  const round2 = usePresale(2);
  const round3 = usePresale(3);
  
  useEffect(() => {
    if (!publicKey) {
      setUserRounds([]);
      setLoading(false);
      return;
    }
    
    // Wait for all rounds to load
    if (round1.loading || round2.loading || round3.loading) {
      setLoading(true);
      return;
    }
    
    // Filter rounds where user has deposited
    const rounds: number[] = [];
    if (round1.userDeposit) rounds.push(1);
    if (round2.userDeposit) rounds.push(2);
    if (round3.userDeposit) rounds.push(3);
    
    setUserRounds(rounds);
    setLoading(false);
  }, [publicKey, round1.loading, round2.loading, round3.loading, 
      round1.userDeposit, round2.userDeposit, round3.userDeposit]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 animate-pulse">
            <div className="h-6 bg-gray-700 rounded w-1/4 mb-4"></div>
            <div className="h-20 bg-gray-800 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (userRounds.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">🔍</div>
        <h3 className="text-xl font-bold text-white mb-2">No Claims Found</h3>
        <p className="text-gray-400 mb-4">
          You haven't participated in any presales yet.
        </p>
        <a 
          href="/"
          className="inline-block px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-xl hover:from-orange-600 hover:to-red-600 transition-all"
        >
          Join a Presale →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {userRounds.map((roundId) => (
        <ClaimCard 
          key={roundId} 
          roundId={roundId} 
          ticker={ROUND_TICKERS[roundId] || `TOKEN${roundId}`} 
        />
      ))}
    </div>
  );
}

export default function ClaimsPage() {
  const { connected } = useWallet();

  return (
    <div className="min-h-screen flex flex-col bg-[#1a2332]">
      <Header />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">💰 Claims</h1>
          <p className="text-gray-400">
            Claim your tokens from winning presales and payouts from exploded rounds.
          </p>
        </div>

        {connected ? (
          <UserClaimsList />
        ) : (
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center">
            <div className="text-4xl mb-4">🔐</div>
            <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
            <p className="text-gray-400 mb-6">
              Connect your wallet to see your available claims.
            </p>
            <WalletMultiButton className="!bg-gradient-to-r !from-orange-500 !to-red-500 hover:!from-orange-600 hover:!to-red-600 !rounded-xl !font-bold !mx-auto" />
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
    </div>
  );
}
