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
  { segment: '', label: 'דשבורד', icon: LayoutDashboard },
  { segment: 'site', label: 'האתר שלי', icon: Globe },
  { segment: 'leads', label: 'לקוחות ולידים', icon: Users },
  {
    segment: 'conversations',
    label: 'שיחות',
    icon: MessageCircle,
    comingSoon: {
      title: 'תיבת שיחות WhatsApp בדרך',
      description:
        'חיבור מספר WhatsApp עסקי רשמי, תיבת שיחות משותפת לצוות, שיוך לעובד ומענה מתוך המערכת.',
    },
  },
  { segment: 'tasks', label: 'משימות', icon: ListTodo },
  {
    segment: 'appointments',
    label: 'תורים',
    icon: CalendarDays,
    comingSoon: {
      title: 'יומן ותורים בדרך',
      description: 'הגדרת שירותים וזמינות, יומן יומי ושבועי ובקשות תור מהאתר.',
    },
  },
  {
    segment: 'quotes',
    label: 'הצעות מחיר',
    icon: FileText,
    comingSoon: {
      title: 'הצעות מחיר בדרך',
      description: 'יצירת הצעת מחיר מתוך ליד, שליחה בקישור או PDF ומעקב אחרי הסטטוס.',
    },
  },
  {
    segment: 'automations',
    label: 'אוטומציות',
    icon: Zap,
    comingSoon: {
      title: 'אוטומציות בדרך',
      description:
        'תהליכים מוכנים עם הפעלה וכיבוי, למשל התראה על פנייה חדשה או משימת מעקב אחרי הצעה.',
    },
  },
  {
    segment: 'reports',
    label: 'דוחות',
    icon: ChartColumn,
    comingSoon: {
      title: 'דוחות בדרך',
      description: 'משפך לידים, מקורות הגעה, זמני תגובה ויחס סגירה.',
    },
  },
  { segment: 'team', label: 'צוות', icon: UsersRound, permission: 'members.view' },
  { segment: 'settings', label: 'הגדרות וחיוב', icon: Settings },
];
