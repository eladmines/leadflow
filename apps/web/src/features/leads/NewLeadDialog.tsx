import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildCustomFieldsSchema,
  businessWebPaths,
  can,
  createLeadCustomFieldsOptions,
  createLeadRequestSchema,
  formatIsraeliPhone,
  normalizePhone,
  splitPhone,
  type CreateLeadRequest,
  type Lead,
  type LeadFieldRule,
} from '@simplecatch/shared';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm, type Path, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  DialogShell,
  Field,
  PhoneField,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useCreateLead, useDuplicates, usePipeline } from './api';
import { tr } from '../../i18n';
import { CustomFieldInput } from '../leadFields/CustomFieldInput';
import { activeFields, useLeadFields } from '../leadFields/api';
import { toRaw } from '../leadFields/format';

/**
 * The shared create schema plus the business's custom fields (F34), checked with the same rules
 * as the server (`buildCustomFieldsSchema` with `createLeadCustomFieldsOptions`: the full dialog
 * enforces required fields, D-205). Errors land on `customFields.<fieldId>`, the API's key too.
 */
export function newLeadSchema(rules: readonly LeadFieldRule[]) {
  const custom = buildCustomFieldsSchema(rules, createLeadCustomFieldsOptions({}));
  return createLeadRequestSchema
    .superRefine((v, ctx) => {
      const r = custom.safeParse(v.customFields);
      if (r.success) return;
      for (const issue of r.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ['customFields', ...issue.path],
        });
      }
    })
    .transform((v) => ({ ...v, customFields: custom.parse(v.customFields) }));
}

/** Manual lead with a duplicate warning (same phone/email) before saving. */
export function NewLeadDialog({
  open,
  onOpenChange,
  onCreated,
  asCustomer = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Where to go once it is saved; the lead's page when not given. */
  onCreated?: (lead: Lead) => void;
  /** Adding a customer for a quote: worded as a customer, with just the contact and owner (the
   *  lead starts in the first stage, with no inquiry text). A quick path: no custom fields, and
   *  required ones are skipped (`skipRequiredCustomFields`, D-205). */
  asCustomer?: boolean;
}) {
  const business = useCurrentBusiness();
  const navigate = useNavigate();
  const create = useCreateLead(business.id);
  const stages = usePipeline(business.id);
  const canAssign = can(business.role, 'leads.assign');
  const members = useMembers(business.id, open && canAssign);
  const [formError, setFormError] = useState<string | null>(null);
  // The full dialog only: every definition (archived too) is a rule; the active ones are shown.
  const leadFields = useLeadFields(business.id, open && !asCustomer);
  const allFields = useMemo(
    () => (asCustomer ? [] : (leadFields.data ?? [])),
    [asCustomer, leadFields.data],
  );
  const shownFields = activeFields(allFields);
  const schema = useMemo(() => newLeadSchema(allFields), [allFields]);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const resolver: Resolver<CreateLeadRequest> = (values, context, options) =>
    zodResolver(schemaRef.current)(values, context, options);
  const form = useForm<CreateLeadRequest>({
    resolver,
    mode: 'onTouched',
    defaultValues: { name: '', phone: '', email: '', message: '', customFields: {} },
  });
  const { errors, isSubmitting } = form.formState;
  const customErrors = errors.customFields as
    Record<string, { message?: string } | undefined> | undefined;

  // Check duplicates once the phone/email look complete.
  const phone = form.watch('phone') ?? '';
  const email = form.watch('email') ?? '';
  const phoneE164 = normalizePhone(phone) ?? '';
  const emailOk = /^\S+@\S+\.\S+$/.test(email) ? email : '';
  const duplicates = useDuplicates(business.id, phoneE164, emailOk, open);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      form.reset();
      setFormError(null);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { lead } = await create.mutateAsync(
        asCustomer ? { ...values, skipRequiredCustomFields: true } : values,
      );
      close(false);
      if (onCreated) onCreated(lead);
      else navigate(`${businessWebPaths.section(business.id, 'leads')}/${lead.id}`);
    } catch (err) {
      setFormError(
        applyServerErrors(err, form.setError, [
          'name',
          'phone',
          'email',
          'message',
          'stageId',
          'ownerId',
          ...shownFields.map((f) => `customFields.${f.id}` as Path<CreateLeadRequest>),
        ]),
      );
    }
  });

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title={asCustomer ? tr('לקוח חדש') : tr('ליד חדש')}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field
          label={tr('שם')}
          required
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <PhoneField
                label={tr('טלפון')}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                defaultCountry={splitPhone(business.phone).country ?? 'IL'}
                error={errors.phone?.message}
              />
            )}
          />
          <Field
            label={tr('אימייל')}
            ltr
            type="email"
            error={errors.email?.message}
            {...form.register('email')}
          />
        </div>
        {duplicates.data && duplicates.data.length > 0 && (
          <Alert tone="warning" title={tr('כבר קיים איש קשר עם הפרטים האלה')}>
            <ul className="mt-1 list-disc ps-5">
              {duplicates.data.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.phone && (
                    <>
                      {' · '}
                      <bdi dir="ltr">{formatIsraeliPhone(c.phone)}</bdi>
                    </>
                  )}{' '}
                  ({c.leadCount} {tr('פניות)')}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              {tr('אפשר להמשיך: הליד החדש יתווסף לאותו איש קשר, וההיסטוריה תישמר.')}
            </p>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {!asCustomer && (
            <Select
              label={tr('שלב')}
              options={(stages.data ?? []).map((s) => ({ value: s.id, label: tr(s.name) }))}
              {...form.register('stageId', { setValueAs: (v: string) => v || undefined })}
            />
          )}
          {canAssign && (
            <Select
              label={tr('אחראי')}
              options={[
                { value: '', label: tr('ללא אחראי') },
                ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
              ]}
              error={errors.ownerId?.message}
              {...form.register('ownerId', { setValueAs: (v: string) => v || null })}
            />
          )}
        </div>
        {!asCustomer && (
          <Textarea
            label={tr('פרטי הפנייה')}
            rows={3}
            error={errors.message?.message}
            {...form.register('message')}
          />
        )}
        {asCustomer ? null : leadFields.isPending ? (
          <Spinner label={tr('טוענים את השדות…')} />
        ) : leadFields.isError ? (
          <Alert tone="warning">
            {tr('לא הצלחנו לטעון את השדות הנוספים. אפשר לנסות לשמור, או לסגור ולפתוח שוב.')}
          </Alert>
        ) : (
          shownFields.length > 0 && (
            <fieldset className="flex flex-col gap-4 border-t border-surface-border pt-4">
              <legend className="mb-3 text-sm font-semibold text-ink">{tr('פרטים נוספים')}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {shownFields.map((f) => (
                  <Controller
                    key={f.id}
                    control={form.control}
                    name={`customFields.${f.id}`}
                    // An empty value (never `undefined`, which the shared shape refuses).
                    defaultValue={f.type === 'boolean' ? false : ''}
                    render={({ field }) => (
                      <CustomFieldInput
                        id={`new-lead-cf-${f.id}`}
                        field={f}
                        value={toRaw(f, field.value)}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        error={customErrors?.[f.id]?.message}
                      />
                    )}
                  />
                ))}
              </div>
            </fieldset>
          )
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {tr('ביטול')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {asCustomer ? tr('הוספת לקוח') : tr('יצירת ליד')}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
