import { businessWebPaths, sectionTypeLabels, type Behavior } from '@simplecatch/shared';
import { MousePointerClick } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { HBars } from './HBars';
import { tr } from '../../i18n';

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

/** `services` → "Services", `services-2` → "Services (2)"; a name the owner gave is shown as it is. */
function sectionName(name: string) {
  const m = /^(.+?)(?:-(\d+))?$/.exec(name);
  const label = m && (sectionTypeLabels as Record<string, string | undefined>)[m[1]!];
  return label ? `${tr(label)}${m![2] ? ` (${m![2]})` : ''}` : name;
}

/** "3 of 120 (2.5%)"; blank when the leads can't be told apart from the visits. */
const conversion = (leads: number, visits: number) =>
  visits > 0 && leads <= visits
    ? `${tr('{0} מתוך {1}', leads, visits)} (${Math.round((leads / visits) * 1000) / 10}%)`
    : '—';

/**
 * F32: what visitors do on a website with the SimpleCatch script, as counts: pages, landing pages,
 * devices, taps on contact links, how far they scroll, forms started. Never who they are.
 */
export function BehaviorCard({
  businessId,
  behavior: b,
}: {
  businessId: string;
  behavior: Behavior;
}) {
  const devices = b.devices.mobile + b.devices.tablet + b.devices.desktop;
  // Scroll, taps and forms started need the script on the site; SimpleCatch's own sites show dashes.
  const scrolled = b.scroll.p50 + b.scroll.p90 > 0;
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <MousePointerClick aria-hidden className="h-5 w-5 text-rose-600" />
          {tr('מה גולשים עושים באתר')}
        </h2>
        <p className="text-sm text-ink-muted">
          {tr(
            'ספירה בלבד, בלי לזהות אנשים: אילו דפים נצפים, איפה נכנסים, באיזה מכשיר, על מה לוחצים ועד איפה גוללים.',
          )}
        </p>
      </div>
      {b.pageViews === 0 ? (
        <p className="text-sm text-ink-muted">
          {tr('עוד אין נתונים. הם מתחילים להיספר אחרי שמדביקים את הסקריפט באתר.')}{' '}
          <Link
            to={businessWebPaths.section(businessId, 'site')}
            className="font-medium text-brand-700 underline"
          >
            {tr('לאתר שלי')}
          </Link>
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label={tr('צפיות בדפים')} value={String(b.pageViews)} />
            <Fact label={tr('לחצו על טלפון')} value={String(b.clicks.phone)} />
            <Fact label={tr('לחצו על וואטסאפ')} value={String(b.clicks.whatsapp)} />
            <Fact label={tr('לחצו על מייל')} value={String(b.clicks.email)} />
            <Fact label={tr('התחילו למלא טופס')} value={String(b.formStarts)} />
            <Fact
              label={tr('גללו עד סוף הדף')}
              value={scrolled ? percent(b.scroll.p90, b.pageViews) : '—'}
              note={
                scrolled ? tr('עד אמצע הדף: {0}', percent(b.scroll.p50, b.pageViews)) : undefined
              }
            />
          </dl>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-ink">{tr('הדפים הנצפים ביותר')}</h3>
              <HBars
                label={tr('הדפים הנצפים ביותר')}
                rows={b.topPages.map((p) => ({
                  key: p.path,
                  name: p.path,
                  count: p.views,
                }))}
              />
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-ink">{tr('באיזה מכשיר')}</h3>
              <HBars
                label={tr('באיזה מכשיר')}
                rows={[
                  { key: 'mobile', name: tr('נייד'), count: b.devices.mobile },
                  { key: 'desktop', name: tr('מחשב'), count: b.devices.desktop },
                  { key: 'tablet', name: tr('טאבלט'), count: b.devices.tablet },
                ].map((d) => ({ ...d, extra: percent(d.count, devices) }))}
              />
            </section>
          </div>
          {b.sections.length > 0 && (
            <div className="scrollbar-visible overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="pb-2 text-start text-sm font-medium text-ink">
                  {tr('הסקשנים שהגולשים ראו')}
                </caption>
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1.5 text-start font-medium">{tr('סקשן')}</th>
                    <th className="py-1.5 text-start font-medium">{tr('דף')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('נצפה')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('לחצו')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('מצפיות הדף')}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.sections.map((x) => (
                    <tr key={`${x.path}#${x.name}`} className="border-t border-surface-border">
                      <td className="py-2 font-medium text-ink">{sectionName(x.name)}</td>
                      <td className="py-2">
                        <bdi dir="ltr" className="text-ink-muted">
                          {x.path}
                        </bdi>
                      </td>
                      <td className="py-2 text-end tabular-nums text-ink">{x.views}</td>
                      <td className="py-2 text-end tabular-nums text-ink">{x.clicks}</td>
                      <td className="py-2 text-end tabular-nums text-ink">
                        {x.pageViews >= x.views ? percent(x.views, x.pageViews) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {b.ctas.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-ink">{tr('לחיצות על כפתורים שנבחרו')}</h3>
              <HBars
                label={tr('כפתורים שנבחרו לספירה')}
                rows={b.ctas.map((c) => ({ key: c.name, name: c.name, count: c.count }))}
              />
            </section>
          )}
          {b.landing.length > 0 && (
            <div className="scrollbar-visible overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="pb-2 text-start text-sm font-medium text-ink">
                  {tr('דפי נחיתה: כמה נכנסו וכמה השאירו פנייה')}
                </caption>
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1.5 text-start font-medium">{tr('דף')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('כניסות')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('פניות')}</th>
                    <th className="py-1.5 text-end font-medium">{tr('הפכו לפנייה')}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.landing.map((l) => (
                    <tr key={l.path} className="border-t border-surface-border">
                      <td className="py-2">
                        <bdi dir="ltr" className="font-medium text-ink">
                          {l.path}
                        </bdi>
                      </td>
                      <td className="py-2 text-end tabular-nums text-ink">{l.visits}</td>
                      <td className="py-2 text-end tabular-nums text-ink">{l.leads}</td>
                      <td className="py-2 text-end tabular-nums text-ink">
                        <bdi>{conversion(l.leads, l.visits)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            {tr(
              'המספרים משוערים: חוסמי פרסומות ובוטים משפיעים, ודף קצר שנכנס כולו למסך נחשב כנצפה עד הסוף. סקשן נחשב כנצפה אחרי חצי שנייה על המסך.',
            )}
          </p>
        </>
      )}
    </Card>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-surface-muted p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-ink">{value}</dd>
      {note && <dd className="text-xs text-ink-muted">{note}</dd>}
    </div>
  );
}
