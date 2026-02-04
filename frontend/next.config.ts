import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Vercel
  output: 'standalone',
  
  // Disable image optimization for simpler deployment
  images: {
    unoptimized: true,
  },
  
  // Explicitly set turbopack root to frontend directory
  // This prevents confusion from parent lockfiles
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
