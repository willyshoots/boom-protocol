'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { usePresale } from '../hooks/usePresale';
import { useTokenClaim } from '../hooks/useTokenClaim';
import { FundingCountdown } from './CountdownTimer';

interface PresalePanelProps {
  roundId?: number;
  upcomingTicker?: string;
}

export const PresalePanel: FC<PresalePanelProps> = ({ roundId = 1, upcomingTicker = 'BOOM' }) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    loading,
    txLoading,
    roundExists,
    isActive,
    isFinalized,
    totalDepositedSol,
    userDepositSol,
    lotterySpots,
    totalDepositors,
    endTime,
    minDepositSol,
    maxDepositSol,
    isWinner,
    hasClaimed,
    tokenMint,
    deposit,
    refund,
    refresh,
  } = usePresale(roundId);

  // Token claim hook
  const {
    isLoading: claimLoading,
    isSuccess: claimSuccess,
    errorMessage: claimError,
    txSignature,
    claim,
    reset: resetClaim,
  } = useTokenClaim(
    roundId,
    tokenMint,
    isWinner,
    hasClaimed,
    (sig) => {
      setSuccessMessage(`🎉 Tokens claimed successfully!`);
      console.log('Claim tx:', sig);
      refresh(); // Refresh state after successful claim
    },
    (err) => {
      setError(err.message);
    }
  );

  const handleClaim = async () => {
    setError(null);
    setSuccessMessage(null);
    try {
      await claim();
    } catch (err) {
      // Error already handled by onError callback
    }
  };

  const handleDeposit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setError(null);
    try {
      const sig = await deposit(amountNum);
      console.log('Deposit tx:', sig);
      setAmount('');
    } catch (err) {
      console.error('Deposit error:', err);
      setError(err instanceof Error ? err.message : 'Deposit failed');
    }
  };

  return (
    <div className="boom-card border-2 border-orange-500/50">
      {/* Hero Header - Simple and Bold */}
      <div className="text-center mb-8">
        <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center text-4xl animate-pulse mb-4">
          💥
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
          Be early to the next BOOM
        </h2>
        <div className="inline-block px-6 py-2 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border border-orange-500/50 rounded-full">
          <span className="text-3xl md:text-4xl font-black bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
            ${upcomingTicker}
          </span>
        </div>
      </div>

      {/* Status Banner */}
      {loading ? (
        <div className="mb-6 p-4 bg-gray-800/50 rounded-lg text-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      ) : isActive ? (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-green-400 font-bold">LIVE NOW</span>
            </div>
            <FundingCountdown 
              endTime={endTime} 
              className="text-lg font-bold text-white"
              onComplete={refresh}
            />
          </div>
        </div>
      ) : isFinalized ? (
        <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl text-center">
          <p className="text-orange-400 font-medium">
            {isWinner && !hasClaimed 
              ? '🏆 You WON! Claim your tokens below'
              : !isWinner && userDepositSol > 0 && !hasClaimed
              ? '💸 Claim your refund below'
              : 'Presale ended - Next launch coming soon!'}
          </p>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-gray-800/50 rounded-xl text-center">
          <p className="text-gray-400">Next presale coming soon...</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm">❌ {error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-green-400 text-sm">{successMessage}</p>
          {txSignature && (
            <a 
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline mt-1 block"
            >
              View transaction →
            </a>
          )}
        </div>
      )}

      {/* Winner Claim Section */}
      {connected && isFinalized && isWinner && !hasClaimed && (
        <div className="mb-6 p-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/50 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🏆</span>
            <div>
              <h3 className="text-lg font-bold text-yellow-400">You&apos;re a Winner!</h3>
              <p className="text-sm text-gray-300">Claim your presale tokens now</p>
            </div>
          </div>
          <button
            onClick={handleClaim}
            disabled={claimLoading || txLoading}
            className="w-full py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {claimLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Claiming...
              </>
            ) : (
              '🎁 CLAIM TOKENS'
            )}
          </button>
        </div>
      )}

      {/* Already Claimed Badge */}
      {connected && isFinalized && isWinner && hasClaimed && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-3">
          <span className="text-3xl">✅</span>
          <div>
            <h3 className="text-lg font-bold text-green-400">Tokens Claimed</h3>
            <p className="text-sm text-gray-400">Your presale tokens have been claimed</p>
          </div>
        </div>
      )}

      {/* Refund Section for Non-Winners */}
      {connected && isFinalized && !isWinner && userDepositSol > 0 && !hasClaimed && (
        <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">💸</span>
            <div>
              <h3 className="text-lg font-bold text-blue-400">Claim Your Refund</h3>
              <p className="text-sm text-gray-300">You didn&apos;t win, but your {userDepositSol.toFixed(4)} SOL is safe</p>
            </div>
          </div>
          <button
            onClick={async () => {
              setError(null);
              try {
                const sig = await refund();
                setSuccessMessage('Refund claimed successfully!');
                console.log('Refund tx:', sig);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Refund failed');
              }
            }}
            disabled={txLoading}
            className="w-full py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {txLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </>
            ) : (
              '💰 CLAIM REFUND'
            )}
          </button>
        </div>
      )}

      {/* Refund Claimed Badge */}
      {connected && isFinalized && !isWinner && hasClaimed && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-3">
          <span className="text-3xl">✅</span>
          <div>
            <h3 className="text-lg font-bold text-green-400">Refund Claimed</h3>
            <p className="text-sm text-gray-400">Your SOL has been returned to your wallet</p>
          </div>
        </div>
      )}

      {/* Pool stats - Simple */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
          <div className="text-3xl font-bold text-white">
            {totalDepositedSol.toFixed(1)}
          </div>
          <div className="text-sm text-gray-400">SOL Pooled</div>
        </div>
        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
          <div className="text-3xl font-bold text-orange-400">
            {lotterySpots}
          </div>
          <div className="text-sm text-gray-400">Winners</div>
        </div>
      </div>

      {/* Your entry */}
      {userDepositSol > 0 && (
        <div className="mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/30 rounded-xl flex items-center justify-between">
          <span className="text-gray-300">Your entry</span>
          <span className="text-xl font-bold text-orange-400">{userDepositSol.toFixed(2)} SOL</span>
        </div>
      )}

      {/* Deposit input */}
      {connected ? (
        <div className="space-y-4">
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-800 border-2 border-gray-700 rounded-xl px-4 py-4 text-2xl font-mono text-center focus:outline-none focus:border-orange-500 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">SOL</span>
          </div>

          <button
            onClick={handleDeposit}
            disabled={!amount || parseFloat(amount) <= 0 || txLoading || !isActive}
            className="w-full py-4 rounded-xl font-bold text-xl bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/25"
          >
            {txLoading ? '⏳ Processing...' : '💥 ENTER PRESALE'}
          </button>
          
          {minDepositSol > 0 && (
            <p className="text-xs text-gray-500 text-center">
              {minDepositSol} - {maxDepositSol} SOL per entry
            </p>
          )}
        </div>
      ) : (
        <WalletMultiButton className="!w-full !py-4 !rounded-xl !font-bold !text-xl !bg-gradient-to-r !from-orange-500 !to-yellow-500 hover:!from-orange-600 hover:!to-yellow-600 !transition-all !h-auto !justify-center !shadow-lg !shadow-orange-500/25" />
      )}

      {/* Simple explainer */}
      <div className="mt-8 pt-6 border-t border-gray-800/50">
        <div className="flex items-center justify-center gap-8 text-center">
          <div>
            <div className="text-2xl mb-1">🎰</div>
            <div className="text-xs text-gray-500">Enter lottery</div>
          </div>
          <div className="text-gray-600">→</div>
          <div>
            <div className="text-2xl mb-1">🏆</div>
            <div className="text-xs text-gray-500">Winners get tokens</div>
          </div>
          <div className="text-gray-600">→</div>
          <div>
            <div className="text-2xl mb-1">💥</div>
            <div className="text-xs text-gray-500">Token goes BOOM</div>
          </div>
        </div>
      </div>
    </div>
  );
};
