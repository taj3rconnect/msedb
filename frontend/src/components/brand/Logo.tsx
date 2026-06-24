import { useId } from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  title?: string;
}

/**
 * MSEDB abstract logo — a gradient tile with a stylized envelope mark and a
 * live "monitoring pulse" node. Rendered as inline SVG so it stays crisp at any
 * size and adapts to the surrounding layout via `className` (set width/height
 * there, e.g. `h-7 w-7`). The same artwork ships as `public/favicon.svg`.
 */
export function Logo({ className, title = 'MSEDB' }: LogoProps) {
  const uid = useId();
  const tileId = `${uid}-tile`;
  const pulseId = `${uid}-pulse`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('h-7 w-7', className)}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={tileId} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4338CA" />
          <stop offset="0.55" stopColor="#2563EB" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id={pulseId} x1="41" y1="12" x2="54" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5EEAD4" />
          <stop offset="1" stopColor="#34D399" />
        </linearGradient>
      </defs>
      {/* tile */}
      <rect x="4" y="4" width="56" height="56" rx="15" fill={`url(#${tileId})`} />
      <rect x="4" y="4" width="56" height="56" rx="15" fill="#FFFFFF" opacity="0.06" />
      {/* envelope body */}
      <rect
        x="14"
        y="24"
        width="32"
        height="20"
        rx="4.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      {/* envelope flap (abstract chevron) */}
      <path
        d="M15.5 27.5 L30 38 L44.5 27.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* live monitoring pulse node */}
      <circle cx="47.5" cy="18.5" r="6" fill={`url(#${pulseId})`} stroke="#FFFFFF" strokeWidth="2.6" />
    </svg>
  );
}
