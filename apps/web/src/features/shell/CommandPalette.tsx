import * as Dialog from '@radix-ui/react-dialog';
import {
  apiPaths,
  businessWebPaths,
  can,
  formatIsraeliPhone,
  type Business,
  type LeadListResponse,
} from '@leadflow/shared';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Plus, Search, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/cn';
import { navItems } from './nav';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
}

/** Ctrl/⌘+K anywhere in the app (D-074). */
export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/** The keyboard hint shown on search buttons. */
export const shortcutLabel =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/**
 * Quick search: jump to any page, start common actions, or find a lead by name, phone or
 * email (same search as the leads page, so employees only find their own leads).
 */
export function CommandPalette({
  business,
  open,
  onOpenChange,
}: {
  business: Business;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) {
      setQ('');
      setDebounced('');
    }
  }, [open]);

  const leads = useQuery({
    queryKey: ['businesses', business.id, 'leads', 'palette', debounced],
    queryFn: () =>
      apiFetch<LeadListResponse>(
        `${apiPaths.leads.list(business.id)}?q=${encodeURIComponent(debounced)}`,
      ),
    select: (d) => d.leads.slice(0, 6),
    enabled: open && debounced.length >= 2,
  });

  const commands = useMemo(() => {
    const section = (s: string) =>
      s ? businessWebPaths.section(business.id, s) : businessWebPaths.home(business.id);
    const actions: Command[] = [];
    if (can(business.role, 'leads.create')) {
      actions.push({
        id: 'new-lead',
        group: 'פעולות',
        label: 'ליד חדש',
        icon: Plus,
        to: `${section('leads')}?new=1`,
      });
    }
    actions.push({
      id: 'new-task',
      group: 'פעולות',
      label: 'משימה חדשה',
      icon: Plus,
      to: section('tasks'),
    });
    const pages: Command[] = navItems
      .filter((i) => !i.comingSoon && (!i.permission || can(business.role, i.permission)))
      .map((i) => ({
        id: `page-${i.segment || 'home'}`,
        group: 'מעבר לעמוד',
        label: i.label,
        icon: i.icon,
        to: section(i.segment),
      }));
    pages.push({
      id: 'page-account',
      group: 'מעבר לעמוד',
      label: 'החשבון שלי',
      icon: UserRound,
      to: section('account'),
    });
    const term = q.trim();
    const match = (c: Command) => !term || c.label.includes(term);
    const found: Command[] = (term.length >= 2 ? (leads.data ?? []) : []).map((l) => ({
      id: `lead-${l.id}`,
      group: 'לידים',
      label: l.contact.name,
      hint: l.contact.phone ? formatIsraeliPhone(l.contact.phone) : (l.contact.email ?? ''),
      icon: UserRound,
      to: `${section('leads')}/${l.id}`,
    }));
    return [...found, ...actions.filter(match), ...pages.filter(match)];
  }, [business.id, business.role, q, leads.data]);

  useEffect(() => setActive(0), [q, commands.length]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    navigate(c.to);
  };

  const groups = commands.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-xl flex-col overflow-hidden rounded-xl border border-surface-border bg-surface shadow-lift focus:outline-none rtl:translate-x-1/2 ltr:-translate-x-1/2"
        >
          <Dialog.Title className="sr-only">חיפוש מהיר</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-surface-border px-4">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={commands[active] ? optionId(active) : undefined}
              aria-label="חיפוש עמודים, פעולות ולידים"
              placeholder="חיפוש עמוד, פעולה או ליד (שם, טלפון, אימייל)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, commands.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  run(commands[active]);
                }
              }}
              className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <kbd className="rounded border border-surface-border px-1.5 py-0.5 text-[11px] text-ink-muted">
              Esc
            </kbd>
          </div>
          <div id={listId} role="listbox" aria-label="תוצאות" className="overflow-y-auto p-2">
            {commands.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-ink-muted">
                {leads.isFetching ? 'מחפשים…' : 'לא נמצאו תוצאות'}
              </p>
            )}
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} role="group" aria-label={group} className="mb-1">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-ink-subtle">{group}</p>
                {items.map((c) => {
                  const i = commands.indexOf(c);
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(c)}
                      className={cn(
                        'flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm',
                        i === active ? 'bg-surface-sunken text-ink' : 'text-ink-muted',
                      )}
                    >
                      <Icon aria-hidden className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-ink">{c.label}</span>
                      {c.hint && (
                        <bdi dir="ltr" className="text-xs text-ink-subtle">
                          {c.hint}
                        </bdi>
                      )}
                      {i === active && (
                        <CornerDownLeft aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
