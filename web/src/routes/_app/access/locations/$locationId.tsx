import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { LocationFormDialog } from '@/modules/access/components/location-form-dialog';
import { LocationView } from '@/modules/access/components/location-view';
import {
  locationQueryOptions,
  useRemoveLocations,
  useRestoreLocations,
  useSaveLocation,
  useSetLocationStatus,
} from '@/modules/access/queries';
import { can, canAnywhere, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/locations/$locationId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(
          locationQueryOptions(queryClient, params.locationId ?? '').queryKey,
        )?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, params }) =>
    // Lokasi yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
    context.queryClient
      .ensureQueryData(locationQueryOptions(context.queryClient, params.locationId))
      .catch(() => undefined),
  component: LocationDetailPage,
});

/** Galat "lokasi tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function LocationDetailPage() {
  const { locationId } = Route.useParams();
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(locationQueryOptions(queryClient, locationId));
  const saveLocation = useSaveLocation();
  const setStatus = useSetLocationStatus();
  const removeLocations = useRemoveLocations();
  const restoreLocations = useRestoreLocations();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'access', 'manage');
  const location = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreLocations
      .mutateAsync({ ids: [locationId] })
      .then(() => toast.success('Lokasi dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/access/locations',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function toggleStatus() {
    if (!location) return;
    const next = location.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: location.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Lokasi diaktifkan' : 'Lokasi dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeLocations.mutate(
      { ids: [locationId] },
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
      <LocationView
        location={location}
        canManage={canManage}
        canOpenSerials={
          canAnywhere(me, 'serial', 'view') || canAnywhere(me, 'serialservice', 'view')
        }
        canOpenStock={canAnywhere(me, 'sticker', 'view') || canAnywhere(me, 'stickerstock', 'view')}
        statusPending={setStatus.isPending}
        restorePending={restoreLocations.isPending}
        onBack={() => stack.pop({ to: '/access/locations' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {location ? (
        <>
          <LocationFormDialog
            open={editing}
            onOpenChange={setEditing}
            location={location}
            onSave={async (input) => {
              await saveLocation.mutateAsync(input);
              toast.success('Lokasi disimpan');
            }}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="lokasi"
            onConfirm={remove}
            busy={removeLocations.isPending}
          />
        </>
      ) : null}
    </>
  );
}
