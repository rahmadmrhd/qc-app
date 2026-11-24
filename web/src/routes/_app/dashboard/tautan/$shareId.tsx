import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { ShareDetailView } from '@/modules/dashboard/components/share-detail-view';
import { shareDetailQueryOptions } from '@/modules/dashboard/share-queries';

export const Route = createFileRoute('/_app/dashboard/tautan/$shareId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(shareDetailQueryOptions(params.shareId ?? '').queryKey)?.title ??
        'Tautan',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'dashboard', 'manage'),
  // Tautan yang tak ada atau di luar hak baca ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(shareDetailQueryOptions(params.shareId))
      .catch(() => undefined),
  component: ShareDetailRoute,
});

function ShareDetailRoute() {
  const { shareId } = Route.useParams();
  const stack = useStackNavigation();
  return (
    <ShareDetailView
      key={shareId}
      shareId={shareId}
      onBack={() => stack.pop({ to: '/dashboard' })}
    />
  );
}
