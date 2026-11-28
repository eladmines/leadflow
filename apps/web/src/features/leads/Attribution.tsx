import {
  attributionName,
  attributionSourceLabels,
  UNKNOWN_SOURCE_LABEL,
  type Attribution,
  type AttributionSource,
} from '@simplecatch/shared';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { AttributionIcon } from './SourceIcon';

/** One colour per source, so the badge reads at a glance (the name is always written too). */
const TONES: Record<AttributionSource | 'unknown', string> = {
  google_ads: 'bg-sky-100 text-sky-800 ring-sky-200',
  google: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  meta_ads: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  meta: 'bg-blue-100 text-blue-800 ring-blue-200',
  tiktok: 'bg-pink-100 text-pink-800 ring-pink-200',
  microsoft_ads: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  utm: 'bg-amber-100 text-amber-800 ring-amber-200',
  referral: 'bg-violet-100 text-violet-800 ring-violet-200',
  direct: 'bg-slate-100 text-slate-700 ring-slate-200',
  unknown: 'bg-slate-50 text-slate-500 ring-slate-200',
};

/** The source's name as shown: utm_source / the other site's host as written, labels translated. */
export function sourceName(source: AttributionSource | 'unknown', name?: string | null): string {
  if (source === 'unknown') return tr(UNKNOWN_SOURCE_LABEL);
  if (name) return name;
  return tr(attributionSourceLabels[source]);
}

export function SourceBadge({
  source,
  name,
  className,
}: {
  source: AttributionSource | 'unknown';
  name?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[source],
        className,
      )}
    >
      <AttributionIcon source={source} />
      <bdi>{sourceName(source, name)}</bdi>
    </span>
  );
}

/** The ad, campaign, keyword and landing page of a lead's attribution, as label/value rows (F26). */
export function attributionRows(attribution?: Attribution | null): [string, string][] {
  if (!attribution) return [];
  return (
    [
      [tr('קמפיין'), attribution.campaign],
      [tr('מודעה'), attribution.adHeadline],
      [tr('מילת חיפוש'), attribution.term],
      [tr('מודעה / גרסה'), attribution.content],
      [tr('סוג'), attribution.medium],
      [tr('הגיע מהאתר'), attribution.source === 'referral' ? undefined : attribution.referrerHost],
      [tr('עמוד ראשון באתר'), attribution.landingPath],
    ] as [string, string | undefined][]
  ).filter((r): r is [string, string] => !!r[1]);
}

/** The source's name: the referring site or UTM source when known, else the source's label. */
export function attributionSourceName(attribution: Attribution) {
  const named =
    attribution.source === 'utm' || attribution.source === 'referral'
      ? attributionName(attribution)
      : null;
  return sourceName(attribution.source, named);
}

/** The rows as a definition list (the lead page's source details, D-218). */
export function AttributionDetails({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="break-words text-ink">
            <bdi>{value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
