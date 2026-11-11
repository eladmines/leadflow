import { Link } from 'react-router-dom';
import { buttonClasses, EmptyState } from '../components/ui';
import { tr } from '../i18n';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={tr('העמוד לא נמצא')}
        description={tr('ייתכן שהקישור שגוי או שהעמוד הוסר.')}
        action={
          <Link to="/" className={buttonClasses('secondary', 'md')}>
            {tr('חזרה לדף הבית')}
          </Link>
        }
      />
    </main>
  );
}
