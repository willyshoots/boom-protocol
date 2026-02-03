'use client';

import { FC, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePresale } from '../hooks/usePresale';

interface PresalePanelProps {
  roundId?: number;
}

export const PresalePanel: FC<PresalePanelProps> = ({ roundId = 1 }) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('');
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });
  const [txStatus, setTxStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const {
    loading,
    txLoading,
    error,
    roundExists,
    isActive,
    isFinalized,
    hasEnded,
    totalDepositedSol,
    userDepositSol,
    minDepositSol,
    maxDepositSol,
    endTime,
    lotterySpots,
    totalDepositors,
    isWinner,
    hasClaimed,
    deposit,
    refund,
    claimWinner,
    refresh,
  } = usePresale(roundId);

  // Countdown timer
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = endTime.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft({ minutes: 0, seconds: 0 });
        return;
      }
      
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ minutes, seconds });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  // Clear tx status after 5 seconds
  useEffect(() => {
    if (txStatus) {
      const timeout = setTimeout(() => setTxStatus(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [txStatus]);

  const handleDeposit = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;
    
    try {
      setTxStatus(null);
      const signature = await deposit(numAmount);
      setAmount('');
      setTxStatus({ 
        type: 'success', 
        message: `Deposit successful! Tx: ${signature.slice(0, 8)}...` 
      });
    } catch (err) {
      console.error('Deposit failed:', err);
      setTxStatus({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Deposit failed' 
      });
    }
  }, [amount, deposit]);

  const handleRefund = useCallback(async () => {
    try {
      setTxStatus(null);
      const signature = await refund();
      setTxStatus({ 
        type: 'success', 
        message: `Refund claimed! Tx: ${signature.slice(0, 8)}...` 
      });
    } catch (err) {
      console.error('Refund failed:', err);
      setTxStatus({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Refund failed' 
      });
    }
  }, [refund]);

  const handleClaimWinner = useCallback(async () => {
    try {
      setTxStatus(null);
      const signature = await claimWinner();
      setTxStatus({ 
        type: 'success', 
        message: `Claimed! Tx: ${signature.slice(0, 8)}...` 
      });
    } catch (err) {
      console.error('Claim failed:', err);
      setTxStatus({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Claim failed' 
      });
    }
  }, [claimWinner]);

  // Loading state
  if (loading) {
    return (
      <div className="boom-card border-2 border-gray-700">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
          <span className="ml-3 text-gray-400">Loading presale data...</span>
        </div>
      </div>
    );
  }

  // No presale round exists
  if (!roundExists) {
    return (
      <div className="boom-card border-2 border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-2xl">
              ⏸️
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">NO ACTIVE PRESALE</h2>
              <p className="text-sm text-gray-400">Round {roundId} has not started</p>
            </div>
          </div>
          <button 
            onClick={refresh}
            className="px-4 py-2 text-sm bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
        <p className="text-center text-gray-500 py-8">
          Check back soon or contact the admin to start a presale round.
        </p>
      </div>
    );
  }

  // Render presale panel
  return (
    <div className={`boom-card border-2 ${isActive ? 'border-orange-500/50' : isFinalized ? 'border-green-500/50' : 'border-yellow-500/50'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
            isActive ? 'bg-gradient-to-br from-orange-500 to-yellow-500 animate-pulse' :
            isFinalized ? 'bg-gradient-to-br from-green-500 to-emerald-500' :
            'bg-gradient-to-br from-yellow-500 to-orange-500'
          }`}>
            {isActive ? '⏳' : isFinalized ? '✅' : '⏰'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {isActive ? 'PRESALE ACTIVE' : isFinalized ? 'PRESALE COMPLETE' : 'PRESALE ENDED'}
            </h2>
            <p className="text-sm text-gray-400">
              Round #{roundId} • {totalDepositors} depositors
            </p>
          </div>
        </div>
        <button 
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          🔄
        </button>
      </div>

      {/* Transaction Status */}
      {txStatus && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          txStatus.type === 'success' ? 'bg-green-500/20 border border-green-500/30 text-green-400' :
          'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {txStatus.type === 'success' ? '✅' : '❌'} {txStatus.message}
        </div>
      )}

      {/* Countdown (only show if active) */}
      {isActive && (
        <div className="mb-6 p-6 bg-gradient-to-r from-orange-500/20 to-red-500/20 rounded-xl border border-orange-500/30">
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-2">Cooldown ends in</p>
            <div className="flex items-center justify-center gap-4">
              <div className="bg-gray-900 rounded-lg p-4 min-w-[80px]">
                <div className="text-4xl font-bold text-orange-400 font-mono">
                  {String(timeLeft.minutes).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 uppercase">Minutes</div>
              </div>
              <div className="text-3xl text-gray-600">:</div>
              <div className="bg-gray-900 rounded-lg p-4 min-w-[80px]">
                <div className="text-4xl font-bold text-orange-400 font-mono">
                  {String(timeLeft.seconds).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 uppercase">Seconds</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Finalized status message */}
      {isFinalized && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-xl border border-green-500/30 text-center">
          <p className="text-green-400 font-bold">🎉 Lottery Complete!</p>
          <p className="text-sm text-gray-400 mt-1">
            Winners can claim their allocation. Non-winners can claim refunds.
          </p>
        </div>
      )}

      {/* Ended but not finalized */}
      {hasEnded && !isFinalized && (
        <div className="mb-6 p-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-xl border border-yellow-500/30 text-center">
          <p className="text-yellow-400 font-bold">⏰ Deposit Period Ended</p>
          <p className="text-sm text-gray-400 mt-1">
            Waiting for admin to run lottery...
          </p>
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

      {/* Deposit limits */}
      {isActive && (
        <div className="mb-4 p-3 bg-gray-800/30 rounded-lg text-sm text-gray-400">
          <span className="text-gray-500">Deposit limits:</span> {minDepositSol.toFixed(2)} - {maxDepositSol.toFixed(2)} SOL
        </div>
      )}

      {/* Your deposit */}
      {userDepositSol > 0 && (
        <div className={`mb-6 p-4 rounded-lg border ${
          isWinner ? 'bg-yellow-500/10 border-yellow-500/30' :
          'bg-green-500/10 border-green-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <span className={isWinner ? 'text-yellow-400' : 'text-green-400'}>
              {isWinner ? '🏆 WINNER!' : 'Your Deposit'}
            </span>
            <span className={`text-xl font-bold ${isWinner ? 'text-yellow-400' : 'text-green-400'}`}>
              {userDepositSol.toFixed(4)} SOL
            </span>
          </div>
          {!isFinalized && !isWinner && (
            <p className="text-xs text-gray-500 mt-1">
              You're in the lottery! Winners get early access to buy.
            </p>
          )}
          {isWinner && !hasClaimed && (
            <p className="text-xs text-yellow-400/70 mt-1">
              Congratulations! You won early access. Claim your allocation below.
            </p>
          )}
          {hasClaimed && (
            <p className="text-xs text-gray-500 mt-1">
              ✅ Already claimed
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {connected ? (
        <>
          {/* Deposit input - only show during active presale */}
          {isActive && (
            <>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">
                  Deposit Amount (SOL)
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`${minDepositSol.toFixed(2)} - ${maxDepositSol.toFixed(2)}`}
                  min={minDepositSol}
                  max={maxDepositSol}
                  step="0.01"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-xl font-mono focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>

              <button
                onClick={handleDeposit}
                disabled={!amount || parseFloat(amount) <= 0 || txLoading}
                className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {txLoading ? '⏳ Processing...' : '🎰 DEPOSIT FOR LOTTERY'}
              </button>
            </>
          )}

          {/* Post-finalization actions */}
          {isFinalized && userDepositSol > 0 && !hasClaimed && (
            <div className="space-y-3">
              {isWinner ? (
                <button
                  onClick={handleClaimWinner}
                  disabled={txLoading}
                  className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 transition-all disabled:opacity-50"
                >
                  {txLoading ? '⏳ Processing...' : '🏆 CLAIM WINNER ALLOCATION'}
                </button>
              ) : (
                <button
                  onClick={handleRefund}
                  disabled={txLoading}
                  className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 transition-all disabled:opacity-50"
                >
                  {txLoading ? '⏳ Processing...' : '💰 CLAIM REFUND'}
                </button>
              )}
            </div>
          )}

          {/* Already claimed message */}
          {isFinalized && hasClaimed && (
            <div className="text-center py-4 text-gray-400">
              ✅ You've already claimed your {isWinner ? 'allocation' : 'refund'}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-4 text-gray-400">
          Connect wallet to participate
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
          ⚠️ {error}
        </div>
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
