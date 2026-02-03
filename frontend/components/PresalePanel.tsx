'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { usePresale } from '../hooks/usePresale';
import { useTokenClaim } from '../hooks/useTokenClaim';

interface PresalePanelProps {
  roundId?: number;
}

export const PresalePanel: FC<PresalePanelProps> = ({ roundId = 1 }) => {
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center text-2xl animate-pulse">
            ⏳
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">PRESALE</h2>
            <p className="text-sm text-gray-400">Round #{roundId} - Testing Mode</p>
          </div>
        </div>
      </div>

      {/* Info / Status */}
      {loading ? (
        <div className="mb-6 p-4 bg-gray-800/50 rounded-lg text-center">
          <p className="text-gray-400">Loading presale data...</p>
        </div>
      ) : !roundExists ? (
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400 text-sm">
            ⚠️ No active presale round. Use Admin Panel below to:
            <br />1. Initialize Protocol
            <br />2. Start Presale
          </p>
        </div>
      ) : !isActive ? (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm">
            ⏰ Presale has ended. {totalDepositors} depositors competed for {lotterySpots} spots.
          </p>
          {isFinalized && userDepositSol > 0 && (
            <p className="text-gray-400 text-sm mt-2">
              {isWinner 
                ? hasClaimed 
                  ? '✅ You won and have claimed your tokens!' 
                  : '🏆 You WON! Claim your tokens below.'
                : '😢 You did not win. Claim your refund.'}
            </p>
          )}
        </div>
      ) : (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-green-400 text-sm">
            ✅ Presale is LIVE! Ends: {endTime.toLocaleString()}
          </p>
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

      {/* Pool stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-2xl font-bold text-white">
            {totalDepositedSol.toFixed(2)} SOL
          </div>
          <div className="text-sm text-gray-400">Total Deposits</div>
        </div>
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-400">
            {lotterySpots}
          </div>
          <div className="text-sm text-gray-400">Early Access Spots</div>
        </div>
      </div>

      {/* Your deposit */}
      {userDepositSol > 0 && (
        <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <p className="text-orange-400 text-sm">
            🎰 Your deposit: <span className="font-bold">{userDepositSol.toFixed(4)} SOL</span>
          </p>
        </div>
      )}

      {/* Deposit input */}
      {connected ? (
        <>
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">
              Deposit Amount (SOL)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-xl font-mono focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <button
            onClick={handleDeposit}
            disabled={!amount || parseFloat(amount) <= 0 || txLoading || !roundExists || !isActive}
            className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {txLoading ? '⏳ Confirming...' : '🎰 DEPOSIT FOR LOTTERY'}
          </button>
          
          {minDepositSol > 0 && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              Min: {minDepositSol} SOL | Max: {maxDepositSol} SOL
            </p>
          )}
        </>
      ) : (
        <WalletMultiButton className="!w-full !py-4 !rounded-xl !font-bold !text-lg !bg-gradient-to-r !from-orange-500 !to-red-500 hover:!from-orange-600 hover:!to-red-600 !transition-all !h-auto !justify-center" />
      )}

      {/* How it works */}
      <div className="mt-6 pt-4 border-t border-gray-800">
        <h4 className="text-sm font-bold text-gray-400 mb-3">How Presale Works</h4>
        <div className="space-y-2 text-sm text-gray-500">
          <div className="flex items-start gap-2">
            <span>1️⃣</span>
            <span>Deposit SOL during cooldown period</span>
          </div>
          <div className="flex items-start gap-2">
            <span>2️⃣</span>
            <span>Lottery picks {lotterySpots} winners for early access</span>
          </div>
          <div className="flex items-start gap-2">
            <span>3️⃣</span>
            <span>Winners get first buy at launch price</span>
          </div>
          <div className="flex items-start gap-2">
            <span>4️⃣</span>
            <span>Non-winners get refunded automatically</span>
          </div>
        </div>
      </div>
    </div>
  );
};
