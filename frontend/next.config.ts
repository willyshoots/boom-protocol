import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Vercel
  output: 'standalone',
  
  // Disable image optimization for simpler deployment
  images: {
    unoptimized: true,
  },
  
  // Empty turbopack config to use defaults (silences webpack warning)
  turbopack: {},
};

export default nextConfig;
