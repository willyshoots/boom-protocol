'use client';

import { FC, useEffect, useState } from 'react';

interface ExplosionOverlayProps {
  isExploding: boolean;
  tokenSymbol: string;
  payout: number;
  multiplier: number;
  onClose: () => void;
}

export const ExplosionOverlay: FC<ExplosionOverlayProps> = ({
  isExploding,
  tokenSymbol,
  payout,
  multiplier,
  onClose
}) => {
  const [confetti, setConfetti] = useState<Array<{ id: number; left: number; color: string; delay: number }>>([]);

  useEffect(() => {
    if (isExploding) {
      // Generate confetti
      const newConfetti = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: ['#ff6b35', '#ffc107', '#22c55e', '#ef4444', '#8b5cf6'][Math.floor(Math.random() * 5)],
        delay: Math.random() * 2
      }));
      setConfetti(newConfetti);

      // Auto close after 5 seconds
      const timeout = setTimeout(onClose, 5000);
      return () => clearTimeout(timeout);
    }
  }, [isExploding, onClose]);

  if (!isExploding) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Background overlay */}
      <div 
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />

      {/* Explosion radial */}
      <div className="absolute inset-0 explosion-overlay animate-pulse" />

      {/* Confetti */}
      {confetti.map((piece) => (
        <div
          key={piece.id}
          className="absolute w-3 h-3 rounded-sm"
          style={{
            left: `${piece.left}%`,
            top: '-20px',
            backgroundColor: piece.color,
            animation: `confetti-fall 3s linear ${piece.delay}s forwards`
          }}
        />
      ))}

      {/* Main content */}
      <div className="relative z-10 text-center animate-shake">
        {/* Big BOOM */}
        <div className="text-8xl md:text-9xl font-black mb-4">
          <span 
            className="text-transparent bg-clip-text"
            style={{
              backgroundImage: 'linear-gradient(180deg, #fff 0%, #ffc107 50%, #ff6b35 100%)',
              WebkitBackgroundClip: 'text',
              textShadow: '4px 4px 0 #000'
            }}
          >
            💥 BOOM! 💥
          </span>
        </div>

        {/* Token info */}
        <div className="text-3xl font-bold text-white mb-6">
          ${tokenSymbol} just exploded!
        </div>

        {/* Payout card */}
        <div className="bg-gray-900/90 border-2 border-green-500 rounded-2xl p-8 max-w-md mx-4">
          <div className="text-gray-400 mb-2">Your Payout</div>
          <div className="text-5xl font-bold text-green-400 mb-2">
            ${payout.toLocaleString()}
          </div>
          <div className="text-2xl text-green-300">
            {multiplier}x multiplier!
          </div>

          <button
            onClick={onClose}
            className="mt-6 px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl font-bold text-lg hover:from-green-600 hover:to-emerald-600 transition-all"
          >
            🎉 Claim Payout
          </button>
        </div>

        {/* Skip text */}
        <p className="mt-4 text-gray-500 text-sm">Click anywhere to continue</p>
      </div>
    </div>
  );
};
