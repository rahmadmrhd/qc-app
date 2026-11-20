import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { PostelDetail } from '@/modules/postel/components/postel-detail';
import { postelQueryOptions } from '@/modules/postel/queries';

export const Route = createFileRoute('/_app/postel/$postelId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(postelQueryOptions(params.postelId ?? '').queryKey)?.name ??
        'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postelQueryOptions(params.postelId)),
  component: PostelDetailRoute,
});

function PostelDetailRoute() {
  const { postelId } = Route.useParams();
  const navigate = useNavigate();
  const stack = useStackNavigation();
  const me = useMe();
  return (
    <PostelDetail
      postelId={postelId}
      canEdit={can(me, 'sticker', 'edit')}
      onBack={() => stack.pop({ to: '/postel' })}
      onEdit={() => void navigate({ to: '/postel/$postelId/edit', params: { postelId } })}
    />
  );
}
