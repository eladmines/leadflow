import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title="העמוד לא נמצא"
        description="ייתכן שהקישור שגוי או שהעמוד הוסר."
        action={
          <Link to="/" className="text-sm font-medium text-brand-600 underline">
            חזרה לדף הבית
          </Link>
        }
      />
    </main>
  );
}
