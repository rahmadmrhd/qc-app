import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { SerialDetailPage } from '@/modules/serial/components/serial-detail-page';
import { serialDetailQueryOptions } from '@/modules/serial/queries';

export const Route = createFileRoute('/_app/serial/$serialId/')({
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
  const navigate = useNavigate();
  return (
    <SerialDetailPage
      key={serialId}
      serialId={serialId}
      onBack={() => void navigate({ to: '/serial' })}
    />
  );
}
