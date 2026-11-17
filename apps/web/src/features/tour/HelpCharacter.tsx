import { useId } from 'react';
import { cn } from '../../lib/cn';

/**
 * The help character (D-105, redrawn in D-183): the C of the logo around a round face. It floats and
 * blinks, tilts hello when `waving`, and smiles with closed eyes when `happy` (menu open). Motion
 * only runs for people who haven't asked for reduced motion. The C is never mirrored (it must stay
 * a C); only the eyes follow the page direction and look towards the content.
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
  const uid = useId().replace(/:/g, '');
  const ring = `lf-helper-ring-${uid}`;
  const face = `lf-helper-face-${uid}`;
  const fillBox = { transformBox: 'fill-box' } as const;
  return (
    <svg
      aria-hidden
      viewBox="0 0 64 64"
      className={cn('motion-safe:animate-helper-float', className)}
    >
      <defs>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8ff7" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eaf2ff" />
          <stop offset="1" stopColor="#cfe0ff" />
        </linearGradient>
      </defs>

      <g
        className={cn(waving && 'motion-safe:animate-helper-wave')}
        style={{ ...fillBox, transformOrigin: '50% 100%' }}
      >
        <path
          d="M47.5 14.5 A22 22 0 1 0 47.5 49.5"
          fill="none"
          stroke={`url(#${ring})`}
          strokeWidth="11"
          strokeLinecap="round"
        />
        <circle cx="31" cy="32" r="14.5" fill={`url(#${face})`} />

        {happy ? (
          <g stroke="#1e1b4b" strokeWidth="2.6" fill="none" strokeLinecap="round">
            <path d="M22.5 31 q4 -5 8 0" />
            <path d="M32 31 q4 -5 8 0" />
            <path d="M25 36.5 q6 6.5 12 0" />
          </g>
        ) : (
          <>
            <g
              className="motion-safe:animate-helper-blink"
              style={{ ...fillBox, transformOrigin: '50% 50%' }}
            >
              {/* Looking towards the content: left in LTR, right in RTL */}
              <g className="rtl:hidden" fill="#1e1b4b">
                <circle cx="25.4" cy="30" r="2.6" />
                <circle cx="35.4" cy="30" r="2.6" />
              </g>
              <g className="hidden rtl:inline" fill="#1e1b4b">
                <circle cx="27.6" cy="30" r="2.6" />
                <circle cx="37.6" cy="30" r="2.6" />
              </g>
            </g>
            <path
              d="M26 37 q5 4.6 10 0"
              stroke="#1e1b4b"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
          </>
        )}
      </g>
    </svg>
  );
}
