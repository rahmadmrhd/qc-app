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
import { customerHandoversLinkAccess } from '@/lib/link-access';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CustomerFormDialog } from '@/modules/customer/components/customer-form-dialog';
import { CustomerView } from '@/modules/customer/components/customer-view';
import {
  customerQueryOptions,
  useRemoveCustomers,
  useRenameCustomer,
  useRestoreCustomers,
  useSetCustomerStatus,
} from '@/modules/customer/queries';

export const Route = createFileRoute('/_app/customer/$customerId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(
          customerQueryOptions(queryClient, params.customerId ?? '').queryKey,
        )?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, params }) =>
    // Customer yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
    context.queryClient
      .ensureQueryData(customerQueryOptions(context.queryClient, params.customerId))
      .catch(() => undefined),
  component: CustomerDetailPage,
});

/** Galat "customer tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(customerQueryOptions(queryClient, customerId));
  const rename = useRenameCustomer();
  const setStatus = useSetCustomerStatus();
  const removeCustomers = useRemoveCustomers();
  const restoreCustomers = useRestoreCustomers();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'item', 'manage');
  const customer = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreCustomers
      .mutateAsync({ ids: [customerId] })
      .then(() => toast.success('Customer dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/customer',
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
    if (!customer) return;
    const next = customer.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: customer.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Customer diaktifkan' : 'Customer dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeCustomers.mutate(
      { ids: [customerId] },
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
      <CustomerView
        customer={customer}
        canManage={canManage}
        canViewHandovers={customerHandoversLinkAccess(me).canViewHandovers}
        statusPending={setStatus.isPending}
        restorePending={restoreCustomers.isPending}
        onBack={() => stack.pop({ to: '/customer' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {customer ? (
        <>
          <CustomerFormDialog
            open={editing}
            onOpenChange={setEditing}
            customer={customer}
            onSave={async (input) => {
              await rename.mutateAsync(input);
              toast.success('Customer diperbarui');
            }}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="customer"
            onConfirm={remove}
            busy={removeCustomers.isPending}
          />
        </>
      ) : null}
    </>
  );
}
