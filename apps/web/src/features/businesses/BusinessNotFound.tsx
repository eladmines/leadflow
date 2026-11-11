import { authWebPaths } from '@leadflow/shared';
import { Link } from 'react-router-dom';
import { buttonClasses, EmptyState } from '../../components/ui';
import { tr } from '../../i18n';

/** Unknown business id, or one the user isn't a member of (the API answers 404 for both). */
export function BusinessNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={tr('העסק לא נמצא')}
        description={tr('ייתכן שהקישור שגוי, או שאין לך גישה לעסק הזה.')}
        action={
          <Link to={authWebPaths.appHome} className={buttonClasses('secondary', 'md')}>
            {tr('חזרה לעסקים שלי')}
          </Link>
        }
      />
    </main>
  );
}
