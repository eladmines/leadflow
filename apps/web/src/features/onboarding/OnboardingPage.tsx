import { businessWebPaths, type Business } from '@leadflow/shared';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { SignedInHeader } from '../../components/SignedInHeader';
import { Alert, Card, FullPageSpinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../auth/serverErrors';
import { UnverifiedEmailBanner } from '../auth/UnverifiedEmailBanner';
import {
  useBusiness,
  useCompleteOnboarding,
  useCreateBusiness,
  useUpdateBusiness,
} from '../businesses/api';
import { BusinessNotFound } from '../businesses/BusinessNotFound';
import { StepBusiness } from './StepBusiness';
import { StepContact } from './StepContact';
import { StepHours } from './StepHours';
import { StepProgress } from './StepProgress';
import { StepServiceAreas } from './StepServiceAreas';

function WizardFrame({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SignedInHeader />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:py-10">
        <UnverifiedEmailBanner />
        <StepProgress step={step} />
        <Card>{children}</Card>
        <p className="text-center text-xs text-ink-muted">
          ההתקדמות נשמרת בכל מעבר שלב — אפשר לצאת ולחזור בכל זמן.
        </p>
      </main>
    </div>
  );
}

/** `/onboarding`: step 1 for a brand-new business. */
export function NewBusinessPage() {
  const navigate = useNavigate();
  const create = useCreateBusiness();
  return (
    <WizardFrame step={1}>
      <StepBusiness
        onSubmit={async (values) => {
          const { business } = await create.mutateAsync(values);
          navigate(businessWebPaths.onboardingFor(business.id), { replace: true });
        }}
      />
    </WizardFrame>
  );
}

/** `/onboarding/:businessId`: resumes at the saved step (AC-01). */
export function ContinueOnboardingPage() {
  const { businessId = '' } = useParams();
  const business = useBusiness(businessId);

  if (business.isPending) return <FullPageSpinner label="טוענים את פרטי העסק…" />;
  if (business.isError) {
    if (business.error instanceof ApiError && business.error.status === 404) {
      return <BusinessNotFound />;
    }
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="danger" title="לא הצלחנו לטעון את פרטי העסק">
          {errorMessage(business.error)}
        </Alert>
      </main>
    );
  }
  if (business.data.status !== 'ONBOARDING') {
    return <Navigate to={businessWebPaths.home(businessId)} replace />;
  }
  if (business.data.role !== 'OWNER') {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="info" title="העסק עדיין בהקמה">
          רק בעל/ת העסק יכול/ה להשלים את שלבי ההקמה. נסו שוב מאוחר יותר.
        </Alert>
      </main>
    );
  }
  // Remount when switching businesses so the step resets to the saved one.
  return <Wizard key={business.data.id} business={business.data} />;
}

function Wizard({ business }: { business: Business }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(Math.min(Math.max(business.onboardingStep, 1), 4));
  const update = useUpdateBusiness(business.id);
  const complete = useCompleteOnboarding(business.id);

  /** Saves and moves to `next`; the server remembers the step for resuming. */
  const save = async (body: Parameters<typeof update.mutateAsync>[0], next: number) => {
    await update.mutateAsync({ ...body, onboardingStep: next });
    setStep(next);
  };

  return (
    <WizardFrame step={step}>
      {step === 1 && <StepBusiness business={business} onSubmit={(v) => save(v, 2)} />}
      {step === 2 && (
        <StepContact business={business} onSubmit={(v) => save(v, 3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <StepServiceAreas
          business={business}
          onSubmit={(serviceAreas) => save({ serviceAreas }, 4)}
          onSkip={() => save({}, 4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <StepHours
          business={business}
          onBack={() => setStep(3)}
          onSubmit={async (openingHours) => {
            await update.mutateAsync({ openingHours });
            try {
              await complete.mutateAsync();
            } catch (err) {
              // A required field is missing (e.g. phone): send the user to the step that has it.
              if (err instanceof ApiError && err.fields?.phone) setStep(2);
              else if (err instanceof ApiError && (err.fields?.name || err.fields?.industry))
                setStep(1);
              throw err;
            }
            navigate(businessWebPaths.home(business.id), { replace: true });
          }}
        />
      )}
    </WizardFrame>
  );
}
