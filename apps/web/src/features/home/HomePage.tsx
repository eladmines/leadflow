import { Alert, Card, Spinner } from '../../components/ui';
import { useHealth } from './useHealth';

/**
 * Temporary foundation page (F00). Replaced by login/onboarding in F01–F03.
 * Shows that the RTL design system and API/DB connectivity are working.
 */
export function HomePage() {
  const health = useHealth();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-brand-600">LeadFlow</p>
        <h1 className="text-3xl font-bold text-ink">האתר, הלידים והשיחות של העסק — במקום אחד</h1>
        <p className="text-ink-muted">
          סביבת הפיתוח מוכנה. בשלב הבא נוסיף הרשמה, התחברות והקמת עסק.
        </p>
      </header>

      <Card>
        <h2 className="mb-3 text-base font-semibold">מצב המערכת</h2>
        {health.isPending && <Spinner label="בודק חיבור לשרת…" />}
        {health.isSuccess && <Alert tone="success" title="השרת ומסד הנתונים זמינים" />}
        {health.isError && (
          <Alert tone="danger" title="אין חיבור לשרת או למסד הנתונים">
            ודאו שה־API רץ ושמסד הנתונים הופעל (docker compose up -d).
          </Alert>
        )}
      </Card>
    </main>
  );
}
