import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessDetailsSchema,
  can,
  defaultOpeningHours,
  formatIsraeliPhone,
  INDUSTRIES,
  industryLabels,
  LANGUAGES,
  languageLabels,
  openingHoursSchema,
  type BusinessDetails,
  type OpeningHours,
} from '@simplecatch/shared';
import { Building2, Clock, CreditCard, MapPin, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  browserCountry,
  Button,
  Card,
  CollapseButton,
  Field,
  PhoneField,
  Select,
  ScrollTabs,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { useCollapsed } from '../../lib/useCollapsed';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { useUpdateBusiness } from '../businesses/api';
import { HoursFields } from '../businesses/HoursFields';
import { ServiceAreasEditor } from '../businesses/ServiceAreasEditor';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { tr } from '../../i18n';
import { ChannelsSection } from './ChannelsSection';
import { LeadFieldsSection } from './LeadFieldsSection';

const industryOptions = INDUSTRIES.map((value) => ({ value, label: tr(industryLabels[value]) }));

export function Section({
  title,
  description,
  icon: Icon,
  tone,
  id,
  collapseKey,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  /** The icon tile's colour (D-141). */
  tone: string;
  /** For a link that scrolls to this card. */
  id?: string;
  /** Gives the card a fold button, remembered in the browser under this key. */
  collapseKey?: string;
  children: ReactNode;
}) {
  const [folded, toggle] = useCollapsed(collapseKey ?? 'unused');
  const collapsed = collapseKey !== undefined && folded;
  return (
    <Card id={id} className="flex scroll-mt-4 flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
            tone,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {collapseKey !== undefined && (
          <CollapseButton
            collapsed={collapsed}
            onToggle={toggle}
            controls={`${collapseKey}-body`}
            label={title}
          />
        )}
      </div>
      {/* Hidden, not removed: what was typed and not yet saved stays. */}
      <div
        id={collapseKey ? `${collapseKey}-body` : undefined}
        hidden={collapsed}
        className="flex flex-col gap-5"
      >
        {children}
      </div>
    </Card>
  );
}

const TABS = ['details', 'channels', 'fields', 'billing'] as const;
type Tab = (typeof TABS)[number];

/** Save feedback for one section: success is announced politely, errors as an alert. */
function SaveStatus({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) return <Alert tone="danger">{error}</Alert>;
  return (
    <p role="status" className="text-sm text-success-600">
      {saved ? tr('השינויים נשמרו') : ''}
    </p>
  );
}

/** Settings in short parts, one at a time (D-141); the tab is kept in the address (`?tab=`). */
export function SettingsPage() {
  const business = useCurrentBusiness();
  const canEdit = can(business.role, 'business.update');
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  // Service areas and opening hours used to be tabs of their own: old links land on their cards.
  const scrollTo = asked === 'hours' || asked === 'areas' ? `settings-${asked}` : null;
  const tab: Tab = (TABS as readonly string[]).includes(asked ?? '') ? (asked as Tab) : 'details';
  useEffect(() => {
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView?.({ block: 'start' });
  }, [scrollTo]);
  const labels: Record<Tab, string> = {
    details: tr('פרטי העסק'),
    channels: tr('ערוצים'),
    fields: tr('שדות לידים'),
    billing: tr('מנוי וחיוב'),
  };

  return (
    <>
      <PageHeader
        title={tr('הגדרות וחיוב')}
        description={tr('פרטי העסק כפי שיוצגו ללקוחות באתר ובפניות.')}
      />
      {/* Lead fields have their own permission (managers too) and their own no-permission state. */}
      {!canEdit && tab !== 'fields' && (
        <Alert tone="info">{tr('רק בעל/ת העסק יכול/ה לשנות את ההגדרות. אפשר לצפות בפרטים.')}</Alert>
      )}
      <ScrollTabs
        label={tr('חלקי ההגדרות')}
        activeKey={tab}
        className="border-b border-surface-border"
      >
        {TABS.map((t) => (
          <button
            key={t}
            id={`settings-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`settings-panel-${t}`}
            onClick={() => setParams(t === 'details' ? {} : { tab: t }, { replace: true })}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {labels[t]}
          </button>
        ))}
      </ScrollTabs>
      <div
        id={`settings-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="max-w-3xl"
      >
        {tab === 'details' && (
          // One tab for what the business is: its details, when it is open, where it works.
          <div className="flex flex-col gap-5">
            <DetailsSection canEdit={canEdit} collapsible />
            <HoursSection canEdit={canEdit} collapsible />
            <ServiceAreasSection canEdit={canEdit} collapsible />
          </div>
        )}
        {tab === 'channels' && <ChannelsSection canEdit={canEdit} />}
        {tab === 'fields' && <LeadFieldsSection />}
        {tab === 'billing' && (
          <Section title={tr('מנוי וחיוב')} icon={CreditCard} tone="bg-violet-500">
            <p className="text-sm text-ink-muted">
              {tr(
                'בחירת מסלול, אמצעי תשלום וחשבוניות יתווספו בהמשך. בינתיים החשבון פעיל בתקופת ניסיון.',
              )}
            </p>
          </Section>
        )}
      </div>
    </>
  );
}

export function DetailsSection({
  canEdit,
  collapsible = false,
}: {
  canEdit: boolean;
  /** A fold button on the card (the settings tab); the pop-up beside the site editor has none. */
  collapsible?: boolean;
}) {
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
      language: business.language,
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
    <Section
      title={tr('פרטי העסק')}
      icon={Building2}
      tone="bg-sky-500"
      id="settings-details"
      collapseKey={collapsible ? 'settings-details' : undefined}
    >
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
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <PhoneField
                label={tr('טלפון העסק')}
                required
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                defaultCountry={browserCountry()}
                error={errors.phone?.message}
              />
            )}
          />
          <Field
            label={tr('כתובת')}
            error={errors.address?.message}
            {...form.register('address')}
          />
          <Select
            label={tr('שפת הלקוחות')}
            hint={tr('ההודעות בוואטסאפ, המיילים ללקוחות ואתר חדש יהיו בשפה הזו.')}
            options={LANGUAGES.map((value) => ({ value, label: languageLabels[value] }))}
            {...form.register('language')}
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

export function ServiceAreasSection({
  canEdit,
  collapsible = false,
}: {
  canEdit: boolean;
  collapsible?: boolean;
}) {
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
    <Section
      title={tr('אזורי שירות')}
      description={tr('הערים או האזורים שבהם העסק נותן שירות.')}
      icon={MapPin}
      tone="bg-emerald-500"
      id="settings-areas"
      collapseKey={collapsible ? 'settings-areas' : undefined}
    >
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

export function HoursSection({
  canEdit,
  collapsible = false,
}: {
  canEdit: boolean;
  collapsible?: boolean;
}) {
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
    <Section
      title={tr('שעות פעילות')}
      description={tr('מופיעות באתר, ומהן נקבעות השעות שמוצעות לתורים.')}
      icon={Clock}
      tone="bg-amber-500"
      id="settings-hours"
      collapseKey={collapsible ? 'settings-hours' : undefined}
    >
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
