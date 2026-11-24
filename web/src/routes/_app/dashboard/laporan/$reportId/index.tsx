import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ReportView } from '@/modules/dashboard/components/report-view';
import { reportQueryOptions } from '@/modules/dashboard/report-queries';

export const Route = createFileRoute('/_app/dashboard/laporan/$reportId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(reportQueryOptions(params.reportId ?? '').queryKey)?.name ??
        'Laporan',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'manage'),
  // Laporan yang tak ada ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(reportQueryOptions(params.reportId)).catch(() => undefined),
  component: ReportDetailRoute,
});

function ReportDetailRoute() {
  const { reportId } = Route.useParams();
  const stack = useStackNavigation();
  return (
    <ReportView
      key={reportId}
      reportId={reportId}
      onBack={() => stack.pop({ to: '/dashboard/laporan' })}
      onEdit={() => stack.push({ to: '/dashboard/laporan/$reportId/edit', params: { reportId } })}
    />
  );
}
