import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageContent } from '@/components/page/page-container';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { StickerTypeFormDialog } from '@/modules/sticker/components/sticker-type-form-dialog';
import { StickerTypeView } from '@/modules/sticker/components/sticker-type-view';
import { useStickerTypeSave } from '@/modules/sticker/lib/use-sticker-save';
import {
  stickersQuery,
  stickerTypeQuery,
  useRemoveStickerTypes,
  useRestoreStickerTypes,
  useSetStickerTypeStatus,
} from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/types/$typeId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(stickerTypeQuery(queryClient, params.typeId ?? '').queryKey)
          ?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, params }) =>
    Promise.all([
      // Jenis yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
      context.queryClient
        .ensureQueryData(stickerTypeQuery(context.queryClient, params.typeId))
        .catch(() => undefined),
      context.queryClient.ensureQueryData(stickersQuery()),
    ]),
  component: StickerTypeViewRoute,
});

/** Galat "jenis tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function StickerTypeViewRoute() {
  const { typeId } = Route.useParams();
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(stickerTypeQuery(queryClient, typeId));
  const stickers = useQuery(stickersQuery());
  const handleSave = useStickerTypeSave();
  const setStatus = useSetStickerTypeStatus();
  const removeTypes = useRemoveStickerTypes();
  const restoreTypes = useRestoreStickerTypes();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'sticker', 'manage');
  const type = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreTypes
      .mutateAsync({ ids: [typeId] })
      .then(() => toast.success('Jenis dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/sticker/types',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }

  function toggleStatus() {
    if (!type) return;
    const next = type.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: type.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Jenis diaktifkan' : 'Jenis dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeTypes.mutate(
      { ids: [typeId] },
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

  return (
    <>
      <StickerTypeView
        type={type}
        stickers={stickers.data ?? []}
        canEdit={can(me, 'sticker', 'edit')}
        canManage={canManage}
        statusPending={setStatus.isPending}
        restorePending={restoreTypes.isPending}
        onBack={() => stack.pop({ to: '/sticker/types' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {type ? (
        <>
          <StickerTypeFormDialog
            open={editing}
            onOpenChange={setEditing}
            type={type}
            onSave={handleSave}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="jenis"
            usage={type.stickerCount > 0 ? `Dipakai ${type.stickerCount} stiker.` : undefined}
            onConfirm={remove}
            busy={removeTypes.isPending}
          />
        </>
      ) : null}
    </>
  );
}
