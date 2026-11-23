import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';

/**
 * A chevron that folds a part of a screen away and back. `controls` is the id of what it folds;
 * `label` names it for screen readers ("תצוגת האתר").
 */
export function CollapseButton({
  collapsed,
  onToggle,
  controls,
  label,
  showText = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
  /** Show "הצגה" / "הסתרה" beside the chevron. */
  showText?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={collapsed ? tr('הצגה: {0}', label) : tr('הסתרה: {0}', label)}
      title={collapsed ? tr('הצגה') : tr('הסתרה')}
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-ink-muted outline-none hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {showText && <span>{collapsed ? tr('הצגה') : tr('הסתרה')}</span>}
      <ChevronDown
        aria-hidden
        className={cn(
          'h-4 w-4 transition-transform motion-reduce:transition-none',
          !collapsed && 'rotate-180',
        )}
      />
    </button>
  );
}
