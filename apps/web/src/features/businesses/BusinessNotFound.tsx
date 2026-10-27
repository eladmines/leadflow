import { authWebPaths } from '@leadflow/shared';
import { EmptyState, TextLink } from '../../components/ui';

/** Unknown business id, or one the user isn't a member of (the API answers 404 for both). */
export function BusinessNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title="העסק לא נמצא"
        description="ייתכן שהקישור שגוי, או שאין לך גישה לעסק הזה."
        action={<TextLink to={authWebPaths.appHome}>חזרה לעסקים שלי</TextLink>}
      />
    </main>
  );
}
