import type { BusinessUnitDto } from '@shared/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import {
  BusinessUnitDeactivateDialog,
  needsDeactivateConfirmation,
} from '@/modules/access/components/business-unit-deactivate-dialog';
import { BusinessUnitDetailView } from '@/modules/access/components/business-unit-detail-view';
import { BusinessUnitFormDialog } from '@/modules/access/components/business-unit-form-dialog';
import {
  businessUnitQueryOptions,
  useRemoveBusinessUnits,
  useRestoreBusinessUnits,
  useSaveBusinessUnit,
  useSetBusinessUnitStatus,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/business-units/$businessUnitId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(
          businessUnitQueryOptions(queryClient, params.businessUnitId ?? '').queryKey,
        )?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, params }) =>
    // BU yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
    context.queryClient
      .ensureQueryData(businessUnitQueryOptions(context.queryClient, params.businessUnitId))
      .catch(() => undefined),
  component: BusinessUnitDetailPage,
});

/** Galat "BU tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function BusinessUnitDetailPage() {
  const { businessUnitId } = Route.useParams();
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(businessUnitQueryOptions(queryClient, businessUnitId));
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetBusinessUnitStatus();
  const removeBusinessUnits = useRemoveBusinessUnits();
  const restoreBusinessUnits = useRestoreBusinessUnits();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deactivating, setDeactivating] = useState<BusinessUnitDto | null>(null);
  const canManage = can(me, 'access', 'manage');
  const businessUnit = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreBusinessUnits
      .mutateAsync({ ids: [businessUnitId] })
      .then(() => toast.success('Business Unit dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/access/business-units',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function applyStatus(bu: BusinessUnitDto, next: 'active' | 'inactive') {
    setStatus.mutate(
      { id: bu.id, status: next },
      {
        onSuccess: () =>
          toast.success(
            next === 'active' ? 'Business Unit diaktifkan' : 'Business Unit dinonaktifkan',
          ),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function toggleStatus() {
    if (!businessUnit) return;
    if (needsDeactivateConfirmation(businessUnit)) setDeactivating(businessUnit);
    else applyStatus(businessUnit, businessUnit.status === 'active' ? 'inactive' : 'active');
  }

  function remove() {
    removeBusinessUnits.mutate(
      { ids: [businessUnitId] },
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

  const usage =
    businessUnit && (businessUnit.itemCount > 0 || businessUnit.userCount > 0)
      ? `Dipakai ${businessUnit.itemCount} item, ${businessUnit.userCount} pengguna`
      : undefined;

  return (
    <>
      <BusinessUnitDetailView
        businessUnit={businessUnit}
        canManage={canManage}
        statusPending={setStatus.isPending}
        restorePending={restoreBusinessUnits.isPending}
        onBack={() => stack.pop({ to: '/access/business-units' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {businessUnit ? (
        <>
          <BusinessUnitFormDialog
            open={editing}
            onOpenChange={setEditing}
            businessUnit={businessUnit}
            onSave={async (input) => {
              await saveBusinessUnit.mutateAsync(input);
              toast.success('Business Unit disimpan');
            }}
          />
          <BusinessUnitDeactivateDialog
            businessUnits={deactivating ? [deactivating] : []}
            onCancel={() => setDeactivating(null)}
            onConfirm={() => {
              const target = deactivating;
              setDeactivating(null);
              if (target) applyStatus(target, 'inactive');
            }}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="BU"
            {...(usage ? { usage } : {})}
            onConfirm={remove}
            busy={removeBusinessUnits.isPending}
          />
        </>
      ) : null}
    </>
  );
}
