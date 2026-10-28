import { authWebPaths, businessWebPaths, INVITE_WEB_PATH } from '@leadflow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { RedirectIfAuthed, RequireAuth, RootRedirect } from '../features/auth/guards';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
import { AppEntry } from '../features/businesses/AppEntry';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { BusinessLayout } from '../features/shell/BusinessLayout';
import { ComingSoonPage } from '../features/shell/ComingSoonPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { AppointmentsPage } from '../features/appointments/AppointmentsPage';
import { navItems } from '../features/shell/nav';
import { LeadDetailPage } from '../features/leads/LeadDetailPage';
import { LeadsPage } from '../features/leads/LeadsPage';
import { SitePage } from '../features/site/SitePage';
import { AcceptInvitePage } from '../features/team/AcceptInvitePage';
import { AccountPage } from '../features/account/AccountPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { TeamPage } from '../features/team/TeamPage';
import { ContinueOnboardingPage, NewBusinessPage } from '../features/onboarding/OnboardingPage';
import { NotFoundPage } from './NotFoundPage';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
}

const queryClient = createQueryClient();

/** Opt in to React Router v7 behaviour now (also silences the upgrade warnings). */
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/** Route map (F01 card, D-025). Rendered inside a router, so tests can use MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route
        path={authWebPaths.login}
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path={authWebPaths.register}
        element={
          <RedirectIfAuthed>
            <RegisterPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path={authWebPaths.forgotPassword}
        element={
          <RedirectIfAuthed>
            <ForgotPasswordPage />
          </RedirectIfAuthed>
        }
      />
      <Route path={authWebPaths.resetPassword} element={<ResetPasswordPage />} />
      <Route path={authWebPaths.verifyEmail} element={<VerifyEmailPage />} />
      <Route path={INVITE_WEB_PATH} element={<AcceptInvitePage />} />
      <Route
        path={authWebPaths.appHome}
        element={
          <RequireAuth>
            <AppEntry />
          </RequireAuth>
        }
      />
      <Route
        path={businessWebPaths.onboarding}
        element={
          <RequireAuth>
            <NewBusinessPage />
          </RequireAuth>
        }
      />
      <Route
        path={businessWebPaths.onboardingFor(':businessId')}
        element={
          <RequireAuth>
            <ContinueOnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path={businessWebPaths.home(':businessId')}
        element={
          <RequireAuth>
            <BusinessLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        {navItems
          .filter((item) => item.comingSoon)
          .map((item) => (
            <Route
              key={item.segment}
              path={item.segment}
              element={<ComingSoonPage item={item} />}
            />
          ))}
        <Route path="site" element={<SitePage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:leadId" element={<LeadDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={routerFuture}>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
