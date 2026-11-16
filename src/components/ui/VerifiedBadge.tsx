import React from 'react';
import { BadgeCheck } from 'lucide-react';

interface VerifiedBadgeProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  label = 'Doğrulanmış Hesap',
  size = 'md',
  showText = false,
}) => {
  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  if (showText) {
    return (
      <span
        title={label}
        aria-label={label}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold shrink-0"
      >
        <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>Doğrulandı</span>
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center rounded-full text-emerald-600 dark:text-emerald-400 shrink-0"
    >
      <BadgeCheck className={`${iconSizes[size]} fill-emerald-500/15`} />
    </span>
  );
};
