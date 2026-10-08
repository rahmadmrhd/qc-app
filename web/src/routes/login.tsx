import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoginPanel } from '@/modules/auth/components/login-panel';
import { getSession, getToken } from '@/modules/auth/session';
import { ThemeToggle } from '@/modules/theme/theme-toggle';

const DevLoginPicker = import.meta.env.DEV
  ? lazy(() => import('@/modules/auth/components/dev-login-picker'))
  : null;

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (getToken()) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

function LoginPage() {
  const session = getSession();
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <LoginPanel
        loginUrl={session.loginUrl}
        authError={session.authError}
        authErrorEmail={session.authErrorEmail}
      >
        {DevLoginPicker ? (
          <Suspense fallback={null}>
            <DevLoginPicker />
          </Suspense>
        ) : null}
      </LoginPanel>
    </div>
  );
}
