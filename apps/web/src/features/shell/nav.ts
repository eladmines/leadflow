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
    label: tr('דשבורד'),
    icon: LayoutDashboard,
  },
  {
    segment: 'site',
    group: 'sales',
    label: tr('האתר שלי'),
    icon: Globe,
  },
  {
    segment: 'leads',
    group: 'sales',
    label: tr('לקוחות ולידים'),
    icon: Users,
  },
  // WhatsApp inbox of unclassified numbers (D-092); conversations with customers live on the lead.
  {
    segment: 'conversations',
    group: 'sales',
    label: tr('שיחות'),
    icon: MessageCircle,
    permission: 'whatsapp.inbox',
  },
  {
    segment: 'tasks',
    group: 'operations',
    label: tr('משימות'),
    icon: ListTodo,
  },
  {
    segment: 'appointments',
    group: 'operations',
    label: tr('תורים'),
    icon: CalendarDays,
  },
  {
    segment: 'quotes',
    group: 'operations',
    label: tr('הצעות מחיר'),
    icon: FileText,
  },
  {
    segment: 'automations',
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
    group: 'management',
    label: tr('דוחות'),
    icon: ChartColumn,
    permission: 'reports.view',
  },
  {
    segment: 'team',
    group: 'management',
    label: tr('צוות'),
    icon: UsersRound,
    permission: 'members.view',
  },
  {
    segment: 'settings',
    group: 'management',
    label: tr('הגדרות וחיוב'),
    icon: Settings,
  },
];
