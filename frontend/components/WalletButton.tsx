'use client';

import { FC, useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

export const WalletButton: FC = () => {
  const { publicKey, wallet, disconnect, connecting, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Truncate wallet address
  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Copy address to clipboard
  const copyAddress = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Handle connect click
  const handleConnect = () => {
    setVisible(true);
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    await disconnect();
    setShowDropdown(false);
  };

  // Not connected state
  if (!connected && !connecting) {
    return (
      <button
        onClick={handleConnect}
        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 rounded-xl font-bold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-orange-500/25"
      >
        <svg 
          className="w-5 h-5" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </svg>
        Connect Wallet
      </button>
    );
  }

  // Connecting state
  if (connecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-5 py-2.5 bg-gray-700 rounded-xl font-bold text-gray-300 cursor-wait"
      >
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Connecting...
      </button>
    );
  }

  // Connected state
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl font-medium text-white transition-all"
      >
        {/* Wallet icon */}
        {wallet?.adapter.icon ? (
          <img 
            src={wallet.adapter.icon} 
            alt={wallet.adapter.name} 
            className="w-5 h-5 rounded-full"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-500" />
        )}
        
        {/* Address */}
        <span className="font-mono">
          {publicKey && truncateAddress(publicKey.toBase58())}
        </span>
        
        {/* Dropdown arrow */}
        <svg 
          className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
          {/* Wallet info */}
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center gap-2 mb-1">
              {wallet?.adapter.icon && (
                <img 
                  src={wallet.adapter.icon} 
                  alt={wallet.adapter.name} 
                  className="w-4 h-4 rounded-full"
                />
              )}
              <span className="text-sm font-medium text-white">
                {wallet?.adapter.name}
              </span>
            </div>
            <p className="text-xs text-gray-400 font-mono">
              {publicKey?.toBase58()}
            </p>
          </div>

          {/* Actions */}
          <div className="py-1">
            {/* Copy address */}
            <button
              onClick={copyAddress}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  Copy Address
                </>
              )}
            </button>

            {/* View on Solscan */}
            <a
              href={`https://solscan.io/account/${publicKey?.toBase58()}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" x2="21" y1="14" y2="3" />
              </svg>
              View on Solscan
            </a>

            {/* Change wallet */}
            <button
              onClick={() => {
                setShowDropdown(false);
                setVisible(true);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              Change Wallet
            </button>

            {/* Disconnect */}
            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
