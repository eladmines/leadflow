import type { Permission } from '@leadflow/shared';
import {
  CalendarDays,
  Crown,
  ChartColumn,
  FileText,
  Globe,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  Settings,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { tr } from '../../i18n';

export interface NavItem {
  /** Path segment under `/b/:businessId` ('' = dashboard). */
  segment: string;
  label: string;
  icon: LucideIcon;
  /** Hide the link when the role lacks this permission (the server still enforces it). */
  permission?: Permission;
  /** Not built yet: the route shows a "coming soon" state. */
  comingSoon?: { title: string; description: string };
  /** Sidebar section (D-114); the dashboard sits above the sections. */
  group?: NavGroup;
  /** The section's colour (D-137): its icon in the menu, and the tile by its page title. */
  color: { icon: string; tile: string };
}

export type NavGroup = 'sales' | 'operations' | 'management';
export const navGroupLabels: Record<NavGroup, string> = {
  sales: tr('שיווק ומכירות'),
  operations: tr('תפעול'),
  management: tr('ניהול'),
};

/** Navigation map, in the order of the UX spec (doc 03). */
export const navItems: NavItem[] = [
  {
    segment: '',
    color: { icon: 'text-brand-600', tile: 'bg-brand-600' },
    label: tr('דשבורד'),
    icon: LayoutDashboard,
  },
  {
    segment: 'site',
    color: { icon: 'text-sky-500', tile: 'bg-sky-500' },
    group: 'sales',
    label: tr('האתר שלי'),
    icon: Globe,
  },
  {
    segment: 'leads',
    color: { icon: 'text-violet-500', tile: 'bg-violet-500' },
    group: 'sales',
    label: tr('לידים'),
    icon: Users,
  },
  // Paying customers (D-163): people who bought, one row each.
  {
    segment: 'customers',
    color: { icon: 'text-amber-500', tile: 'bg-amber-500' },
    group: 'sales',
    label: tr('לקוחות'),
    icon: Crown,
  },
  // WhatsApp inbox of unclassified numbers (D-092); conversations with customers live on the lead.
  {
    segment: 'conversations',
    color: { icon: 'text-emerald-500', tile: 'bg-emerald-500' },
    group: 'sales',
    label: tr('שיחות'),
    icon: MessageCircle,
    permission: 'whatsapp.inbox',
  },
  {
    segment: 'tasks',
    color: { icon: 'text-amber-500', tile: 'bg-amber-500' },
    group: 'operations',
    label: tr('משימות'),
    icon: ListTodo,
  },
  {
    segment: 'appointments',
    color: { icon: 'text-rose-500', tile: 'bg-rose-500' },
    group: 'operations',
    label: tr('תורים'),
    icon: CalendarDays,
  },
  {
    segment: 'quotes',
    color: { icon: 'text-orange-500', tile: 'bg-orange-500' },
    group: 'operations',
    label: tr('הצעות מחיר'),
    icon: FileText,
  },
  {
    segment: 'automations',
    color: { icon: 'text-slate-400', tile: 'bg-slate-400' },
    group: 'operations',
    label: tr('אוטומציות'),
    icon: Zap,
    comingSoon: {
      title: tr('אוטומציות בדרך'),
      description: tr(
        'תהליכים מוכנים עם הפעלה וכיבוי, למשל התראה על פנייה חדשה או משימת מעקב אחרי הצעה.',
      ),
    },
  },
  {
    segment: 'reports',
    color: { icon: 'text-indigo-500', tile: 'bg-indigo-500' },
    group: 'management',
    label: tr('דוחות'),
    icon: ChartColumn,
    permission: 'reports.view',
  },
  {
    segment: 'team',
    color: { icon: 'text-teal-500', tile: 'bg-teal-500' },
    group: 'management',
    label: tr('צוות'),
    icon: UsersRound,
    permission: 'members.view',
  },
  {
    segment: 'settings',
    color: { icon: 'text-slate-500', tile: 'bg-slate-500' },
    group: 'management',
    label: tr('הגדרות וחיוב'),
    icon: Settings,
  },
];

/** The menu item of a path under `/b/:businessId/…` (the dashboard for the business home). */
export function navItemOf(pathname: string): NavItem | undefined {
  const m = /^\/b\/[^/]+(?:\/([^/]+))?/.exec(pathname);
  if (!m) return undefined;
  return navItems.find((i) => i.segment === (m[1] ?? ''));
}
