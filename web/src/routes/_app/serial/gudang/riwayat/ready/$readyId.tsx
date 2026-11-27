import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { formatDay } from '@/modules/serial/lib/labels';
import { ReadyDetailPage } from '@/modules/serialwh/components/ready-detail-page';
import { warehouseReadyQueryOptions } from '@/modules/serialwh/queries';

export const Route = createFileRoute('/_app/serial/gudang/riwayat/ready/$readyId')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const ready = queryClient.getQueryData(
        warehouseReadyQueryOptions(params.readyId ?? '').queryKey,
      );
      // Induk "Ready" menaut ke tab Ready Riwayat Gudang (butir menu menaut ke tab bawaan Keluar ke SO).
      return [
        { label: 'Ready', to: '/serial/gudang/riwayat', search: { tab: 'ready' } },
        { label: ready ? formatDay(ready.dispatchedOn) : 'Detail' },
      ];
    },
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'view'),
  // Catatan yang tak ada atau di luar hak baca ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(warehouseReadyQueryOptions(params.readyId))
      .catch(() => undefined),
  component: ReadyDetailRoute,
});

function ReadyDetailRoute() {
  const { readyId } = Route.useParams();
  return <ReadyDetailPage key={readyId} readyId={readyId} />;
}
