import { businessWebPaths } from '@simplecatch/shared';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { buttonClasses, DialogShell } from '../../components/ui';
import { tr } from '../../i18n';

/** What the server says when a lead is moved to "Quote sent" before a quote was sent to it. */
const QUOTE_NEEDED = 'כדי להעביר ל"הצעה נשלחה" צריך קודם ליצור ולשלוח הצעת מחיר לליד';

export const isQuoteNeeded = (err: unknown): boolean =>
  err instanceof ApiError && err.fields?.stageId === QUOTE_NEEDED;

/**
 * "Quote sent" means a quote went out. Moving a lead there without one does not fail with an
 * error: this offers to write the quote (sending it moves the lead by itself).
 */
export function QuoteNeededDialog({
  businessId,
  lead,
  onClose,
}: {
  businessId: string;
  lead: { id: string; contact: { name: string } } | null;
  onClose: () => void;
}) {
  return (
    <DialogShell
      open={lead !== null}
      onOpenChange={(open) => !open && onClose()}
      title={tr('קודם יוצרים הצעת מחיר')}
    >
      <p className="text-sm text-ink-muted">
        {tr(
          'כדי להעביר את {0} ל"הצעה נשלחה" צריך קודם ליצור ולשלוח לו הצעת מחיר. אחרי השליחה הוא יעבור לשלב הזה בעצמו.',
          lead?.contact.name ?? '',
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonClasses('secondary', 'md')}>
          {tr('ביטול')}
        </button>
        {lead && (
          <Link
            to={`${businessWebPaths.section(businessId, 'quotes')}/new?leadId=${lead.id}`}
            className={buttonClasses('primary', 'md')}
          >
            {tr('יצירת הצעת מחיר')}
          </Link>
        )}
      </div>
    </DialogShell>
  );
}
