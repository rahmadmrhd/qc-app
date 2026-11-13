import type { LocationDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FormDialog,
  FormDialogContent,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { LocationForm } from '@/modules/access/components/location-form';
import { LocationsTable } from '@/modules/access/components/locations-table';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
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
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
    setFieldErrors({});
  }

  async function handleSubmit(values: LocationFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await saveLocation.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('Lokasi disimpan');
      closeDialog();
    } catch (error) {
      const picked = pickFieldErrors(error, ['code', 'name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
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
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      >
        <FormDialogContent>
          <FormDialogHeader>
            <FormDialogTitle>{editing === 'new' ? 'Tambah lokasi' : 'Ubah lokasi'}</FormDialogTitle>
          </FormDialogHeader>
          {editing ? (
            <LocationForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toLocationFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              fieldErrors={fieldErrors}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </FormDialogContent>
      </FormDialog>
    </div>
  );
}
