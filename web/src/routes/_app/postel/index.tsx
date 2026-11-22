import type { PostelSummaryDto } from '@shared/contract';
import { comparePostels, filterPostels, type PostelCondition } from '@shared/postel';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { MultiSelect, Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { PostelsTable } from '@/modules/postel/components/postels-table';
import { postelDeleteUsage } from '@/modules/postel/lib/delete-usage';
import {
  postelListQueryOptions,
  useRemovePostels,
  useRestorePostels,
} from '@/modules/postel/queries';

const CONDITION_OPTIONS: { value: 'soon' | 'expired'; label: string }[] = [
  { value: 'soon', label: 'Segera habis' },
  { value: 'expired', label: 'Kedaluwarsa' },
];

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  /** Kondisi yang disaring (banyak nilai = salah satu dari; filter klien-saja). */
  conditions: z
    .array(z.enum(['soon', 'expired']))
    .max(3)
    .optional()
    .catch(undefined),
  /** Satu kondisi: param tunggal lama yang masih diterima; dibaca sebagai `conditions`. */
  condition: z.enum(['soon', 'expired']).optional().catch(undefined),
  status: z.enum(['live', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/postel/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `sticker: edit`: tak dimuat di loader (server akan menolaknya).
    if (search.status === 'deleted') return undefined;
    return context.queryClient.ensureQueryData(postelListQueryOptions());
  },
  component: PostelListRoute,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; postel: PostelSummaryDto };

function PostelListRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const me = useMe();
  const canEdit = can(me, 'sticker', 'edit');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai daftar hidup.
  const status = search.status === 'deleted' && !canEdit ? 'live' : (search.status ?? 'live');
  const deletedView = status === 'deleted';
  const conditions: PostelCondition[] =
    search.conditions ?? (search.condition ? [search.condition] : []);
  const list = useQuery(postelListQueryOptions(status));
  const removePostels = useRemovePostels();
  const restorePostels = useRestorePostels();
  const selection = useRowSelection(JSON.stringify({ status, conditions, q: search.q ?? '' }));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  // Penyaringan dan urutan di klien (server memberi semua catatan, maks. 500): urut tanggal habis nomor Aktif.
  const visible = filterPostels([...(list.data?.postels ?? [])].sort(comparePostels), {
    query: text,
    conditions,
  });

  const reload = () => void list.refetch();
  const remove = useBulkAction({
    selection,
    subject: 'catatan Postel',
    verb: 'dihapus',
    send: (ids) => removePostels.mutateAsync({ ids }).then((result) => result.ids),
    undo: {
      label: 'Pulihkan',
      run: (ids) => restorePostels.mutateAsync({ ids }).then((result) => result.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'catatan Postel',
    verb: 'dipulihkan',
    send: (ids) => restorePostels.mutateAsync({ ids }).then((result) => result.items),
    reload,
  });
  const bulkBusy = remove.busy || restore.busy;

  function restoreRow(postel: PostelSummaryDto) {
    restorePostels.mutate(
      { ids: [postel.id] },
      {
        onSuccess: () => toast.success('Catatan Postel dipulihkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removePostels.mutate(
      { ids: [target.postel.id] },
      {
        onSuccess: () => toast.success('Catatan Postel dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const usedItems =
    deleteTarget?.kind === 'row'
      ? deleteTarget.postel.itemCount
      : visible
          .filter((postel) => selection.selected.has(postel.id))
          .reduce((sum, postel) => sum + postel.itemCount, 0);
  const statusOptions = liveStatusFilterOptions(canEdit);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId =
    restorePostels.isPending && restorePostels.variables?.ids.length === 1
      ? (restorePostels.variables.ids[0] ?? null)
      : removePostels.isPending && removePostels.variables?.ids.length === 1
        ? (removePostels.variables.ids[0] ?? null)
        : null;
  const filtered = text.trim() !== '' || conditions.length > 0 || deletedView;
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} catatan` : undefined;
  const goNew = () => stack.push({ to: '/postel/new' });

  return (
    <>
      <ListPage
        title="Postel"
        count={countLabel}
        createAction={canEdit ? { label: 'Tambah Postel', onClick: goNew } : undefined}
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama, nomor, atau model',
              label: 'Cari Postel',
            }}
          >
            <FilterChip
              label="Kondisi"
              display={multiFilterDisplay(
                conditions.map(
                  (value) =>
                    CONDITION_OPTIONS.find((option) => option.value === value)?.label ?? value,
                ),
              )}
              onClear={() =>
                void navigate({
                  search: (prev) => ({ ...prev, conditions: undefined, condition: undefined }),
                  replace: true,
                })
              }
            >
              <MultiSelect
                id="postel-filter-condition"
                label="Filter kondisi"
                hideLabel
                placeholder="Semua kondisi"
                options={CONDITION_OPTIONS}
                value={conditions}
                onValueChange={(next) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      conditions: next.length > 0 ? (next as ('soon' | 'expired')[]) : undefined,
                      condition: undefined,
                    }),
                    replace: true,
                  })
                }
              />
            </FilterChip>
            {statusOptions.length > 0 ? (
              <FilterChip
                label="Status"
                display={status === 'live' ? null : statusLabel}
                onClear={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, status: undefined }),
                    replace: true,
                  })
                }
              >
                <Select
                  id="postel-filter-status"
                  label="Filter status"
                  hideLabel
                  options={statusOptions}
                  value={status}
                  onValueChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, status: next as 'live' | 'deleted' }),
                      replace: true,
                    })
                  }
                />
              </FilterChip>
            ) : null}
          </FilterBar>
        }
        bulkBar={
          canEdit ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                <ActionButton action="restore" onClick={() => void restore.run()} />
              ) : (
                <ActionButton action="delete" onClick={() => setDeleteTarget({ kind: 'bulk' })} />
              )}
            </BulkBar>
          ) : null
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Catatan sertifikat Postel beserta masa berlakunya. Kondisi catatan mengikuti nomor Aktif
          (nomor terbaru).
        </p>
        <PostelsTable
          postels={visible}
          deletedView={deletedView}
          canEdit={canEdit}
          selection={canEdit ? selection : undefined}
          busyId={pendingId}
          onEdit={(postel) =>
            stack.push({ to: '/postel/$postelId/edit', params: { postelId: postel.id } })
          }
          onDelete={(postel) => setDeleteTarget({ kind: 'row', postel })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canEdit && !filtered ? (
              <Button type="button" onClick={goNew}>
                Tambah catatan Postel pertama
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="catatan Postel"
        {...(usedItems > 0 ? { usage: postelDeleteUsage(usedItems) } : {})}
        onConfirm={confirmDelete}
        busy={remove.busy || removePostels.isPending}
      />
    </>
  );
}
