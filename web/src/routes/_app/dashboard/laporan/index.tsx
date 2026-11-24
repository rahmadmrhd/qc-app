import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportsPage } from '@/modules/dashboard/components/reports-page';
import { reportsQueryOptions } from '@/modules/dashboard/report-queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  state: z.enum(['active', 'paused']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/dashboard/laporan/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQueryOptions()),
  component: ReportsRoute,
});

function ReportsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ReportsPage
      q={search.q ?? ''}
      state={search.state ?? 'all'}
      onSearchChange={(patch) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            ...('q' in patch ? { q: patch.q } : {}),
            ...('state' in patch ? { state: patch.state === 'all' ? undefined : patch.state } : {}),
          }),
          replace: true,
        })
      }
    />
  );
}
