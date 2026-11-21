import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppLayout } from '@/app/shell/app-layout';
import { ApiError } from '@/lib/api/api-error';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearSession, isAuthenticated } from '@/modules/auth/session';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
        clearSession();
        context.queryClient.clear();
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
  component: AppLayout,
});
