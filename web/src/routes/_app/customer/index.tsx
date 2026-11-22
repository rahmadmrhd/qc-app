import type { CustomerDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { statusFilterOptions } from '@/components/soft-delete/status-filter';
import { describeError } from '@/lib/api/describe-error';
import { useRecordBulk } from '@/modules/access/lib/use-record-bulk';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CustomerFormDialog } from '@/modules/customer/components/customer-form-dialog';
import { CustomersManager } from '@/modules/customer/components/customers-manager';
import {
  customersQueryOptions,
  useRemoveCustomers,
  useRenameCustomer,
  useRestoreCustomers,
  useSetCustomerStatus,
  useSetCustomerStatusBatch,
} from '@/modules/customer/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/customer/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `item: manage`: tak dimuat di loader (server akan menolaknya).
    return search.status === 'deleted'
      ? undefined
      : context.queryClient.ensureQueryData(customersQueryOptions());
  },
  component: CustomersPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; customer: CustomerDto };

function CustomersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'item', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const list = useQuery(customersQueryOptions(deletedView ? 'deleted' : undefined));
  const rename = useRenameCustomer();
  const setStatus = useSetCustomerStatus();
  const statusBatch = useSetCustomerStatusBatch();
  const removeCustomers = useRemoveCustomers();
  const restoreCustomers = useRestoreCustomers();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const term = text.trim().toLowerCase();
  const visible = (list.data ?? []).filter(
    (customer) =>
      (deletedView || status === 'all' || customer.status === status) &&
      (term === '' || customer.name.toLowerCase().includes(term)),
  );
  const reload = () => void list.refetch();
  const bulk = useRecordBulk({
    selection,
    subject: 'customer',
    rows: visible,
    setStatusBatch: (input) => statusBatch.mutateAsync(input),
    removeBatch: (input) => removeCustomers.mutateAsync(input),
    restoreBatch: (input) => restoreCustomers.mutateAsync(input),
    reload,
  });

  function toggleStatus(customer: CustomerDto) {
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

  function restoreRow(customer: CustomerDto) {
    restoreCustomers.mutate(
      { ids: [customer.id] },
      {
        onSuccess: () => toast.success('Customer dipulihkan (Nonaktif)'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void bulk.remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removeCustomers.mutate(
      { ids: [target.customer.id] },
      {
        onSuccess: () => toast.success('Customer dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreCustomers.isPending && restoreCustomers.variables?.ids.length === 1
      ? (restoreCustomers.variables.ids[0] ?? null)
      : null;
  const filtered = term !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} customer` : undefined;

  return (
    <>
      <ListPage
        title="Customer"
        count={countLabel}
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama customer',
              label: 'Cari customer',
            }}
          >
            <FilterChip
              label="Status"
              display={status === 'all' ? null : statusLabel}
              onClear={() =>
                void navigate({ search: (prev) => ({ ...prev, status: undefined }), replace: true })
              }
            >
              <Select
                id="customers-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={status}
                onValueChange={(next) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      status: next as 'all' | 'active' | 'inactive' | 'deleted',
                    }),
                    replace: true,
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulk.busy}>
              {deletedView ? (
                <ActionButton action="restore" onClick={() => void bulk.restore.run()} />
              ) : (
                <>
                  {bulk.activate.eligibleCount > 0 ? (
                    <ActionButton action="activate" onClick={() => void bulk.activate.run()} />
                  ) : null}
                  {bulk.deactivate.eligibleCount > 0 ? (
                    <ActionButton action="deactivate" onClick={() => void bulk.deactivate.run()} />
                  ) : null}
                  {bulk.remove.eligibleCount > 0 ? (
                    <ActionButton
                      action="delete"
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  ) : null}
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <CustomersManager
          customers={visible}
          deletedView={deletedView}
          canManage={canManage}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={setEditing}
          onToggleStatus={toggleStatus}
          onDelete={(customer) => setDeleteTarget({ kind: 'row', customer })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <CustomerFormDialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        customer={editing ?? undefined}
        onSave={async (input) => {
          await rename.mutateAsync(input);
          toast.success('Customer diperbarui');
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? bulk.remove.eligibleCount : 1}
        subject="customer"
        onConfirm={confirmDelete}
        busy={bulk.remove.busy || removeCustomers.isPending}
      />
    </>
  );
}
