import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  info: 'bg-brand-50 text-brand-800 border-brand-200',
  success: 'bg-success-50 text-success-600 border-success-600/30',
  warning: 'bg-warning-50 text-warning-600 border-warning-600/30',
  danger: 'bg-danger-50 text-danger-700 border-danger-600/30',
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}

/** Status message. Danger alerts are announced immediately to screen readers. */
export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1')}>{children}</div>}
    </div>
  );
}
