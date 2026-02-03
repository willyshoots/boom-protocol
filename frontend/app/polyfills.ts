// Polyfills for Solana wallet adapter in browser
import { Buffer } from 'buffer';

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  (window as any).global = window;
  (window as any).process = { env: {} };
}

export {};
