import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { SerialDetailPage } from '@/modules/serial/components/serial-detail-page';
import { serialDetailQueryOptions } from '@/modules/serial/queries';

export const Route = createFileRoute('/_app/serial/$serialId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(serialDetailQueryOptions(params.serialId ?? '').queryKey)?.serial
          .serial ?? 'Detail',
    }),
  },
  // `case` = id laporan yang dibuka di tab linimasa (dari daftar Laporan atau tautan "sudah ada laporan aktif").
  validateSearch: (search: Record<string, unknown>): { case?: string } =>
    typeof search.case === 'string' && search.case !== '' ? { case: search.case } : {},
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(serialDetailQueryOptions(params.serialId)),
  component: SerialDetailRoute,
});

function SerialDetailRoute() {
  const { serialId } = Route.useParams();
  const { case: caseId } = Route.useSearch();
  const navigate = useNavigate();
  const stack = useStackNavigation();
  return (
    <SerialDetailPage
      key={serialId}
      serialId={serialId}
      {...(caseId ? { caseId } : {})}
      onBack={() => stack.pop({ to: '/serial' })}
    />
  );
}
