import { cn } from '../../lib/cn';

/**
 * Renders site HTML in a fully sandboxed iframe (no scripts, no same-origin access).
 * `scale` shrinks a desktop-width page into a thumbnail.
 */
export function PreviewFrame({
  html,
  title,
  device = 'desktop',
  scale,
  className,
}: {
  html: string;
  title: string;
  device?: 'desktop' | 'mobile';
  scale?: number;
  className?: string;
}) {
  if (scale) {
    return (
      <div className={cn('relative overflow-hidden', className)} aria-hidden>
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          className="pointer-events-none absolute start-0 top-0 origin-top-right border-0 bg-white"
          style={{
            width: `${100 / scale}%`,
            height: `${100 / scale}%`,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'mx-auto h-full overflow-hidden bg-white transition-[width] duration-300',
        device === 'mobile'
          ? 'w-[390px] max-w-full rounded-[2rem] border-[10px] border-ink shadow-lift'
          : 'w-full rounded-2xl border border-surface-border shadow-card',
        className,
      )}
    >
      <iframe title={title} srcDoc={html} sandbox="" className="h-full w-full border-0" />
    </div>
  );
}
