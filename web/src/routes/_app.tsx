import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '@/app/shell/app-shell';
import { RpcError } from '@/lib/rpc/rpc-error';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearToken, getToken } from '@/modules/auth/session';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    if (!getToken()) throw redirect({ to: '/login' });
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHENTICATED') {
        clearToken();
        context.queryClient.clear();
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
  component: AppShell,
});
