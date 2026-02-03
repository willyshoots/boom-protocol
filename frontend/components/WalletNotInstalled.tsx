'use client';

import { FC } from 'react';

interface WalletNotInstalledProps {
  onClose: () => void;
}

export const WalletNotInstalled: FC<WalletNotInstalledProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Phantom logo */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
            <svg className="w-12 h-12 text-white" viewBox="0 0 128 128" fill="currentColor">
              <path d="M64 0C28.7 0 0 28.7 0 64s28.7 64 64 64 64-28.7 64-64S99.3 0 64 0zm32.3 72.5c-3.8 11.8-12.8 21.8-25.8 28.5-4.1 2.1-8.9-.6-8.9-5.2V79.2c0-2.8-2.3-5.1-5.1-5.1H47c-2.8 0-5.1 2.3-5.1 5.1v16.6c0 4.6-4.8 7.3-8.9 5.2-13-6.7-22-16.7-25.8-28.5-1.3-4.1 2.4-7.9 6.7-7.9h8.5c2.8 0 5.1-2.3 5.1-5.1V47c0-2.8 2.3-5.1 5.1-5.1h62.8c4.3 0 8 3.8 6.7 7.9z"/>
            </svg>
          </div>
        </div>

        {/* Content */}
        <h2 className="text-2xl font-bold text-white text-center mb-2">
          Phantom Wallet Required
        </h2>
        <p className="text-gray-400 text-center mb-6">
          To use BOOM Protocol, you need to install the Phantom wallet extension for your browser.
        </p>

        {/* Features */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <svg className="w-5 h-5 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>Most popular Solana wallet</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <svg className="w-5 h-5 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>Secure and non-custodial</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <svg className="w-5 h-5 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>Free to install and use</span>
          </div>
        </div>

        {/* CTA Button */}
        <a
          href="https://phantom.app/download"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-purple-700 hover:from-purple-600 hover:to-purple-800 rounded-xl font-bold text-white text-center transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/25"
        >
          Install Phantom Wallet
        </a>

        {/* Alternative */}
        <p className="text-center text-sm text-gray-500 mt-4">
          Already installed?{' '}
          <button 
            onClick={() => window.location.reload()} 
            className="text-purple-400 hover:text-purple-300 underline"
          >
            Refresh page
          </button>
        </p>
      </div>
    </div>
  );
};
