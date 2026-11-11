import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { PostelsPage } from '@/modules/postel/components/postels-page';
import { postelListQueryOptions } from '@/modules/postel/queries';

export const Route = createFileRoute('/_app/postel/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(postelListQueryOptions()),
  component: PostelListRoute,
});

function PostelListRoute() {
  const navigate = useNavigate();
  const me = useMe();
  const { data } = useSuspenseQuery(postelListQueryOptions());
  return (
    <PostelsPage
      data={data}
      canEdit={can(me, 'sticker', 'edit')}
      onNew={() => void navigate({ to: '/postel/new' })}
      onOpen={(id) => void navigate({ to: '/postel/$postelId', params: { postelId: id } })}
    />
  );
}
