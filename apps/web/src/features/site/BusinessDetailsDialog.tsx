import { DialogShell } from '../../components/ui';
import { DetailsSection, HoursSection, ServiceAreasSection } from '../settings/SettingsPage';

/**
 * Phone, address, opening hours and service areas belong to the business profile, so the site,
 * the mobile call bar and notification emails all stay in sync. The editor edits them here
 * instead of sending the owner to Settings (D-075).
 */
export function BusinessDetailsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="פרטי העסק">
      <p className="rounded-lg bg-warning-50 px-3 py-2.5 text-sm text-warning-600">
        הפרטים האלה משותפים לכל המערכת: שינוי כאן יתעדכן באתר, בכפתור החיוג ובהתראות במייל.
      </p>
      <DetailsSection canEdit />
      <ServiceAreasSection canEdit />
      <HoursSection canEdit />
    </DialogShell>
  );
}
