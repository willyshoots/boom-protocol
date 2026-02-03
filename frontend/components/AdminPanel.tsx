'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';

// Program ID from deployment
const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

export const AdminPanel: FC = () => {
  const { connected, publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Form states
  const [roundId, setRoundId] = useState('1');
  const [cooldownMinutes, setCooldownMinutes] = useState('30');
  const [lotterySpots, setLotterySpots] = useState('10');
  const [minDeposit, setMinDeposit] = useState('0.1');
  const [maxDeposit, setMaxDeposit] = useState('10');

  const showStatus = (msg: string, isError = false) => {
    setStatus(msg);
    console.log(isError ? 'Error:' : 'Success:', msg);
    setTimeout(() => setStatus(null), 5000);
  };

  // Check if protocol PDA exists
  const checkProtocol = async () => {
    try {
      const [protocolPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol')],
        PROGRAM_ID
      );
      const info = await connection.getAccountInfo(protocolPDA);
      showStatus(info ? '✅ Protocol is initialized' : '❌ Protocol not initialized');
    } catch (e: any) {
      showStatus(`Error: ${e.message}`, true);
    }
  };

  // Check if presale round exists
  const checkPresale = async () => {
    try {
      const roundIdBN = new BN(parseInt(roundId));
      const [presalePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('presale'), roundIdBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );
      const info = await connection.getAccountInfo(presalePDA);
      showStatus(info ? `✅ Presale round ${roundId} exists` : `❌ Presale round ${roundId} not found`);
    } catch (e: any) {
      showStatus(`Error: ${e.message}`, true);
    }
  };

  if (!connected) {
    return (
      <div className="boom-card border border-yellow-500/30">
        <h3 className="text-lg font-bold text-yellow-400 mb-4">🔐 Admin Panel</h3>
        <p className="text-gray-400">Connect wallet to access admin functions</p>
      </div>
    );
  }

  return (
    <div className="boom-card border border-yellow-500/30">
      <h3 className="text-lg font-bold text-yellow-400 mb-4">🔐 Admin Panel</h3>
      
      {status && (
        <div className={`mb-4 p-3 rounded-lg ${status.includes('Error') || status.includes('❌') ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
          {status}
        </div>
      )}

      {/* Quick Checks */}
      <div className="mb-6">
        <h4 className="text-sm font-bold text-gray-400 mb-2">Quick Checks</h4>
        <div className="flex gap-2">
          <button
            onClick={checkProtocol}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
          >
            Check Protocol
          </button>
          <button
            onClick={checkPresale}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
          >
            Check Presale
          </button>
        </div>
      </div>

      {/* Round ID input */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Round ID</label>
        <input
          type="number"
          value={roundId}
          onChange={(e) => setRoundId(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* Presale Settings */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Cooldown (min)</label>
          <input
            type="number"
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Lottery Spots</label>
          <input
            type="number"
            value={lotterySpots}
            onChange={(e) => setLotterySpots(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Min Deposit (SOL)</label>
          <input
            type="number"
            value={minDeposit}
            onChange={(e) => setMinDeposit(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Max Deposit (SOL)</label>
          <input
            type="number"
            value={maxDeposit}
            onChange={(e) => setMaxDeposit(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Info */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
        <p><strong>Program ID:</strong></p>
        <p className="font-mono text-xs break-all">{PROGRAM_ID.toString()}</p>
        <p className="mt-2"><strong>Your Wallet:</strong></p>
        <p className="font-mono text-xs break-all">{publicKey?.toString()}</p>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Note: Full admin functions (initialize, start presale) require calling the Anchor program directly. 
        Use the CLI or a script for now.
      </div>
    </div>
  );
};
