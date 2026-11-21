import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { describeError } from '@/lib/api/describe-error';
import {
  brandLinkAccess,
  businessUnitLinkAccess,
  manualBookLinkAccess,
  postelLinkAccess,
} from '@/lib/link-access';
import { can, canEditItem, canManageItem, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  ITEM_TABS,
  ItemDetailView,
  type ItemTab,
} from '@/modules/item/components/item-detail-view';
import {
  itemQueryOptions,
  useRemoveItems,
  useRestoreItems,
  useSetItemStatus,
} from '@/modules/item/queries';

const searchSchema = z.object({
  tab: z.enum(ITEM_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/item/$itemId/')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const item = queryClient.getQueryData(itemQueryOptions(params.itemId ?? '').queryKey);
      return { label: item ? `${item.brand} ${item.model}` : 'Detail' };
    },
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
  component: ItemDetailPage,
});

function ItemDetailPage() {
  const { itemId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const me = useMe();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const setStatus = useSetItemStatus();
  const removeItems = useRemoveItems();
  const restoreItems = useRestoreItems();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Pulihkan = hak `manage` pada item (rute server `items.restoreBatch`); View terhapus hanya terbaca bagi mereka.
  const canManage = canManageItem(me, item);

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreItems
      .mutateAsync({ ids: [item.id] })
      .then(() => toast.success('Item dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/item',
    canRestore: canManage,
    onRestore: restore,
  });

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

  function remove() {
    removeItems.mutate(
      { ids: [item.id] },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          afterDelete();
        },
        onError: (error) => {
          setConfirmDelete(false);
          toast.error(describeError(error));
        },
      },
    );
  }

  function changeTab(next: ItemTab) {
    // `from` mengunci tipe search ke rute ini (tanpa itu `to: '.'` memakai gabungan search semua rute, dan param `tab`
    // halaman View lain yang bernilai berbeda membuat tipenya bentrok).
    void navigate({
      from: Route.fullPath,
      to: '.',
      search: (prev) => ({ ...prev, tab: next }),
      replace: true,
    });
  }

  return (
    <>
      <ItemDetailView
        item={item}
        canEdit={canEditItem(me, item)}
        canManage={canManage}
        canRestore={canManage}
        canViewSerial={can(me, 'serial', 'view')}
        statusPending={setStatus.isPending}
        restorePending={restoreItems.isPending}
        openBrandHref={brandLinkAccess(me).openBrandHref}
        openBusinessUnitHref={businessUnitLinkAccess(me).openBusinessUnitHref}
        openManualBookHref={manualBookLinkAccess(me).openManualBookHref}
        // `item.postel` bernilai null juga bagi user tanpa `sticker: view`: ringkasan disembunyikan lewat undefined
        // (keterangan "Belum ada Postel" tetap tampil dari `item.hasPostel`).
        postel={can(me, 'sticker', 'view') ? item.postel : undefined}
        openPostelHref={postelLinkAccess(me).openPostelHref}
        tab={tab}
        onTabChange={changeTab}
        onEdit={() => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={1}
        subject="item"
        onConfirm={remove}
        busy={removeItems.isPending}
      />
    </>
  );
}
