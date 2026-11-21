import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess, stickerTypeLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { StickerFormDialog } from '@/modules/sticker/components/sticker-form-dialog';
import {
  STICKER_TABS,
  type StickerTab,
  StickerView,
} from '@/modules/sticker/components/sticker-view';
import { useStockActions } from '@/modules/sticker/components/stock-actions';
import { nextStickerStatus } from '@/modules/sticker/lib/status';
import { useStickerSave } from '@/modules/sticker/lib/use-sticker-save';
import { useStockWrites } from '@/modules/sticker/lib/use-stock-writes';
import {
  stickerQuery,
  stickerStockQuery,
  stickerTypesQuery,
  useRemoveStickers,
  useRestoreStickers,
  useSaveStickerType,
  useSetStickerStatus,
} from '@/modules/sticker/queries';

const searchSchema = z.object({
  tab: z.enum(STICKER_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/$stickerId')({
  staticData: {
    locationAware: true,
    crumb: ({ params, queryClient }) => {
      const sticker = queryClient.getQueryData(
        stickerQuery(queryClient, params.stickerId ?? '').queryKey,
      );
      return { label: sticker ? sticker.alias || sticker.name : 'Detail' };
    },
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, params }) =>
    Promise.all([
      // Stiker yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
      context.queryClient
        .ensureQueryData(stickerQuery(context.queryClient, params.stickerId))
        .catch(() => undefined),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: StickerViewRoute,
});

/** Galat "stiker tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function StickerViewRoute() {
  const { stickerId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const query = useQuery(stickerQuery(queryClient, stickerId));
  const types = useQuery(stickerTypesQuery());
  const businessUnits = useQuery(businessUnitOptionsQueryOptions());
  const handleSave = useStickerSave();
  const saveType = useSaveStickerType();
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetStickerStatus();
  const removeStickers = useRemoveStickers();
  const restoreStickers = useRestoreStickers();
  const { handleWrite } = useStockWrites();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'sticker', 'manage');
  const typeLinks = stickerTypeLinkAccess(me);
  const buLinks = businessUnitLinkAccess(me);
  const sticker = query.data;

  // Tab Stok/Riwayat hanya bagi pemegang `stickerstock: view` di minimal satu lokasi terpilih.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const readableIds = readable.map((location) => location.id);
  const stock = useQuery({
    ...stickerStockQuery(readableIds),
    enabled: readable.length > 0 && sticker !== undefined && sticker.deleted === undefined,
  });
  const panel =
    readable.length > 0 && stock.data
      ? {
          rows: stock.data,
          locations: readable,
          canEdit: locationsWith(me, 'stickerstock', 'edit', selectedIds).length > 0,
          canManage: locationsWith(me, 'stickerstock', 'manage', selectedIds).length > 0,
          onWrite: handleWrite,
        }
      : undefined;
  const stockActions = useStockActions(panel);

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreStickers
      .mutateAsync({ ids: [stickerId] })
      .then(() => toast.success('Stiker dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/sticker',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function toggleStatus() {
    if (!sticker) return;
    const next = nextStickerStatus(sticker.status);
    setStatus.mutate(
      { id: sticker.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Stiker diaktifkan' : 'Stiker dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeStickers.mutate(
      { ids: [stickerId] },
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

  function changeTab(next: StickerTab) {
    void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true });
  }

  const type = types.data?.find((entry) => entry.id === sticker?.typeId);

  return (
    <>
      <StickerView
        sticker={sticker}
        type={type}
        businessUnits={businessUnits.data ?? []}
        stock={panel}
        stockActions={stockActions}
        canEdit={can(me, 'sticker', 'edit')}
        canManage={canManage}
        canOpenBusinessUnit={buLinks.openBusinessUnitHref !== undefined}
        statusPending={setStatus.isPending}
        restorePending={restoreStickers.isPending}
        tab={tab}
        onTabChange={changeTab}
        onBack={() => stack.pop({ to: '/sticker' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
        onStartOpname={(id) => stack.push({ to: '/sticker/opname', search: { sticker: id } })}
        onStartEntry={(id) => stack.push({ to: '/sticker/entry', search: { sticker: id } })}
      />
      {sticker ? (
        <>
          <StickerFormDialog
            open={editing}
            onOpenChange={setEditing}
            sticker={sticker}
            types={types.data ?? []}
            businessUnits={businessUnits.data ?? []}
            onSave={handleSave}
            onCreateType={
              typeLinks.canCreateStickerType ? (input) => saveType.mutateAsync(input) : undefined
            }
            onCreateBusinessUnit={
              buLinks.canCreateBusinessUnit
                ? (input) => saveBusinessUnit.mutateAsync(input)
                : undefined
            }
            openBusinessUnitHref={buLinks.openBusinessUnitHref}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="stiker"
            onConfirm={remove}
            busy={removeStickers.isPending}
          />
        </>
      ) : null}
    </>
  );
}
