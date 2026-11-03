import { useId } from 'react';
import { cn } from '../../lib/cn';

/**
 * The help character (D-105): the LeadFlow mark come to life — the green rounded body with the
 * coral dot as a bobble on top. It floats and blinks, waves when `waving`, and smiles with closed
 * eyes when `happy` (menu open). Motion only runs for people who haven't asked for reduced motion.
 * Drawn facing the content (it looks towards the start side), so it flips in right-to-left.
 */
export function HelpCharacter({
  happy,
  waving,
  className,
}: {
  happy?: boolean;
  waving?: boolean;
  className?: string;
}) {
  const body = `lf-helper-${useId().replace(/:/g, '')}`;
  const fillBox = { transformBox: 'fill-box' } as const;
  return (
    <svg
      aria-hidden
      viewBox="0 0 56 56"
      className={cn('rtl:-scale-x-100 motion-safe:animate-helper-float', className)}
    >
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c837d" />
          <stop offset="1" stopColor="#1b5653" />
        </linearGradient>
      </defs>

      {/* Bobble: the logo's coral dot on a little stalk */}
      <g
        className="motion-safe:animate-helper-bob"
        style={{ ...fillBox, transformOrigin: '50% 100%' }}
      >
        <path
          d="M28 17 C28 12 30 10 32 8.5"
          stroke="#1b5653"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="32.5" cy="7.5" r="3.6" fill="#f77f57" />
      </g>

      {/* Waving arm, on the side facing the content */}
      <g
        className={cn(waving && 'motion-safe:animate-helper-wave')}
        style={{ ...fillBox, transformOrigin: '100% 100%' }}
      >
        <path
          d="M12 35 C8 33 6 30 5.5 26"
          stroke="#1f6a66"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="5.5" cy="25" r="3" fill="#2c837d" />
      </g>
      {/* Other arm, resting */}
      <path
        d="M44 36 C47 37 48.5 39 49 41.5"
        stroke="#1f6a66"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />

      <rect x="10" y="16" width="36" height="32" rx="12" fill={`url(#${body})`} />
      {/* The logo's flow line as a little highlight */}
      <path
        d="M15 22c2-2 4-3 7-3"
        stroke="#fff"
        strokeOpacity="0.35"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />

      {happy ? (
        <g stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round">
          <path d="M17 30.5c1.5-3 6.5-3 8 0" />
          <path d="M31 30.5c1.5-3 6.5-3 8 0" />
        </g>
      ) : (
        <g
          className="motion-safe:animate-helper-blink"
          style={{ ...fillBox, transformOrigin: '50% 50%' }}
        >
          <ellipse cx="21" cy="30" rx="4.6" ry="5.2" fill="#fff" />
          <ellipse cx="35" cy="30" rx="4.6" ry="5.2" fill="#fff" />
          {/* Looking towards the content */}
          <circle cx="19.8" cy="30.8" r="2.3" fill="#163b39" />
          <circle cx="33.8" cy="30.8" r="2.3" fill="#163b39" />
          <circle cx="19" cy="29.6" r="0.8" fill="#fff" />
          <circle cx="33" cy="29.6" r="0.8" fill="#fff" />
        </g>
      )}
      <circle cx="16" cy="37.5" r="2.2" fill="#ffb4a0" opacity="0.8" />
      <circle cx="40" cy="37.5" r="2.2" fill="#ffb4a0" opacity="0.8" />
      <path
        d={happy ? 'M23.5 38c2 3.6 7 3.6 9 0' : 'M24.5 38.5c1.8 2.4 5.2 2.4 7 0'}
        stroke="#fff"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
