'use client';

import { useEffect, useState } from 'react';

export default function TestPage() {
  const [phantomStatus, setPhantomStatus] = useState<string>('checking...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkPhantom = async () => {
      try {
        const phantom = (window as any).phantom?.solana || (window as any).solana;
        
        if (!phantom) {
          setPhantomStatus('Phantom not found');
          return;
        }
        
        if (!phantom.isPhantom) {
          setPhantomStatus('Found wallet but not Phantom');
          return;
        }
        
        setPhantomStatus('Phantom detected! Click button to connect.');
      } catch (e: any) {
        setError(e.message);
      }
    };
    
    setTimeout(checkPhantom, 500);
  }, []);

  const handleConnect = async () => {
    try {
      setPhantomStatus('Connecting...');
      const phantom = (window as any).phantom?.solana || (window as any).solana;
      const response = await phantom.connect();
      setPhantomStatus(`Connected: ${response.publicKey.toString()}`);
    } catch (e: any) {
      setError(e.message);
      setPhantomStatus('Connection failed');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-2xl mb-4">Phantom Direct Test</h1>
      <p className="mb-4">Status: {phantomStatus}</p>
      {error && <p className="text-red-500 mb-4">Error: {error}</p>}
      <button 
        onClick={handleConnect}
        className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-bold"
      >
        Connect Directly to Phantom
      </button>
    </div>
  );
}
