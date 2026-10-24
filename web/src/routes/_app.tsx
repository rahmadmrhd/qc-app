import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '@/app/shell/app-shell';
import { RpcError } from '@/lib/rpc/rpc-error';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearSession, isAuthenticated } from '@/modules/auth/session';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHENTICATED') {
        clearSession();
        context.queryClient.clear();
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
  component: AppShell,
});
