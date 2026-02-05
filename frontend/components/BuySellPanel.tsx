'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useSwap } from '../hooks/useSwap';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

interface BuySellPanelProps {
  tokenSymbol: string;
  currentPrice?: number;
  roundId?: number;
}

export const BuySellPanel: FC<BuySellPanelProps> = ({ 
  tokenSymbol, 
  currentPrice,
  roundId = 1,
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState<string | null>(null);

  const { 
    loading, 
    error, 
    poolState, 
    userTokenBalance, 
    getQuote, 
    buy, 
    sell,
    refresh 
  } = useSwap(roundId);

  // Calculate quote when amount changes
  const quote = useMemo(() => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return null;
    return getQuote(numAmount, activeTab === 'buy');
  }, [amount, activeTab, getQuote]);

  // Format user token balance
  const formattedTokenBalance = useMemo(() => {
    return (Number(userTokenBalance) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [userTokenBalance]);

  const handleAction = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    setTxStatus('pending');
    setTxMessage(null);

    try {
      let sig: string;
      if (activeTab === 'buy') {
        sig = await buy(numAmount, 0); // 0 = no slippage protection for now
        setTxMessage(`Bought tokens! Tx: ${sig.slice(0, 8)}...`);
      } else {
        sig = await sell(numAmount, 0);
        setTxMessage(`Sold tokens! Tx: ${sig.slice(0, 8)}...`);
      }
      setTxStatus('success');
      setAmount('');
      
      // Clear success message after 5s
      setTimeout(() => {
        setTxStatus('idle');
        setTxMessage(null);
      }, 5000);
    } catch (err) {
      setTxStatus('error');
      setTxMessage(err instanceof Error ? err.message : 'Transaction failed');
      
      // Clear error after 5s
      setTimeout(() => {
        setTxStatus('idle');
        setTxMessage(null);
      }, 5000);
    }
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

      {/* User balance for sell mode */}
      {activeTab === 'sell' && userTokenBalance > BigInt(0) && (
        <div className="mb-4 p-3 bg-gray-800/50 rounded-lg flex justify-between items-center">
          <span className="text-gray-400 text-sm">Your balance:</span>
          <button 
            onClick={() => setAmount((Number(userTokenBalance) / 1e9).toString())}
            className="text-orange-400 font-medium hover:text-orange-300 text-sm"
          >
            {formattedTokenBalance} {tokenSymbol} (MAX)
          </button>
        </div>
      )}

      {/* Quote estimate */}
      {quote && (
        <div className="mb-4 p-3 bg-gray-800/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">You&apos;ll {activeTab === 'buy' ? 'receive' : 'get'}:</span>
            <span className="text-white font-medium">
              {activeTab === 'buy' 
                ? `~${quote.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`
                : `~${quote.amountOut.toFixed(4)} SOL`
              }
            </span>
          </div>
          {quote.priceImpact > 0.1 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Price impact:</span>
              <span className={quote.priceImpact > 5 ? 'text-red-400' : 'text-yellow-400'}>
                {quote.priceImpact.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Transaction status */}
      {txMessage && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          txStatus === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' :
          txStatus === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400' :
          'bg-blue-500/10 border border-blue-500/30 text-blue-400'
        }`}>
          {txStatus === 'pending' && '⏳ '}{txMessage}
        </div>
      )}

      {/* Action button */}
      {connected ? (
        <button
          onClick={handleAction}
          disabled={!amount || parseFloat(amount) <= 0 || loading || txStatus === 'pending' || !poolState}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            activeTab === 'buy' ? 'btn-buy' : 'btn-sell'
          }`}
        >
          {loading || txStatus === 'pending' ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </span>
          ) : !poolState ? (
            'Pool not active'
          ) : activeTab === 'buy' ? (
            `🚀 BUY $${tokenSymbol}`
          ) : (
            `💰 SELL $${tokenSymbol}`
          )}
        </button>
      ) : (
        <WalletMultiButton className="!w-full !py-4 !rounded-xl !font-bold !text-lg !bg-gradient-to-r !from-orange-500 !to-red-500 hover:!from-orange-600 hover:!to-red-600 !transition-all hover:!scale-[1.02] !flex !items-center !justify-center !gap-2 !h-auto" />
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
