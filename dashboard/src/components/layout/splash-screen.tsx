'use client';

import { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'fade'>('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 100);
    const t2 = setTimeout(() => setPhase('fade'), 1000);
    const t3 = setTimeout(() => onComplete(), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
      style={{
        opacity: phase === 'fade' ? 0 : 1,
        transition: 'opacity 0.5s ease-out',
      }}
    >

      <div className="relative flex items-center justify-center" style={{ width: 400, height: 400 }}>

        {/* Ring 1 - outermost */}
        <svg className="absolute inset-0" width="400" height="400" viewBox="0 0 400 400">
          <circle
            cx="200" cy="200" r="190"
            fill="none" stroke="currentColor" strokeWidth="0.5"
            className="text-primary/15"
            strokeDasharray="1194"
            strokeDashoffset={phase === 'enter' ? '1194' : '0'}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>

        {/* Ring 2 */}
        <svg className="absolute inset-0" width="400" height="400" viewBox="0 0 400 400">
          <circle
            cx="200" cy="200" r="155"
            fill="none" stroke="currentColor" strokeWidth="0.8"
            className="text-primary/25"
            strokeDasharray="974"
            strokeDashoffset={phase === 'enter' ? '974' : '0'}
            style={{ transition: 'stroke-dashoffset 0.8s ease-out 0.1s' }}
          />
        </svg>

        {/* Ring 3 - innermost */}
        <svg className="absolute inset-0" width="400" height="400" viewBox="0 0 400 400">
          <circle
            cx="200" cy="200" r="120"
            fill="none" stroke="currentColor" strokeWidth="1.2"
            className="text-primary/40"
            strokeDasharray="754"
            strokeDashoffset={phase === 'enter' ? '754' : '0'}
            style={{ transition: 'stroke-dashoffset 0.7s ease-out 0.2s' }}
          />
        </svg>

        {/* Particle dots orbiting outside all rings */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
          const radius = phase === 'enter' ? 0 : 190;
          const rad = (angle * Math.PI) / 180;
          const x = 200 + radius * Math.sin(rad);
          const y = 200 - radius * Math.cos(rad);
          return (
            <div
              key={angle}
              className="absolute h-1.5 w-1.5 rounded-full bg-primary"
              style={{
                left: x - 3,
                top: y - 3,
                opacity: phase === 'enter' ? 0 : 0.5,
                transition: `all 0.8s ease-out ${i * 40}ms`,
              }}
            />
          );
        })}

        {/* Logo + text centered */}
        <div
          className="relative z-10 flex flex-col items-center gap-3"
          style={{
            opacity: phase === 'enter' ? 0 : 1,
            transform: phase === 'enter' ? 'scale(0.8)' : 'scale(1)',
            transition: 'all 0.6s ease-out 0.15s',
          }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold shadow-xl shadow-primary/25">
            cO
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">cortextOS</h1>
            <p className="text-xs text-muted-foreground mt-1">Agent Orchestration</p>
          </div>
        </div>
      </div>
    </div>
  );
}
