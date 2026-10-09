import type { LocationDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeError } from '@/lib/rpc/describe-error';
import { LocationForm } from '@/modules/access/components/location-form';
import { LocationsTable } from '@/modules/access/components/locations-table';
import {
  locationsQueryOptions,
  useSaveLocation,
  useSetLocationStatus,
} from '@/modules/access/queries';
import type { LocationFormOutput } from '@/modules/access/schemas';
import { toLocationFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/locations')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(locationsQueryOptions()),
  component: LocationsPage,
});

function LocationsPage() {
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const saveLocation = useSaveLocation();
  const setStatus = useSetLocationStatus();
  const [editing, setEditing] = useState<LocationDto | 'new' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: LocationFormOutput) {
    setSubmitError(null);
    try {
      await saveLocation.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('Lokasi disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function toggleStatus(location: LocationDto) {
    const status = location.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: location.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Lokasi diaktifkan' : 'Lokasi dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lokasi</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah lokasi</Button> : null}
      </div>
      <LocationsTable
        locations={locations}
        canManage={canManage}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onEdit={(location) => setEditing(location)}
        onToggleStatus={toggleStatus}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Tambah lokasi' : 'Ubah lokasi'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <LocationForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toLocationFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
