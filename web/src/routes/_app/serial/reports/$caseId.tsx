import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { CaseDetailPage } from '@/modules/serial/components/case-detail-page';
import { serialCaseDetailQueryOptions } from '@/modules/serial/queries';

export const Route = createFileRoute('/_app/serial/reports/$caseId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(serialCaseDetailQueryOptions(params.caseId ?? '').queryKey)
          ?.number ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  // Laporan yang tak ada, terhapus, atau di luar hak baca ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(serialCaseDetailQueryOptions(params.caseId))
      .catch(() => undefined),
  component: CaseDetailRoute,
});

function CaseDetailRoute() {
  const { caseId } = Route.useParams();
  const stack = useStackNavigation();
  return (
    <CaseDetailPage
      key={caseId}
      caseId={caseId}
      onBack={() => stack.pop({ to: '/serial/reports' })}
    />
  );
}
