import type { QrDesignDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess } from '@/lib/link-access';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { BulkExportDialog } from '@/modules/qrcode/components/bulk-export-dialog';
import { QrDesignsTable } from '@/modules/qrcode/components/qr-designs-table';
import { classifyForExport } from '@/modules/qrcode/lib/bulk-export-plan';
import { useBulkQrExport } from '@/modules/qrcode/lib/use-bulk-qr-export';
import { useQrExport } from '@/modules/qrcode/lib/use-qr-export';
import {
  qrDesignsQueryOptions,
  useRemoveQrDesigns,
  useRestoreQrDesigns,
} from '@/modules/qrcode/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['live', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/qrcode/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `qrcode: manage`: tak dimuat di loader (server akan menolaknya).
    if (search.status === 'deleted') return undefined;
    return context.queryClient.ensureQueryData(qrDesignsQueryOptions());
  },
  component: QrCodesPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; design: QrDesignDto };

/** Teks yang dicari: nama, judul, subtitle, dan nama semua item yang terlihat. */
function searchText(design: QrDesignDto): string {
  return normalizeKey(
    [
      design.name,
      design.title,
      design.subtitle,
      ...design.items.map((item) => `${item.brand} ${item.model}`),
    ].join(' '),
  );
}

function QrCodesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const me = useMe();
  const canEdit = can(me, 'qrcode', 'edit');
  const canManage = can(me, 'qrcode', 'manage');
  const itemAccess = itemLinkAccess(me);
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai daftar hidup.
  const status = search.status === 'deleted' && !canManage ? 'live' : (search.status ?? 'live');
  const deletedView = status === 'deleted';
  const list = useQuery(qrDesignsQueryOptions(status));
  const removeDesigns = useRemoveQrDesigns();
  const restoreDesigns = useRestoreQrDesigns();
  const { busyId, exportAction, download, exportDialog } = useQrExport();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [bulkExportOpen, setBulkExportOpen] = useState(false);
  const bulkExport = useBulkQrExport();
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const termKey = normalizeKey(text);
  const visible = (list.data ?? []).filter(
    (design) => termKey === '' || searchText(design).includes(termKey),
  );

  const reload = () => void list.refetch();
  /** Tak ada syarat status pada konfigurasi: Hapus/Pulihkan berlaku bagi baris yang sedang tampil (keputusan pemilik 2026-11-23). */
  const isVisible = (id: string) => visible.some((design) => design.id === id);
  const remove = useBulkAction({
    selection,
    subject: 'konfigurasi',
    verb: 'dihapus',
    eligible: isVisible,
    send: (ids) => removeDesigns.mutateAsync({ ids }).then((result) => result.ids),
    undo: {
      label: 'Pulihkan',
      run: (ids) => restoreDesigns.mutateAsync({ ids }).then((result) => result.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'konfigurasi',
    verb: 'dipulihkan',
    eligible: isVisible,
    send: (ids) => restoreDesigns.mutateAsync({ ids }).then((result) => result.items),
    reload,
  });
  const bulkBusy = remove.busy || restore.busy || bulkExport.running;
  const selectedDesigns = visible.filter((design) => selection.selected.has(design.id));
  // Ekspor tampil bila minimal satu konfigurasi terpilih dapat diekspor; yang dilewati dilaporkan di dialog.
  const hasExportable = selectedDesigns.some((design) => classifyForExport(design).kind !== 'skip');

  function restoreRow(design: QrDesignDto) {
    restoreDesigns.mutate(
      { ids: [design.id] },
      {
        onSuccess: () => toast.success('Konfigurasi dipulihkan'),
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
    removeDesigns.mutate(
      { ids: [target.design.id] },
      {
        onSuccess: () => toast.success('Konfigurasi dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const liveItemCount = (design: QrDesignDto) =>
    design.items.filter((item) => !item.deleted).length + design.hiddenItemCount;
  const usedItems =
    deleteTarget?.kind === 'row'
      ? liveItemCount(deleteTarget.design)
      : selectedDesigns.reduce((sum, design) => sum + liveItemCount(design), 0);
  const statusOptions = liveStatusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId =
    restoreDesigns.isPending && restoreDesigns.variables?.ids.length === 1
      ? (restoreDesigns.variables.ids[0] ?? null)
      : removeDesigns.isPending && removeDesigns.variables?.ids.length === 1
        ? (removeDesigns.variables.ids[0] ?? null)
        : null;
  const filtered = termKey !== '' || deletedView;
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered)
      ? `${visible.length} konfigurasi`
      : undefined;
  const goNew = () => stack.push({ to: '/qrcode/new' });

  return (
    <>
      <ListPage
        title="QR Code Label"
        tour="qr-header"
        count={countLabel}
        createAction={
          canEdit ? { label: 'Buat konfigurasi', onClick: goNew, tour: 'qr-new' } : undefined
        }
        actions={
          canManage ? (
            <Button
              type="button"
              variant="outline"
              color="primary"
              onClick={() => stack.push({ to: '/qrcode/default' })}
            >
              Konfigurasi default
            </Button>
          ) : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama, judul, atau item',
              label: 'Cari konfigurasi',
            }}
          >
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
                  id="qr-filter-status"
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
          // Ekspor massal bagi `qrcode: edit`; Hapus/Pulihkan tetap `manage` (tampilan Terhapus hanya untuk manage).
          canEdit || canManage ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                canManage && restore.eligibleCount > 0 ? (
                  <ActionButton action="restore" onClick={() => void restore.run()} />
                ) : null
              ) : (
                <>
                  {canEdit && hasExportable ? (
                    <ActionButton action="export" onClick={() => setBulkExportOpen(true)} />
                  ) : null}
                  {canManage && remove.eligibleCount > 0 ? (
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
        <div data-tour="qr-table">
          <p className="mb-3 text-sm text-muted-foreground">
            Label 3 × 3 cm dari sebuah link. Ekspor menghasilkan PDF lembar 10 × 14 (300 × 420 mm)
            dan PNG, disimpan ke Drive setelah Anda konfirmasi.
          </p>
          <QrDesignsTable
            designs={visible}
            deletedView={deletedView}
            canEdit={canEdit}
            canManage={canManage}
            canOpenItem={itemAccess.openItemHref !== undefined}
            canOpenDeletedItem={itemAccess.canOpenDeleted}
            selection={canEdit || canManage ? selection : undefined}
            busyId={busyId ?? pendingId}
            onEdit={(design) =>
              stack.push({ to: '/qrcode/$designId/edit', params: { designId: design.id } })
            }
            onExport={exportAction}
            onDownload={(design, kind) => void download(design, kind)}
            onDelete={(design) => setDeleteTarget({ kind: 'row', design })}
            onRestore={restoreRow}
            filtered={filtered}
            onClearFilters={() => {
              setText('');
              void navigate({ search: {}, replace: true });
            }}
            emptyAction={
              canEdit && !filtered ? (
                <Button type="button" onClick={goNew}>
                  Buat konfigurasi pertama
                </Button>
              ) : undefined
            }
            isLoading={list.isPending}
            isError={list.isLoadingError}
            onRetry={reload}
          />
        </div>
      </ListPage>
      {exportDialog}
      <BulkExportDialog
        open={bulkExportOpen}
        onOpenChange={setBulkExportOpen}
        designs={selectedDesigns}
        exporter={bulkExport}
        onExported={(doneIds) => selection.remove(doneIds)}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? remove.eligibleCount : 1}
        subject="konfigurasi"
        {...(usedItems > 0 ? { usage: `Memuat ${usedItems} item` } : {})}
        onConfirm={confirmDelete}
        busy={remove.busy || removeDesigns.isPending}
      />
    </>
  );
}
