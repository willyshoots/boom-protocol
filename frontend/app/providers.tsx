'use client';

import { FC, ReactNode, useMemo, useCallback } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { 
  PhantomWalletAdapter, 
  SolflareWalletAdapter,
  TorusWalletAdapter,
  LedgerWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { WalletError } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';

import '@solana/wallet-adapter-react-ui/styles.css';

interface ProvidersProps {
  children: ReactNode;
}

export const Providers: FC<ProvidersProps> = ({ children }) => {
  // Use devnet for development, can be changed via env var
  const endpoint = useMemo(() => {
    return process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
  }, []);
  
  // Configure wallets - Phantom is FIRST (primary)
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),      // Primary wallet
      new SolflareWalletAdapter(),     // Popular alternative
      new TorusWalletAdapter(),        // Web-based option
      new LedgerWalletAdapter(),       // Hardware wallet
    ],
    []
  );

  // Handle wallet errors gracefully
  const onError = useCallback((error: WalletError) => {
    console.error('[Wallet Error]', error);
    
    // Don't show error for user rejection (they clicked cancel)
    if (error.name === 'WalletConnectionError') {
      return;
    }
    
    // Could add toast notification here
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect
        onError={onError}
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
