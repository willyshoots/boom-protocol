'use client';

import { FC } from 'react';
import Image from 'next/image';

interface BoomLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export const BoomLogo: FC<BoomLogoProps> = ({ size = 'md' }) => {
  const sizes = {
    sm: { width: 48, height: 48 },
    md: { width: 80, height: 80 },
    lg: { width: 128, height: 128 }
  };

  const { width, height } = sizes[size];

  return (
    <Image
      src="/logo.png"
      alt="BOOM Protocol"
      width={width}
      height={height}
      className="object-contain"
      style={{ 
        filter: 'saturate(1.4) brightness(1.15) contrast(1.1)'
      }}
      priority
    />
  );
};
