import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { DispatchDetailPage } from '@/modules/serialwh/components/dispatch-detail-page';
import { warehouseDispatchQueryOptions } from '@/modules/serialwh/queries';

export const Route = createFileRoute('/_app/serial/gudang/riwayat/$dispatchId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(warehouseDispatchQueryOptions(params.dispatchId ?? '').queryKey)
          ?.number ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'view'),
  // Pengeluaran yang tak ada atau di luar hak baca ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(warehouseDispatchQueryOptions(params.dispatchId))
      .catch(() => undefined),
  component: DispatchDetailRoute,
});

function DispatchDetailRoute() {
  const { dispatchId } = Route.useParams();
  return <DispatchDetailPage key={dispatchId} dispatchId={dispatchId} />;
}
