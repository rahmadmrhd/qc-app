import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { UiUpdateBanner } from '@/app/shell/ui-update-banner';
import { isDesktop } from '@/lib/platform';
import { completeDesktopLogin } from '@/modules/auth/complete-desktop-login';
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
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute inset-x-0 top-0">
        <UiUpdateBanner />
      </div>
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <LoginPanel
        loginUrl={session.loginUrl}
        authError={session.authError}
        authErrorEmail={session.authErrorEmail}
        serverUnreachable={session.serverUnreachable}
        onDesktopSignedIn={(me) =>
          void completeDesktopLogin(me, {
            queryClient,
            navigate: (options) => router.navigate(options),
          })
        }
      >
        {/* `/auth/dev-login` tidak diteruskan proksi desktop. */}
        {import.meta.env.DEV && !isDesktop() ? <DevLoginLink /> : null}
      </LoginPanel>
    </div>
  );
}
