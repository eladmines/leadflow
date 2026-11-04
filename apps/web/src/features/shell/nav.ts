import type { Permission } from '@leadflow/shared';
import {
  CalendarDays,
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
  /** Colour of the item's icon tile (D-114). */
  tone: string;
}

export type NavGroup = 'sales' | 'operations' | 'management';
export const navGroupLabels: Record<NavGroup, string> = {
  sales: tr('שיווק ומכירות'),
  operations: tr('תפעול'),
  management: tr('ניהול'),
};

/** Navigation map, in the order of the UX spec (doc 03). */
export const navItems: NavItem[] = [
  { segment: '', tone: 'bg-brand-600', label: tr('דשבורד'), icon: LayoutDashboard },
  { segment: 'site', group: 'sales', tone: 'bg-sky-500', label: tr('האתר שלי'), icon: Globe },
  {
    segment: 'leads',
    group: 'sales',
    tone: 'bg-violet-500',
    label: tr('לקוחות ולידים'),
    icon: Users,
  },
  // WhatsApp inbox of unclassified numbers (D-092); conversations with customers live on the lead.
  {
    segment: 'conversations',
    group: 'sales',
    tone: 'bg-emerald-500',
    label: tr('שיחות'),
    icon: MessageCircle,
    permission: 'whatsapp.inbox',
  },
  {
    segment: 'tasks',
    group: 'operations',
    tone: 'bg-amber-500',
    label: tr('משימות'),
    icon: ListTodo,
  },
  {
    segment: 'appointments',
    group: 'operations',
    tone: 'bg-rose-500',
    label: tr('תורים'),
    icon: CalendarDays,
  },
  {
    segment: 'quotes',
    group: 'operations',
    tone: 'bg-orange-500',
    label: tr('הצעות מחיר'),
    icon: FileText,
  },
  {
    segment: 'automations',
    group: 'operations',
    tone: 'bg-slate-400',
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
    group: 'management',
    tone: 'bg-indigo-500',
    label: tr('דוחות'),
    icon: ChartColumn,
    permission: 'reports.view',
  },
  {
    segment: 'team',
    group: 'management',
    tone: 'bg-teal-500',
    label: tr('צוות'),
    icon: UsersRound,
    permission: 'members.view',
  },
  {
    segment: 'settings',
    group: 'management',
    tone: 'bg-slate-500',
    label: tr('הגדרות וחיוב'),
    icon: Settings,
  },
];
