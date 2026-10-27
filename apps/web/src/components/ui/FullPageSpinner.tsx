import { Spinner } from './Spinner';

/** Shown while the session is being checked, so guarded pages never flash. */
export function FullPageSpinner({ label = 'טוען…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-brand-600">
      <Spinner label={label} />
    </div>
  );
}
