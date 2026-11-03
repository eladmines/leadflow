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
}

/** Navigation map, in the order of the UX spec (doc 03). */
export const navItems: NavItem[] = [
  { segment: '', label: tr('דשבורד'), icon: LayoutDashboard },
  { segment: 'site', label: tr('האתר שלי'), icon: Globe },
  { segment: 'leads', label: tr('לקוחות ולידים'), icon: Users },
  // WhatsApp inbox of unclassified numbers (D-092); conversations with customers live on the lead.
  {
    segment: 'conversations',
    label: tr('שיחות'),
    icon: MessageCircle,
    permission: 'whatsapp.inbox',
  },
  { segment: 'tasks', label: tr('משימות'), icon: ListTodo },
  { segment: 'appointments', label: tr('תורים'), icon: CalendarDays },
  { segment: 'quotes', label: tr('הצעות מחיר'), icon: FileText },
  {
    segment: 'automations',
    label: tr('אוטומציות'),
    icon: Zap,
    comingSoon: {
      title: tr('אוטומציות בדרך'),
      description: tr(
        'תהליכים מוכנים עם הפעלה וכיבוי, למשל התראה על פנייה חדשה או משימת מעקב אחרי הצעה.',
      ),
    },
  },
  { segment: 'reports', label: tr('דוחות'), icon: ChartColumn, permission: 'reports.view' },
  { segment: 'team', label: tr('צוות'), icon: UsersRound, permission: 'members.view' },
  { segment: 'settings', label: tr('הגדרות וחיוב'), icon: Settings },
];
