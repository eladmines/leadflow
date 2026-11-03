import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';
import { tr } from '../i18n';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={tr('העמוד לא נמצא')}
        description={tr('ייתכן שהקישור שגוי או שהעמוד הוסר.')}
        action={
          <Link to="/" className="text-sm font-medium text-brand-600 underline">
            {tr('חזרה לדף הבית')}
          </Link>
        }
      />
    </main>
  );
}
