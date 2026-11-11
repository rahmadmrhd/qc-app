import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { PostelHistory } from '@/modules/postel/components/postel-history';
import { PostelView } from '@/modules/postel/components/postel-view';
import { postelQueryOptions, useRemovePostel } from '@/modules/postel/queries';

export const Route = createFileRoute('/_app/postel/$postelId/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postelQueryOptions(params.postelId)),
  component: PostelDetailRoute,
});

function PostelDetailRoute() {
  const { postelId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { data: postel } = useSuspenseQuery(postelQueryOptions(postelId));
  const remove = useRemovePostel();

  async function handleRemove() {
    try {
      await remove.mutateAsync({ id: postel.id });
      toast.success('Catatan Postel dihapus');
      await navigate({ to: '/postel' });
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <PostelView
        postel={postel}
        canEdit={can(me, 'sticker', 'edit')}
        onBack={() => void navigate({ to: '/postel' })}
        onEdit={() =>
          void navigate({ to: '/postel/$postelId/edit', params: { postelId: postel.id } })
        }
        onRemove={handleRemove}
      />
      <PostelHistory id={postel.id} />
    </div>
  );
}
