import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { requirePermission } from '@/modules/auth/permissions';
import { FilesPage } from '@/modules/countrylock-admin/components/files-page';
import { filesQueryOptions } from '@/modules/countrylock-admin/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/countrylock/files/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(filesQueryOptions()),
  component: FilesRoute,
});

function FilesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <FilesPage
      q={search.q ?? ''}
      onSearchChange={(patch) =>
        void navigate({
          search: (prev) => ({ ...prev, ...('q' in patch ? { q: patch.q } : {}) }),
          replace: true,
        })
      }
    />
  );
}
