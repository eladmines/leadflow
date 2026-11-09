import { businessWebPaths, type AttributionReportRow, type ReportSummary } from '@leadflow/shared';
import { Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { shekel } from '../leads/api';
import { SourceBadge } from '../leads/Attribution';
import { tr } from '../../i18n';

const rate = (r: AttributionReportRow) =>
  r.won + r.lost > 0 ? `${Math.round((r.won / (r.won + r.lost)) * 100)}%` : '—';

/**
 * F26: which sources and campaigns bring leads and customers. A customer = a lead in a Won stage
 * or with an accepted quote; each row opens those leads.
 */
export function CustomerSources({
  businessId,
  report,
}: {
  businessId: string;
  report: Pick<ReportSummary, 'byAttribution' | 'byCampaign'>;
}) {
  const leadsLink = (r: AttributionReportRow, campaign?: string) => {
    const q = new URLSearchParams({ view: 'list', from: r.source });
    if (campaign) q.set('campaign', campaign);
    return `${businessWebPaths.section(businessId, 'leads')}?${q}`;
  };
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Megaphone aria-hidden className="h-5 w-5 text-accent-600" />
          {tr('מאיפה מגיעים הלקוחות')}
        </h2>
        <p className="text-sm text-ink-muted">
          {tr(
            'לפי מקור ולפי קמפיין: כמה פניות, כמה הפכו ללקוחות (שלב "נסגר" או הצעת מחיר שאושרה) וכמה כסף.',
          )}
        </p>
      </div>
      {report.byAttribution.length === 0 ? (
        <p className="text-sm text-ink-muted">{tr('אין פניות בתקופה הזו.')}</p>
      ) : (
        <Table
          caption={tr('לקוחות לפי מקור')}
          first={tr('מקור')}
          rows={report.byAttribution.map((r) => ({
            key: `${r.source}|${r.name ?? ''}`,
            row: r,
            label: <SourceBadge source={r.source} name={r.name} />,
            to: leadsLink(r),
          }))}
        />
      )}
      {report.byCampaign.length > 0 && (
        <Table
          caption={tr('הקמפיינים המובילים')}
          first={tr('קמפיין')}
          rows={report.byCampaign.map((r) => ({
            key: `${r.source}|${r.name ?? ''}|${r.campaign}`,
            row: r,
            label: (
              <span className="flex flex-wrap items-center gap-1.5">
                <bdi className="font-medium text-ink">{r.campaign}</bdi>
                <SourceBadge source={r.source} name={r.name} />
              </span>
            ),
            to: leadsLink(r, r.campaign),
          }))}
        />
      )}
      <TagYourAds />
    </Card>
  );
}

function Table({
  caption,
  first,
  rows,
}: {
  caption: string;
  first: string;
  rows: { key: string; row: AttributionReportRow; label: React.ReactNode; to: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="pb-2 text-start text-sm font-medium text-ink">{caption}</caption>
        <thead className="text-ink-muted">
          <tr>
            <th className="py-1.5 text-start font-medium">{first}</th>
            <th className="py-1.5 text-end font-medium">{tr('פניות')}</th>
            <th className="py-1.5 text-end font-medium">{tr('הפכו ללקוחות')}</th>
            <th className="py-1.5 text-end font-medium">{tr('שווי עסקאות')}</th>
            <th className="py-1.5 text-end font-medium">{tr('אחוז סגירה')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, row, label, to }) => (
            <tr key={key} className="border-t border-surface-border">
              <td className="py-2">
                <Link
                  to={to}
                  className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {label}
                </Link>
              </td>
              <td className="py-2 text-end tabular-nums text-ink">{row.leads}</td>
              <td className="py-2 text-end tabular-nums font-semibold text-emerald-700">
                {row.won}
              </td>
              <td className="py-2 text-end tabular-nums text-ink">
                <bdi>{row.wonValue ? shekel.format(row.wonValue) : '—'}</bdi>
              </td>
              <td className="py-2 text-end tabular-nums text-ink">{rate(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How to make ads show up here (F26 help). */
function TagYourAds() {
  return (
    <details className="rounded-2xl bg-surface-muted p-4 text-sm">
      <summary className="cursor-pointer font-medium text-brand-700">
        {tr('איך מסמנים מודעות כדי לראות אותן כאן?')}
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-2 ps-5 text-ink">
        <li>
          {tr(
            'Google Ads: הפעילו "תיוג אוטומטי" (Auto-tagging) בהגדרות החשבון. כל לחיצה על מודעה תסומן לבד.',
          )}
        </li>
        <li>
          {tr(
            'פייסבוק, אינסטגרם, ניוזלטר וכל קישור אחר: הוסיפו לכתובת האתר את שם המקור והקמפיין, למשל:',
          )}
          <code
            dir="ltr"
            className="mt-1 block overflow-x-auto rounded-lg bg-surface px-2 py-1 text-xs text-ink"
          >
            ?utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign=summer
          </code>
        </li>
        <li>
          {tr(
            'מודעות "לחיצה לוואטסאפ" בפייסבוק ובאינסטגרם מסומנות לבד. ממודעות גוגל לוואטסאפ: כתבו הודעה פתוחה אחרת לכל קמפיין.',
          )}
        </li>
      </ol>
      <p className="mt-3 text-xs text-ink-muted">
        {tr('האתר שומר את המקור בעוגייה קטנה ל-30 יום, בלי פרטים אישיים, עד שהמבקר משאיר פרטים.')}
      </p>
    </details>
  );
}
