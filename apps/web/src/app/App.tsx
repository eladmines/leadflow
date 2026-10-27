import { authWebPaths } from '@leadflow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppHomePage } from '../features/app-home/AppHomePage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { RedirectIfAuthed, RequireAuth, RootRedirect } from '../features/auth/guards';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
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
      <Route
        path={authWebPaths.appHome}
        element={
          <RequireAuth>
            <AppHomePage />
          </RequireAuth>
        }
      />
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
