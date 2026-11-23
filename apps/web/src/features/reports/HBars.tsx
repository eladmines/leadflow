export function HBars({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; name: string; icon?: React.ReactNode; count: number; extra?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-ink">
              {r.icon}
              {r.name}
            </span>
            <span className="tabular-nums text-ink-muted">
              {r.count}
              {r.extra && (
                <>
                  {' '}
                  · <bdi>{r.extra}</bdi>
                </>
              )}
            </span>
          </div>
          <div className="h-3 rounded bg-surface-sunken">
            <div
              className="h-full rounded bg-chart"
              style={{ width: r.count ? `max(4px, ${(r.count / max) * 100}%)` : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
