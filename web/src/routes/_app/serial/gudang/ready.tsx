import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { ReadyStockPage } from '@/modules/serialwh/components/ready-stock-page';
import { parseReadyStockFilter } from '@/modules/serialwh/lib/ready-stock-filter';

export const Route = createFileRoute('/_app/serial/gudang/ready')({
  validateSearch: (search: Record<string, unknown>) => parseReadyStockFilter(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'view'),
  component: ReadyStockRoute,
});

function ReadyStockRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ReadyStockPage
      search={search}
      onSearchChange={(patch) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
    />
  );
}
