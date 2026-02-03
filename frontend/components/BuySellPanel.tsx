'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface BuySellPanelProps {
  tokenSymbol: string;
  currentPrice: number;
  onBuy?: (amount: number) => void;
  onSell?: (amount: number) => void;
}

export const BuySellPanel: FC<BuySellPanelProps> = ({ 
  tokenSymbol, 
  currentPrice,
  onBuy,
  onSell 
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');

  const handleAction = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    if (activeTab === 'buy') {
      onBuy?.(numAmount);
    } else {
      onSell?.(numAmount);
    }
    setAmount('');
  };

  const quickAmounts = [0.1, 0.5, 1, 5];

  return (
    <div className="boom-card">
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('buy')}
          className={`flex-1 py-2 px-4 rounded-lg font-bold transition-all ${
            activeTab === 'buy'
              ? 'bg-green-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setActiveTab('sell')}
          className={`flex-1 py-2 px-4 rounded-lg font-bold transition-all ${
            activeTab === 'sell'
              ? 'bg-red-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          SELL
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">
          Amount ({activeTab === 'buy' ? 'SOL' : tokenSymbol})
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-xl font-mono focus:outline-none focus:border-orange-500 transition-colors"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">
            {activeTab === 'buy' ? 'SOL' : tokenSymbol}
          </span>
        </div>
      </div>

      {/* Quick amounts */}
      <div className="flex gap-2 mb-4">
        {quickAmounts.map((qa) => (
          <button
            key={qa}
            onClick={() => setAmount(qa.toString())}
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            {qa} {activeTab === 'buy' ? 'SOL' : ''}
          </button>
        ))}
      </div>

      {/* Estimate */}
      {amount && parseFloat(amount) > 0 && (
        <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">You'll {activeTab === 'buy' ? 'receive' : 'get'}:</span>
            <span className="text-white font-medium">
              {activeTab === 'buy' 
                ? `~${(parseFloat(amount) / currentPrice).toLocaleString()} ${tokenSymbol}`
                : `~${(parseFloat(amount) * currentPrice).toFixed(4)} SOL`
              }
            </span>
          </div>
        </div>
      )}

      {/* Action button */}
      {connected ? (
        <button
          onClick={handleAction}
          disabled={!amount || parseFloat(amount) <= 0}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            activeTab === 'buy' ? 'btn-buy' : 'btn-sell'
          }`}
        >
          {activeTab === 'buy' ? `🚀 BUY $${tokenSymbol}` : `💰 SELL $${tokenSymbol}`}
        </button>
      ) : (
        <div className="text-center py-4 text-gray-400">
          Connect wallet to trade
        </div>
      )}

      {/* Warning */}
      <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <span className="text-orange-400">⚠️</span>
          <p className="text-sm text-orange-300">
            Token could BOOM any second! If it explodes while you hold, you get your share of the payout.
          </p>
        </div>
      </div>
    </div>
  );
};
