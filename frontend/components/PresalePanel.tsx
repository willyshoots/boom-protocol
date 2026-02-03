'use client';

import { FC, useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface PresalePanelProps {
  cooldownEndsAt: Date;
  totalDeposits: number;
  yourDeposit: number;
  lotterySpots: number;
  onDeposit?: (amount: number) => void;
}

export const PresalePanel: FC<PresalePanelProps> = ({
  cooldownEndsAt,
  totalDeposits,
  yourDeposit,
  lotterySpots,
  onDeposit
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('');
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = cooldownEndsAt.getTime() - now.getTime();
      
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
  }, [cooldownEndsAt]);

  const handleDeposit = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;
    onDeposit?.(numAmount);
    setAmount('');
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
            <h2 className="text-xl font-bold text-white">PRESALE ACTIVE</h2>
            <p className="text-sm text-gray-400">Next token launching soon!</p>
          </div>
        </div>
      </div>

      {/* Countdown */}
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

      {/* Pool stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-2xl font-bold text-white">
            {totalDeposits.toFixed(2)} SOL
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
      {yourDeposit > 0 && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-green-400">Your Deposit</span>
            <span className="text-xl font-bold text-green-400">{yourDeposit.toFixed(4)} SOL</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            You're in the lottery! Winners get early access to buy.
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
            disabled={!amount || parseFloat(amount) <= 0}
            className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🎰 DEPOSIT FOR LOTTERY
          </button>
        </>
      ) : (
        <div className="text-center py-4 text-gray-400">
          Connect wallet to deposit
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
