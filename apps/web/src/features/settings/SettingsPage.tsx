import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessDetailsSchema,
  can,
  defaultOpeningHours,
  formatIsraeliPhone,
  INDUSTRIES,
  industryLabels,
  openingHoursSchema,
  type BusinessDetails,
  type OpeningHours,
} from '@leadflow/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Card, Field, Select } from '../../components/ui';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { useUpdateBusiness } from '../businesses/api';
import { HoursFields } from '../businesses/HoursFields';
import { ServiceAreasEditor } from '../businesses/ServiceAreasEditor';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { tr } from '../../i18n';

const industryOptions = INDUSTRIES.map((value) => ({ value, label: tr(industryLabels[value]) }));

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Save feedback for one section: success is announced politely, errors as an alert. */
function SaveStatus({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) return <Alert tone="danger">{error}</Alert>;
  return (
    <p role="status" className="text-sm text-success-600">
      {saved ? tr('השינויים נשמרו') : ''}
    </p>
  );
}

export function SettingsPage() {
  const business = useCurrentBusiness();
  const canEdit = can(business.role, 'business.update');

  return (
    <>
      <PageHeader
        title={tr('הגדרות וחיוב')}
        description={tr('פרטי העסק כפי שיוצגו ללקוחות באתר ובפניות.')}
      />
      {!canEdit && (
        <Alert tone="info">{tr('רק בעל/ת העסק יכול/ה לשנות את ההגדרות. אפשר לצפות בפרטים.')}</Alert>
      )}
      <DetailsSection canEdit={canEdit} />
      <ServiceAreasSection canEdit={canEdit} />
      <HoursSection canEdit={canEdit} />
      <Section title={tr('מנוי וחיוב')}>
        <p className="text-sm text-ink-muted">
          {tr(
            'בחירת מסלול, אמצעי תשלום וחשבוניות יתווספו בהמשך. בינתיים החשבון פעיל בתקופת ניסיון.',
          )}
        </p>
      </Section>
    </>
  );
}

export function DetailsSection({ canEdit }: { canEdit: boolean }) {
  const business = useCurrentBusiness();
  const update = useUpdateBusiness(business.id);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BusinessDetails>({
    resolver: zodResolver(businessDetailsSchema),
    mode: 'onTouched',
    defaultValues: {
      name: business.name,
      industry: business.industry,
      phone: business.phone ? formatIsraeliPhone(business.phone) : '',
      address: business.address ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    try {
      await update.mutateAsync(values);
      setSaved(true);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['name', 'industry', 'phone', 'address']));
    }
  });

  return (
    <Section title={tr('פרטי העסק')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr('שם העסק')}
            required
            error={errors.name?.message}
            {...form.register('name')}
          />
          <Select
            label={tr('תחום פעילות')}
            required
            options={industryOptions}
            error={errors.industry?.message}
            {...form.register('industry')}
          />
          <Field
            label={tr('טלפון העסק')}
            required
            ltr
            type="tel"
            inputMode="tel"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
          <Field
            label={tr('כתובת')}
            error={errors.address?.message}
            {...form.register('address')}
          />
        </fieldset>
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SaveStatus saved={saved} error={formError} />
            <Button type="submit" loading={isSubmitting}>
              {tr('שמירת הפרטים')}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

export function ServiceAreasSection({ canEdit }: { canEdit: boolean }) {
  const business = useCurrentBusiness();
  const update = useUpdateBusiness(business.id);
  const [areas, setAreas] = useState(business.serviceAreas);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(null);
    try {
      await update.mutateAsync({ serviceAreas: areas });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Section title={tr('אזורי שירות')} description={tr('הערים או האזורים שבהם העסק נותן שירות.')}>
      {canEdit ? (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <ServiceAreasEditor value={areas} onChange={setAreas} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SaveStatus saved={saved} error={error} />
            <Button type="submit" loading={update.isPending}>
              {tr('שמירת האזורים')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink">{areas.length ? areas.join(', ') : tr('לא הוגדרו')}</p>
      )}
    </Section>
  );
}

export function HoursSection({ canEdit }: { canEdit: boolean }) {
  const business = useCurrentBusiness();
  const update = useUpdateBusiness(business.id);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<OpeningHours>({
    resolver: zodResolver(openingHoursSchema),
    mode: 'onTouched',
    defaultValues: business.openingHours ?? defaultOpeningHours,
  });

  const submit = form.handleSubmit(async (openingHours) => {
    setSaved(false);
    setError(null);
    try {
      await update.mutateAsync({ openingHours });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Section title={tr('שעות פעילות')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <HoursFields form={form} disabled={!canEdit} />
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SaveStatus saved={saved} error={error} />
            <Button type="submit" loading={form.formState.isSubmitting}>
              {tr('שמירת השעות')}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}
