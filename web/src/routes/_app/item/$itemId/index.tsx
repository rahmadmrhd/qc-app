import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { manualBookLinkAccess, postelLinkAccess } from '@/lib/link-access';
import { can, canEditItem, canManageItem, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ItemDetailView } from '@/modules/item/components/item-detail-view';
import { itemQueryOptions, useSetItemStatus } from '@/modules/item/queries';

export const Route = createFileRoute('/_app/item/$itemId/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
  component: ItemDetailPage,
});

function ItemDetailPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const setStatus = useSetItemStatus();

  function toggleStatus() {
    const status = item.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: item.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Item diaktifkan' : 'Item dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <ItemDetailView
      item={item}
      canEdit={canEditItem(me, item)}
      canManage={canManageItem(me, item)}
      statusPending={setStatus.isPending}
      openManualBookHref={manualBookLinkAccess(me).openManualBookHref}
      // `item.postel` bernilai null juga bagi user tanpa `sticker: view`: bagian disembunyikan lewat undefined.
      postel={can(me, 'sticker', 'view') ? item.postel : undefined}
      openPostelHref={postelLinkAccess(me).openPostelHref}
      onBack={() => void navigate({ to: '/item' })}
      onEdit={() => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
      onToggleStatus={toggleStatus}
    />
  );
}
