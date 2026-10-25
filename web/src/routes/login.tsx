import { createFileRoute, redirect } from '@tanstack/react-router';
import { DevLoginLink } from '@/modules/auth/components/dev-login-link';
import { LoginPanel } from '@/modules/auth/components/login-panel';
import { getSession, isAuthenticated } from '@/modules/auth/session';
import { ThemeToggle } from '@/modules/theme/theme-toggle';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (isAuthenticated()) throw redirect({ to: '/' });
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
        {import.meta.env.DEV ? <DevLoginLink /> : null}
      </LoginPanel>
    </div>
  );
}
