import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { requirePermission } from '@/modules/auth/permissions';
import { SharesPage } from '@/modules/dashboard/components/shares-page';
import { sharesQueryOptions } from '@/modules/dashboard/share-queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['active', 'expired', 'revoked']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/dashboard/tautan/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(sharesQueryOptions()),
  component: SharesRoute,
});

function SharesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <SharesPage
      q={search.q ?? ''}
      status={search.status ?? 'all'}
      onSearchChange={(patch) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            ...('q' in patch ? { q: patch.q } : {}),
            ...('status' in patch
              ? { status: patch.status === 'all' ? undefined : patch.status }
              : {}),
          }),
          replace: true,
        })
      }
    />
  );
}
