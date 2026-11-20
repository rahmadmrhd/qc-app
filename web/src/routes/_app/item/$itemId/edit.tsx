import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { ItemFormPage } from '@/modules/item/components/item-form-page';
import { assertCanEditItem } from '@/modules/item/lib/edit-access';
import { itemQueryOptions } from '@/modules/item/queries';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/item/$itemId/edit')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const item = queryClient.getQueryData(itemQueryOptions(params.itemId ?? '').queryKey);
      return [
        { label: item ? `${item.brand} ${item.model}` : 'Detail', to: '/item/$itemId', params },
        { label: 'Ubah' },
      ];
    },
    pageWidth: 'narrow',
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: async ({ context, params }) => {
    const [item, me] = await Promise.all([
      context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
      context.queryClient.ensureQueryData(meQueryOptions()),
      context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
      context.queryClient.ensureQueryData(stickersQuery()),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
    ]);
    assertCanEditItem(me, item);
  },
  component: EditItemPage,
});

function EditItemPage() {
  const { itemId } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  return <ItemFormPage mode="edit" item={item} />;
}
