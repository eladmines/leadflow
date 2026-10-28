import {
  businessWebPaths,
  DEFAULT_VAT_RATE,
  formatAgorot,
  quoteStatusLabels,
  quoteTotals,
  type Quote,
  type UpsertQuoteRequest,
} from '@leadflow/shared';
import { ArrowRight, Copy, ExternalLink, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DialogShell,
  Field,
  Spinner,
  Textarea,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useLeadDetail } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import {
  dateFmt,
  displayStatus,
  fromAgorot,
  quoteStatusTone,
  toAgorot,
  useCreateQuote,
  useDecideQuote,
  useDeleteQuote,
  useDuplicateQuote,
  useQuote,
  useSaveQuote,
  useSendQuote,
} from './api';

interface Line {
  description: string;
  quantity: string;
  price: string; // shekels as typed
}
const emptyLine: Line = { description: '', quantity: '1', price: '' };

/** WhatsApp "click to chat" with the quote link prefilled (opens the owner's WhatsApp). */
const waLink = (phone: string | null, text: string) =>
  `https://wa.me/${(phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** F18: create or edit a quote (drafts only), send it, and record the outcome. */
export function QuoteEditorPage() {
  const business = useCurrentBusiness();
  const navigate = useNavigate();
  const { quoteId = 'new' } = useParams();
  const [params] = useSearchParams();
  const isNew = quoteId === 'new';
  const existing = useQuote(business.id, isNew ? null : quoteId);
  const leadId = isNew ? (params.get('leadId') ?? '') : (existing.data?.lead.id ?? '');
  const lead = useLeadDetail(business.id, leadId);

  const create = useCreateQuote(business.id);
  const save = useSaveQuote(business.id);
  const duplicate = useDuplicateQuote(business.id);
  const decide = useDecideQuote(business.id);
  const remove = useDeleteQuote(business.id);

  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [discount, setDiscount] = useState('');
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [validUntil, setValidUntil] = useState(() =>
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sendOpen, setSendOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const q = existing.data;
  useEffect(() => {
    if (!q) return;
    setTitle(q.title);
    setLines(
      q.items.map((i) => ({
        description: i.description,
        quantity: String(i.quantity),
        price: fromAgorot(i.unitPrice),
      })),
    );
    setDiscount(q.discount ? fromAgorot(q.discount) : '');
    setVatRate(q.vatRate);
    setValidUntil(q.validUntil ?? '');
    setNotes(q.notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id]);

  const editable = isNew || q?.status === 'DRAFT';
  const items = lines.map((l) => ({
    description: l.description,
    quantity: Math.max(1, Math.round(Number(l.quantity) || 0)),
    unitPrice: toAgorot(l.price) ?? 0,
  }));
  const totals = quoteTotals(items, toAgorot(discount) ?? 0, vatRate);
  const payload: UpsertQuoteRequest = {
    title,
    items,
    discount: toAgorot(discount) ?? 0,
    vatRate,
    notes,
    validUntil: validUntil || null,
  };
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setErrors({});
    try {
      if (isNew) {
        const res = await create.mutateAsync({ ...payload, leadId });
        navigate(`${businessWebPaths.section(business.id, 'quotes')}/${res!.quote.id}`, {
          replace: true,
        });
      } else {
        await save.mutateAsync({ ...payload, id: quoteId });
        setSavedAt(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      return false;
    }
  };

  if (!isNew && existing.isPending) return <Spinner label="טוענים את ההצעה…" />;
  if (!isNew && existing.isError)
    return <Alert tone="danger">{errorMessage(existing.error)}</Alert>;
  if (isNew && !leadId) {
    return <Alert tone="info">כדי ליצור הצעת מחיר, פתחו ליד ובחרו "הצעת מחיר חדשה".</Alert>;
  }
  const status = q ? displayStatus(q) : 'DRAFT';
  const customer = lead.data?.lead.contact ?? q?.customer;
  const mutationError =
    create.error ?? save.error ?? decide.error ?? duplicate.error ?? remove.error;

  return (
    <>
      <Link
        to={businessWebPaths.section(business.id, 'quotes')}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowRight aria-hidden className="h-4 w-4" />
        כל ההצעות
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">
              {q ? `הצעת מחיר מס׳ ${q.number}` : 'הצעת מחיר חדשה'}
            </h1>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                quoteStatusTone[status],
              )}
            >
              {quoteStatusLabels[status]}
            </span>
          </div>
          {customer && (
            <p className="text-sm text-ink-muted">
              עבור{' '}
              <Link
                to={`${businessWebPaths.section(business.id, 'leads')}/${leadId}`}
                className="font-medium text-ink hover:underline"
              >
                {customer.name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              {q && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    remove.mutate(q.id, {
                      onSuccess: () => navigate(businessWebPaths.section(business.id, 'quotes')),
                    })
                  }
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                  מחיקת הטיוטה
                </Button>
              )}
              <Button
                variant="secondary"
                loading={create.isPending || save.isPending}
                onClick={() => void submit()}
              >
                {isNew ? 'שמירה כטיוטה' : 'שמירה'}
              </Button>
              {q && (
                <Button
                  onClick={async () => {
                    if (await submit()) setSendOpen(true);
                  }}
                >
                  שליחה ללקוח
                </Button>
              )}
            </>
          ) : (
            q && (
              <>
                <Button
                  variant="secondary"
                  loading={duplicate.isPending}
                  onClick={() =>
                    duplicate.mutate(q.id, {
                      onSuccess: (res) =>
                        navigate(
                          `${businessWebPaths.section(business.id, 'quotes')}/${res!.quote.id}`,
                        ),
                    })
                  }
                >
                  <Copy aria-hidden className="h-4 w-4" />
                  שכפול לעריכה
                </Button>
                {q.status === 'SENT' && (
                  <>
                    <Button variant="secondary" onClick={() => setSendOpen(true)}>
                      שליחה שוב
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => decide.mutate({ id: q.id, status: 'REJECTED' })}
                    >
                      סימון כנדחתה
                    </Button>
                    <Button onClick={() => decide.mutate({ id: q.id, status: 'ACCEPTED' })}>
                      סימון כאושרה
                    </Button>
                  </>
                )}
              </>
            )
          )}
        </div>
      </div>

      {mutationError && !(mutationError instanceof ApiError && mutationError.fields) && (
        <Alert tone="danger">{errorMessage(mutationError)}</Alert>
      )}
      {savedAt && editable && (
        <p role="status" className="text-sm text-success-600">
          נשמר ב־{savedAt}
        </p>
      )}
      {q?.publicUrl && (
        <Card className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-sm text-ink-muted">קישור ללקוח:</span>
          <a
            href={q.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            פתיחת עמוד ההצעה
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
          {q.sentAt && (
            <span className="text-xs text-ink-muted">
              נשלחה ב־{dateFmt.format(new Date(q.sentAt))}
            </span>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        <Field
          label="כותרת (לא חובה)"
          placeholder="למשל: שיפוץ חדר רחצה"
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-start text-xs text-ink-muted">
              <tr>
                <th className="pb-2 text-start font-medium">תיאור</th>
                <th className="w-20 pb-2 text-start font-medium">כמות</th>
                <th className="w-28 pb-2 text-start font-medium">מחיר יחידה (₪)</th>
                <th className="w-28 pb-2 text-end font-medium">סה״כ</th>
                {editable && <th className="w-10" aria-label="פעולות" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-surface-border align-top">
                  <td className="py-2 pe-2">
                    <input
                      aria-label={`תיאור שורה ${i + 1}`}
                      value={l.description}
                      disabled={!editable}
                      maxLength={300}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      className={inputClasses(Boolean(errors[`items.${i}.description`]))}
                    />
                    {errors[`items.${i}.description`] && (
                      <p className="mt-1 text-xs text-danger-600">
                        {errors[`items.${i}.description`]}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pe-2">
                    <input
                      aria-label={`כמות שורה ${i + 1}`}
                      dir="ltr"
                      inputMode="numeric"
                      value={l.quantity}
                      disabled={!editable}
                      onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, '') })}
                      className={cn(inputClasses(false), 'text-end')}
                    />
                  </td>
                  <td className="py-2 pe-2">
                    <input
                      aria-label={`מחיר יחידה שורה ${i + 1}`}
                      dir="ltr"
                      inputMode="decimal"
                      value={l.price}
                      disabled={!editable}
                      onChange={(e) => setLine(i, { price: e.target.value.replace(/[^\d.]/g, '') })}
                      className={cn(inputClasses(false), 'text-end')}
                    />
                  </td>
                  <td className="py-2 pt-4 text-end tabular-nums text-ink">
                    {formatAgorot(items[i]!.quantity * items[i]!.unitPrice)}
                  </td>
                  {editable && (
                    <td className="py-2 ps-1 pt-3">
                      <button
                        type="button"
                        aria-label={`מחיקת שורה ${i + 1}`}
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken disabled:opacity-30"
                      >
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errors.items && <p className="text-xs text-danger-600">{errors.items}</p>}
        {editable && lines.length < 50 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}
          >
            <Plus aria-hidden className="h-4 w-4" />
            הוספת שורה
          </Button>
        )}

        <div className="grid gap-6 border-t border-surface-border pt-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="הנחה (₪)"
                ltr
                inputMode="decimal"
                value={discount}
                disabled={!editable}
                onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))}
                error={errors.discount}
              />
              <Field
                label="בתוקף עד"
                type="date"
                value={validUntil}
                disabled={!editable}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            <Checkbox
              label={`הוספת מע״מ (${DEFAULT_VAT_RATE}%)`}
              checked={vatRate > 0}
              disabled={!editable}
              onChange={(e) => setVatRate(e.target.checked ? DEFAULT_VAT_RATE : 0)}
            />
            <Textarea
              label="הערות ותנאים"
              rows={3}
              value={notes}
              disabled={!editable}
              onChange={(e) => setNotes(e.target.value)}
              error={errors.notes}
            />
          </div>
          <dl
            aria-label="סיכום"
            className="flex flex-col gap-2 self-start rounded-xl bg-surface-muted p-4 text-sm"
          >
            <div className="flex justify-between">
              <dt className="text-ink-muted">סכום ביניים</dt>
              <dd className="tabular-nums">{formatAgorot(totals.subtotal)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">הנחה</dt>
                <dd className="tabular-nums">
                  <bdi dir="ltr">−{formatAgorot(totals.discount)}</bdi>
                </dd>
              </div>
            )}
            {vatRate > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">מע״מ {vatRate}%</dt>
                <dd className="tabular-nums">{formatAgorot(totals.vat)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-surface-border pt-2 text-base font-semibold text-ink">
              <dt>סה״כ לתשלום</dt>
              <dd className="tabular-nums">{formatAgorot(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {q && <SendDialog quote={q} open={sendOpen} onOpenChange={setSendOpen} />}
    </>
  );
}

function SendDialog({
  quote: q,
  open,
  onOpenChange,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const send = useSendQuote(business.id);
  const [email, setEmail] = useState(Boolean(q.customer.email));
  const [copied, setCopied] = useState(false);
  const sent = send.data?.quote ?? (q.publicUrl ? q : null);

  useEffect(() => {
    if (open) {
      send.reset();
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const message = (url: string) =>
    `שלום ${q.customer.name}, מצורפת הצעת המחיר מ${business.name} (סה״כ ${formatAgorot(q.totals.total)}): ${url}`;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="שליחת ההצעה ללקוח">
      {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
      {!send.isSuccess ? (
        <>
          <p className="text-sm text-ink-muted">
            הלקוח יקבל קישור פרטי לעמוד ההצעה, שבו אפשר לאשר או לדחות אותה ולהוריד אותה כ־PDF.
          </p>
          <Checkbox
            label={
              q.customer.email ? (
                <>
                  שליחה גם במייל ל־<bdi dir="ltr">{q.customer.email}</bdi>
                </>
              ) : (
                'ללקוח אין כתובת אימייל, אפשר לשלוח את הקישור ב־WhatsApp'
              )
            }
            checked={email}
            disabled={!q.customer.email}
            onChange={(e) => setEmail(e.target.checked)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button loading={send.isPending} onClick={() => send.mutate({ id: q.id, email })}>
              {q.status === 'DRAFT' ? 'שליחה' : 'שליחה שוב'}
            </Button>
          </div>
        </>
      ) : (
        sent?.publicUrl && (
          <>
            <Alert tone="success">
              ההצעה סומנה כנשלחה{email ? ' ונשלחה במייל' : ''}. אפשר גם לשלוח את הקישור ישירות:
            </Alert>
            <div className="flex flex-wrap gap-2">
              <a
                href={waLink(q.customer.phone, message(sent.publicUrl))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1f8f4e] px-3.5 text-sm font-medium text-white hover:bg-[#19773f]"
              >
                <MessageCircle aria-hidden className="h-4 w-4" />
                שליחה ב־WhatsApp
              </a>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(sent.publicUrl!);
                  setCopied(true);
                }}
              >
                <Copy aria-hidden className="h-4 w-4" />
                {copied ? 'הקישור הועתק' : 'העתקת הקישור'}
              </Button>
            </div>
          </>
        )
      )}
    </DialogShell>
  );
}
