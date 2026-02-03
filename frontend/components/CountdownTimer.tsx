'use client';

import { FC, useState, useEffect } from 'react';

interface CountdownTimerProps {
  targetTime: Date | null;
  label: string;
  onComplete?: () => void;
  className?: string;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const CountdownTimer: FC<CountdownTimerProps> = ({
  targetTime,
  label,
  onComplete,
  className = '',
}) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!targetTime) {
      setTimeRemaining(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = targetTime.getTime() - now;
      
      if (remaining <= 0) {
        setTimeRemaining(0);
        if (!isComplete) {
          setIsComplete(true);
          onComplete?.();
        }
      } else {
        setTimeRemaining(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [targetTime, isComplete, onComplete]);

  if (!targetTime) {
    return (
      <div className={`text-gray-500 ${className}`}>
        {label} <span className="font-mono">--:--</span>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {label}{' '}
      <span className="font-mono font-bold">
        {isComplete ? 'COMPLETE!' : formatTimeRemaining(timeRemaining)}
      </span>
    </div>
  );
};

// Presale-specific countdown
interface FundingCountdownProps {
  endTime: Date | null;
  onComplete?: () => void;
  className?: string;
}

export const FundingCountdown: FC<FundingCountdownProps> = ({
  endTime,
  onComplete,
  className = '',
}) => {
  return (
    <CountdownTimer
      targetTime={endTime}
      label="Funding round:"
      onComplete={onComplete}
      className={`text-blue-400 ${className}`}
    />
  );
};

// Explosion-specific countdown
interface ExplosionCountdownProps {
  deadline: Date | null;
  onComplete?: () => void;
  className?: string;
}

export const ExplosionCountdown: FC<ExplosionCountdownProps> = ({
  deadline,
  onComplete,
  className = '',
}) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    if (!deadline) return;

    const updateTimer = () => {
      const remaining = deadline.getTime() - Date.now();
      setTimeRemaining(Math.max(0, remaining));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  // Change color as time gets shorter
  const getColorClass = () => {
    if (!deadline || timeRemaining <= 0) return 'text-red-500';
    const minutes = timeRemaining / 1000 / 60;
    if (minutes < 1) return 'text-red-500 animate-pulse';
    if (minutes < 5) return 'text-orange-500';
    if (minutes < 15) return 'text-yellow-500';
    return 'text-green-400';
  };

  return (
    <CountdownTimer
      targetTime={deadline}
      label="Time till BOOM:"
      onComplete={onComplete}
      className={`${getColorClass()} ${className}`}
    />
  );
};
