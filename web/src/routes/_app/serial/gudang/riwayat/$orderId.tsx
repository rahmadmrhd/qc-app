import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { OrderDetailPage } from '@/modules/serialwh/components/order-detail-page';
import { warehouseOrderQueryOptions } from '@/modules/serialwh/queries';

export const Route = createFileRoute('/_app/serial/gudang/riwayat/$orderId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(warehouseOrderQueryOptions(params.orderId ?? '').queryKey)
          ?.number ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'view'),
  // Catatan yang tak ada atau di luar hak baca ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(warehouseOrderQueryOptions(params.orderId))
      .catch(() => undefined),
  component: OrderDetailRoute,
});

function OrderDetailRoute() {
  const { orderId } = Route.useParams();
  return <OrderDetailPage key={orderId} orderId={orderId} />;
}
