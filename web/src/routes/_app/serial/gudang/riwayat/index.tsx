import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { OrdersPage } from '@/modules/serialwh/components/orders-page';
import { ordersSearchSchema } from '@/modules/serialwh/lib/orders-filter';

export const Route = createFileRoute('/_app/serial/gudang/riwayat/')({
  validateSearch: (search: Record<string, unknown>) => ordersSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'view'),
  component: OrdersRoute,
});

function OrdersRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <OrdersPage
      search={search}
      onSearchChange={(patch) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
    />
  );
}
