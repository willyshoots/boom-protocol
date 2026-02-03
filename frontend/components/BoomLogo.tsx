'use client';

import { FC } from 'react';

interface BoomLogoProps {
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

export const BoomLogo: FC<BoomLogoProps> = ({ size = 'md', animated = true }) => {
  const sizes = {
    sm: 'w-24 h-24',
    md: 'w-40 h-40',
    lg: 'w-64 h-64'
  };

  const textSizes = {
    sm: 'text-2xl',
    md: 'text-4xl',
    lg: 'text-6xl'
  };

  return (
    <div className={`relative ${sizes[size]} ${animated ? 'animate-pulse-glow' : ''}`}>
      {/* Explosion background */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full">
        {/* Outer explosion spikes */}
        <polygon 
          points="100,10 115,50 150,20 130,60 180,50 140,80 190,100 140,110 180,150 130,130 150,180 115,140 100,190 85,140 50,180 70,130 20,150 60,110 10,100 60,80 20,50 70,60 50,20 85,50"
          fill="url(#explosionGradient)"
          className={animated ? 'animate-pulse' : ''}
        />
        {/* Inner explosion */}
        <ellipse cx="100" cy="100" rx="50" ry="45" fill="#ffc107" />
        <defs>
          <linearGradient id="explosionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff6b35" />
            <stop offset="50%" stopColor="#ffc107" />
            <stop offset="100%" stopColor="#ff6b35" />
          </linearGradient>
        </defs>
      </svg>
      
      {/* TNT Dynamite */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[60%]">
        <div className="flex flex-col items-center">
          {/* Fuse */}
          <div className="relative">
            <div className="w-1 h-4 bg-gray-800 rounded-t" />
            {/* Spark */}
            <div className={`absolute -top-2 left-1/2 transform -translate-x-1/2 w-3 h-3 ${animated ? 'animate-ping' : ''}`}>
              <svg viewBox="0 0 20 20" className="w-full h-full">
                <polygon points="10,0 12,8 20,10 12,12 10,20 8,12 0,10 8,8" fill="#ffc107" />
              </svg>
            </div>
          </div>
          {/* Dynamite sticks */}
          <div className="flex gap-0.5">
            <div className="w-3 h-8 bg-gradient-to-b from-red-600 to-red-800 rounded-sm border border-red-900" />
            <div className="w-3 h-8 bg-gradient-to-b from-red-600 to-red-800 rounded-sm border border-red-900" />
            <div className="w-3 h-8 bg-gradient-to-b from-red-600 to-red-800 rounded-sm border border-red-900" />
          </div>
        </div>
      </div>

      {/* BOOM text */}
      <div className={`absolute bottom-[25%] left-1/2 transform -translate-x-1/2 ${textSizes[size]} font-black`}>
        <span 
          className="text-transparent bg-clip-text"
          style={{
            backgroundImage: 'linear-gradient(180deg, #fff 0%, #ffc107 50%, #ff6b35 100%)',
            WebkitBackgroundClip: 'text',
            textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000'
          }}
        >
          BOOM
        </span>
      </div>
    </div>
  );
};
