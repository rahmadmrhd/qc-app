import type { BusinessUnitDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeError } from '@/lib/api/describe-error';
import { BusinessUnitForm } from '@/modules/access/components/business-unit-form';
import { BusinessUnitsTable } from '@/modules/access/components/business-units-table';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import {
  businessUnitsQueryOptions,
  useSaveBusinessUnit,
  useSetBusinessUnitStatus,
} from '@/modules/access/queries';
import type { BusinessUnitFormOutput } from '@/modules/access/schemas';
import { toBusinessUnitFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/business-units')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
  component: BusinessUnitsPage,
});

function BusinessUnitsPage() {
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: businessUnits } = useSuspenseQuery(businessUnitsQueryOptions());
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetBusinessUnitStatus();
  const [editing, setEditing] = useState<BusinessUnitDto | 'new' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
    setFieldErrors({});
  }

  async function handleSubmit(values: BusinessUnitFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await saveBusinessUnit.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('Business Unit disimpan');
      closeDialog();
    } catch (error) {
      const picked = pickFieldErrors(error, ['code', 'name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  function toggleStatus(businessUnit: BusinessUnitDto) {
    const status = businessUnit.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: businessUnit.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === 'active' ? 'Business Unit diaktifkan' : 'Business Unit dinonaktifkan',
          ),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Business Unit</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah BU</Button> : null}
      </div>
      <BusinessUnitsTable
        businessUnits={businessUnits}
        canManage={canManage}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onEdit={(businessUnit) => setEditing(businessUnit)}
        onToggleStatus={toggleStatus}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Tambah BU' : 'Ubah BU'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <BusinessUnitForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toBusinessUnitFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              fieldErrors={fieldErrors}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
