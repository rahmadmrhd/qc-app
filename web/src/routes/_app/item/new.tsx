import { createFileRoute } from '@tanstack/react-router';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { ItemFormPage } from '@/modules/item/components/item-form-page';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/item/new')({
  staticData: { crumb: 'Tambah', pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
      context.queryClient.ensureQueryData(stickersQuery()),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
    ]),
  component: () => <ItemFormPage mode="create" />,
});
