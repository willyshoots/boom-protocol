'use client';

import { FC, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useProgram } from '../hooks/useProgram';
import { usePresale } from '../hooks/usePresale';

export const AdminPanel: FC = () => {
  const { connected, publicKey } = useWallet();
  const { 
    initializeProtocol, 
    startPresale, 
    endPresaleAndLottery, 
    markWinner,
    checkProtocolInitialized,
  } = useProgram();

  const [activeTab, setActiveTab] = useState<'init' | 'start' | 'end' | 'winner'>('start');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [protocolInitialized, setProtocolInitialized] = useState<boolean | null>(null);

  // Form states
  const [initForm, setInitForm] = useState({
    treasury: '',
    minCap: '1',
    maxCap: '100',
    feeBps: '250',
  });

  const [startForm, setStartForm] = useState({
    roundId: '1',
    cooldownMinutes: '30',
    lotterySpots: '10',
    minDeposit: '0.1',
    maxDeposit: '10',
  });

  const [endForm, setEndForm] = useState({
    roundId: '1',
    winnerIndexes: '',
  });

  const [winnerForm, setWinnerForm] = useState({
    roundId: '1',
    winnerPubkey: '',
  });

  // Check protocol status
  const checkProtocol = useCallback(async () => {
    const initialized = await checkProtocolInitialized();
    setProtocolInitialized(initialized);
  }, [checkProtocolInitialized]);

  // Initialize protocol
  const handleInitialize = useCallback(async () => {
    if (!connected) return;
    
    setLoading(true);
    setStatus(null);
    
    try {
      const treasuryPubkey = initForm.treasury 
        ? new PublicKey(initForm.treasury) 
        : publicKey!;
      
      const tx = await initializeProtocol(
        treasuryPubkey,
        parseFloat(initForm.minCap),
        parseFloat(initForm.maxCap),
        parseInt(initForm.feeBps)
      );
      
      setStatus({ type: 'success', message: `Protocol initialized! Tx: ${tx.slice(0, 16)}...` });
      setProtocolInitialized(true);
    } catch (err) {
      console.error('Initialize failed:', err);
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to initialize' });
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, initForm, initializeProtocol]);

  // Start presale
  const handleStartPresale = useCallback(async () => {
    if (!connected) return;
    
    setLoading(true);
    setStatus(null);
    
    try {
      const tx = await startPresale(
        parseInt(startForm.roundId),
        parseInt(startForm.cooldownMinutes) * 60, // Convert to seconds
        parseInt(startForm.lotterySpots),
        parseFloat(startForm.minDeposit),
        parseFloat(startForm.maxDeposit)
      );
      
      setStatus({ type: 'success', message: `Presale started! Tx: ${tx.slice(0, 16)}...` });
    } catch (err) {
      console.error('Start presale failed:', err);
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to start presale' });
    } finally {
      setLoading(false);
    }
  }, [connected, startForm, startPresale]);

  // End presale and lottery
  const handleEndPresale = useCallback(async () => {
    if (!connected) return;
    
    setLoading(true);
    setStatus(null);
    
    try {
      const winnerIndexes = endForm.winnerIndexes
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '')
        .map(s => parseInt(s));
      
      const tx = await endPresaleAndLottery(
        parseInt(endForm.roundId),
        winnerIndexes
      );
      
      setStatus({ type: 'success', message: `Presale finalized! Tx: ${tx.slice(0, 16)}...` });
    } catch (err) {
      console.error('End presale failed:', err);
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to end presale' });
    } finally {
      setLoading(false);
    }
  }, [connected, endForm, endPresaleAndLottery]);

  // Mark winner
  const handleMarkWinner = useCallback(async () => {
    if (!connected) return;
    
    setLoading(true);
    setStatus(null);
    
    try {
      const winnerPubkey = new PublicKey(winnerForm.winnerPubkey);
      
      const tx = await markWinner(
        parseInt(winnerForm.roundId),
        winnerPubkey
      );
      
      setStatus({ type: 'success', message: `Winner marked! Tx: ${tx.slice(0, 16)}...` });
    } catch (err) {
      console.error('Mark winner failed:', err);
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to mark winner' });
    } finally {
      setLoading(false);
    }
  }, [connected, winnerForm, markWinner]);

  if (!connected) {
    return (
      <div className="boom-card border-2 border-purple-500/50">
        <h2 className="text-xl font-bold text-white mb-4">🔐 Admin Panel</h2>
        <p className="text-gray-400">Connect your wallet to access admin functions.</p>
      </div>
    );
  }

  return (
    <div className="boom-card border-2 border-purple-500/50">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">🔐 Admin Panel</h2>
        <button
          onClick={checkProtocol}
          className="px-3 py-1 text-sm bg-gray-800 rounded-lg hover:bg-gray-700"
        >
          Check Protocol
        </button>
      </div>

      {/* Protocol status */}
      {protocolInitialized !== null && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          protocolInitialized 
            ? 'bg-green-500/20 border border-green-500/30 text-green-400' 
            : 'bg-yellow-500/20 border border-yellow-500/30 text-yellow-400'
        }`}>
          {protocolInitialized ? '✅ Protocol initialized' : '⚠️ Protocol not initialized - initialize first!'}
        </div>
      )}

      {/* Status message */}
      {status && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          status.type === 'success' 
            ? 'bg-green-500/20 border border-green-500/30 text-green-400' 
            : 'bg-red-500/20 border border-red-500/30 text-red-400'
        }`}>
          {status.type === 'success' ? '✅' : '❌'} {status.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {[
          { id: 'init', label: '🏗️ Initialize' },
          { id: 'start', label: '🚀 Start Presale' },
          { id: 'end', label: '🏁 End & Lottery' },
          { id: 'winner', label: '🏆 Mark Winner' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-purple-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Initialize Protocol Form */}
      {activeTab === 'init' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Treasury Address (optional, defaults to your wallet)</label>
            <input
              type="text"
              value={initForm.treasury}
              onChange={e => setInitForm(f => ({ ...f, treasury: e.target.value }))}
              placeholder={publicKey?.toString()}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Min Cap (SOL)</label>
              <input
                type="number"
                value={initForm.minCap}
                onChange={e => setInitForm(f => ({ ...f, minCap: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Cap (SOL)</label>
              <input
                type="number"
                value={initForm.maxCap}
                onChange={e => setInitForm(f => ({ ...f, maxCap: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Fee (bps)</label>
              <input
                type="number"
                value={initForm.feeBps}
                onChange={e => setInitForm(f => ({ ...f, feeBps: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <button
            onClick={handleInitialize}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50"
          >
            {loading ? '⏳ Initializing...' : '🏗️ Initialize Protocol'}
          </button>
        </div>
      )}

      {/* Start Presale Form */}
      {activeTab === 'start' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Round ID</label>
              <input
                type="number"
                value={startForm.roundId}
                onChange={e => setStartForm(f => ({ ...f, roundId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Cooldown (minutes)</label>
              <input
                type="number"
                value={startForm.cooldownMinutes}
                onChange={e => setStartForm(f => ({ ...f, cooldownMinutes: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Lottery Spots</label>
            <input
              type="number"
              value={startForm.lotterySpots}
              onChange={e => setStartForm(f => ({ ...f, lotterySpots: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Min Deposit (SOL)</label>
              <input
                type="number"
                value={startForm.minDeposit}
                onChange={e => setStartForm(f => ({ ...f, minDeposit: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Deposit (SOL)</label>
              <input
                type="number"
                value={startForm.maxDeposit}
                onChange={e => setStartForm(f => ({ ...f, maxDeposit: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <button
            onClick={handleStartPresale}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 disabled:opacity-50"
          >
            {loading ? '⏳ Starting...' : '🚀 Start Presale Round'}
          </button>
        </div>
      )}

      {/* End Presale Form */}
      {activeTab === 'end' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Round ID</label>
            <input
              type="number"
              value={endForm.roundId}
              onChange={e => setEndForm(f => ({ ...f, roundId: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Winner Indexes (comma-separated, e.g. 0,3,7)</label>
            <input
              type="text"
              value={endForm.winnerIndexes}
              onChange={e => setEndForm(f => ({ ...f, winnerIndexes: e.target.value }))}
              placeholder="0, 1, 2"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              These indexes are for off-chain reference. Call markWinner for each winner after.
            </p>
          </div>
          <button
            onClick={handleEndPresale}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 disabled:opacity-50"
          >
            {loading ? '⏳ Finalizing...' : '🏁 End Presale & Run Lottery'}
          </button>
        </div>
      )}

      {/* Mark Winner Form */}
      {activeTab === 'winner' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Round ID</label>
            <input
              type="number"
              value={winnerForm.roundId}
              onChange={e => setWinnerForm(f => ({ ...f, roundId: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Winner Wallet Address</label>
            <input
              type="text"
              value={winnerForm.winnerPubkey}
              onChange={e => setWinnerForm(f => ({ ...f, winnerPubkey: e.target.value }))}
              placeholder="Winner's public key"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            onClick={handleMarkWinner}
            disabled={loading || !winnerForm.winnerPubkey}
            className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50"
          >
            {loading ? '⏳ Marking...' : '🏆 Mark as Winner'}
          </button>
        </div>
      )}

      {/* Info */}
      <div className="mt-6 pt-4 border-t border-gray-800 text-xs text-gray-500">
        <p>⚠️ Admin functions require the authority wallet that started the presale.</p>
        <p className="mt-1">Connected: {publicKey?.toString().slice(0, 8)}...{publicKey?.toString().slice(-8)}</p>
      </div>
    </div>
  );
};
