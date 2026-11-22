import type { ListStatusFilter } from '@shared/batch';
import type { StickerTypeDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import {
  BulkBar,
  type DataColumn,
  DataTable,
  LinkCell,
  type RowAction,
  useBulkAction,
  useRowSelection,
} from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { statusFilterOptions } from '@/components/soft-delete/status-filter';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { STICKER_RULE_LABEL } from '../schemas';
import {
  StickerTypeFormDialog,
  type StickerTypeSaveInput,
  type StickerTypeSaveResult,
} from './sticker-type-form-dialog';

/** Filter halaman Jenis Stiker (search params Router). */
export interface StickerTypesFilter {
  q: string;
  status: ListStatusFilter;
}

/** Aksi tulis jenis yang dikirim bertahap; masing-masing mengembalikan hasil server per id. */
export interface StickerTypeMutations {
  setStatus: (ids: string[], status: 'active' | 'inactive') => Promise<readonly unknown[]>;
  remove: (ids: string[]) => Promise<readonly unknown[]>;
  restore: (ids: string[]) => Promise<readonly unknown[]>;
  /** Muat ulang daftar (dipanggil bila ada tahap massal yang gagal). */
  reload: () => void;
}

export interface StickerTypesPageProps {
  types: readonly StickerTypeDto[];
  canEdit: boolean;
  canManage: boolean;
  filter: StickerTypesFilter;
  onFilterChange: (patch: Partial<StickerTypesFilter>) => void;
  pendingStatusId: string | null;
  /** Mengembalikan galat (tampil di dialog) atau `null` bila berhasil. */
  onSave: (input: StickerTypeSaveInput) => Promise<StickerTypeSaveResult>;
  onToggleStatus: (type: StickerTypeDto) => void;
  mutations: StickerTypeMutations;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Pemakaian jenis (stiker HIDUP, dari `stickerCount`) untuk dialog konfirmasi hapus; kosong bila tak dipakai. */
function usageText(types: readonly Pick<StickerTypeDto, 'stickerCount'>[]): string | undefined {
  const total = types.reduce((sum, type) => sum + type.stickerCount, 0);
  return total > 0 ? `Dipakai ${total} stiker.` : undefined;
}

/**
 * Daftar jenis stiker (kit CRUD): [checkbox][Aksi][Jenis → View][Aturan][Stiker → halaman Stiker terfilter][Status].
 * Jenis sistem tanpa checkbox dan tanpa aksi (dikelola aplikasi); tampilan Terhapus hanya bagi `sticker: manage`.
 */
export function StickerTypesPage({
  types,
  canEdit,
  canManage,
  filter,
  onFilterChange,
  pendingStatusId,
  onSave,
  onToggleStatus,
  mutations,
  isLoading,
  isError,
  onRetry,
}: StickerTypesPageProps) {
  const deletedView = filter.status === 'deleted';
  /** `'new'` = dialog tambah; objek = dialog ubah jenis itu. */
  const [dialog, setDialog] = useState<StickerTypeDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'bulk' } | { kind: 'row'; id: string }
  >();
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [text, setText] = useUrlSyncedText(filter.q, (value) => onFilterChange({ q: value }));
  const selection = useRowSelection(JSON.stringify(filter));

  const termKey = normalizeKey(text);
  const visible = types.filter(
    (type) =>
      (filter.status === 'all' || filter.status === 'deleted' || type.status === filter.status) &&
      (termKey === '' || normalizeKey(type.name).includes(termKey)),
  );
  const bulkSelection = canManage ? selection : undefined;

  const reload = mutations.reload;
  const changedIds = (ids: string[], changes: (type: StickerTypeDto) => boolean) =>
    ids.filter((id) => {
      const type = visible.find((entry) => entry.id === id);
      return type === undefined || changes(type);
    });
  /** Syarat aksi per baris (keputusan pemilik 2026-11-23): hanya baris yang memenuhi yang dikirim. Jenis sistem tak ikut. */
  const eligibleWith = (id: string, wanted?: StickerTypeDto['status']) => {
    const type = visible.find((entry) => entry.id === id);
    return (
      type !== undefined &&
      type.systemKind === '' &&
      (wanted === undefined || type.status === wanted)
    );
  };
  const activate = useBulkAction({
    selection,
    subject: 'jenis',
    verb: 'diaktifkan',
    eligible: (id) => eligibleWith(id, 'inactive'),
    send: (ids) => mutations.setStatus(ids, 'active'),
    undo: {
      changed: (ids) => changedIds(ids, (type) => type.status !== 'active'),
      run: (ids) => mutations.setStatus(ids, 'inactive'),
    },
    reload,
  });
  const deactivate = useBulkAction({
    selection,
    subject: 'jenis',
    verb: 'dinonaktifkan',
    eligible: (id) => eligibleWith(id, 'active'),
    send: (ids) => mutations.setStatus(ids, 'inactive'),
    undo: {
      changed: (ids) => changedIds(ids, (type) => type.status !== 'inactive'),
      run: (ids) => mutations.setStatus(ids, 'active'),
    },
    reload,
  });
  const remove = useBulkAction({
    selection,
    subject: 'jenis',
    verb: 'dihapus',
    eligible: (id) => eligibleWith(id, 'inactive'),
    send: (ids) => mutations.remove(ids),
    undo: { label: 'Pulihkan', run: (ids) => mutations.restore(ids) },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'jenis',
    verb: 'dipulihkan',
    eligible: (id) => eligibleWith(id),
    send: (ids) => mutations.restore(ids),
    reload,
  });
  const bulkBusy = activate.busy || deactivate.busy || remove.busy || restore.busy;
  const deletable = visible.filter(
    (type) => selection.selected.has(type.id) && eligibleWith(type.id, 'inactive'),
  );

  async function restoreRow(type: StickerTypeDto) {
    setRowBusy(type.id);
    try {
      await mutations.restore([type.id]);
      toast.success('Jenis dipulihkan (Nonaktif)');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setRowBusy(null);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      await remove.run();
      setDeleteTarget(undefined);
      return;
    }
    setRowBusy(target.id);
    try {
      await mutations.remove([target.id]);
      toast.success('Jenis dihapus');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setRowBusy(null);
      setDeleteTarget(undefined);
    }
  }

  const columns: DataColumn<StickerTypeDto>[] = [
    {
      id: 'name',
      header: 'Jenis',
      mobile: 'title',
      cell: (type) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/sticker/types/$typeId" params={{ typeId: type.id }}>
            {type.name}
          </LinkCell>
          {type.systemKind !== '' ? (
            <Badge variant="outline" color="primary">
              Sistem
            </Badge>
          ) : null}
          {type.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    {
      id: 'rule',
      header: 'Aturan',
      cell: (type) => STICKER_RULE_LABEL[type.rule],
    },
    {
      id: 'stickers',
      header: 'Stiker',
      align: 'right',
      className: 'tabular-nums',
      cell: (type) =>
        type.stickerCount === 0 ? (
          0
        ) : (
          <LinkCell to="/sticker" search={{ typeId: type.id }}>
            {type.stickerCount}
          </LinkCell>
        ),
    },
    // Tampilan Terhapus: "Dihapus oleh" dan "Dihapus pada" menggantikan Status (selalu Nonaktif).
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (type) => type.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (type) => (type.deleted ? formatStamp(type.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<StickerTypeDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (type) => <ActiveStatusBadge status={type.status} />,
          },
        ] satisfies DataColumn<StickerTypeDto>[])),
  ];

  const actions = (type: StickerTypeDto): RowAction[] => {
    const busy = pendingStatusId === type.id || rowBusy === type.id;
    // Jenis sistem dikelola aplikasi (selalu aktif; nama dan aturan terkunci): tanpa aksi apa pun.
    if (type.systemKind !== '') return [];
    if (type.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${type.name}`,
          shortLabel: 'Pulihkan',
          hidden: !canManage,
          busy,
          onSelect: () => void restoreRow(type),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${type.name}`,
        shortLabel: 'Ubah',
        hidden: !canEdit,
        onSelect: () => setDialog(type),
      },
      {
        id: 'status',
        action: type.status === 'active' ? 'deactivate' : 'activate',
        label: `${type.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${type.name}`,
        shortLabel: type.status === 'active' ? 'Nonaktifkan' : 'Aktifkan',
        hidden: !canManage,
        busy,
        onSelect: () => onToggleStatus(type),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${type.name}`,
        shortLabel: 'Hapus',
        // Hanya jenis Nonaktif yang dapat dihapus (server: "Nonaktifkan jenis stiker dulu sebelum dihapus").
        hidden: !canManage || type.status !== 'inactive',
        busy,
        onSelect: () => setDeleteTarget({ kind: 'row', id: type.id }),
      },
    ];
  };

  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === filter.status)?.label;
  const filtered = termKey !== '' || filter.status !== 'all';
  const countLabel =
    !isLoading && !isError && (visible.length > 0 || filtered)
      ? `${visible.length} jenis`
      : undefined;

  return (
    <>
      <ListPage
        title="Jenis Stiker"
        count={countLabel}
        createAction={
          canEdit && !deletedView
            ? { label: 'Tambah jenis', onClick: () => setDialog('new') }
            : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama jenis',
              label: 'Cari jenis',
            }}
          >
            <FilterChip
              label="Status"
              display={filter.status === 'all' ? null : statusLabel}
              onClear={() => onFilterChange({ status: 'all' })}
            >
              <Select
                id="sticker-types-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={filter.status}
                onValueChange={(next) => onFilterChange({ status: next as ListStatusFilter })}
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          bulkSelection ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                restore.eligibleCount > 0 ? (
                  <ActionButton action="restore" onClick={() => void restore.run()} />
                ) : null
              ) : (
                <>
                  {activate.eligibleCount > 0 ? (
                    <ActionButton action="activate" onClick={() => void activate.run()} />
                  ) : null}
                  {deactivate.eligibleCount > 0 ? (
                    <ActionButton action="deactivate" onClick={() => void deactivate.run()} />
                  ) : null}
                  {remove.eligibleCount > 0 ? (
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
        <p className="mb-3 text-sm text-muted-foreground">
          Jenis mengelompokkan stiker dan menentukan aturannya.
        </p>
        <DataTable
          rows={visible}
          rowKey={(type) => type.id}
          columns={columns}
          label="Daftar jenis stiker"
          rowTo={(type) => ({ to: '/sticker/types/$typeId', params: { typeId: type.id } })}
          selectLabel={(type) => type.name}
          selection={bulkSelection}
          rowSelectable={(type) => type.systemKind === ''}
          actions={actions}
          empty="Belum ada jenis stiker."
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onFilterChange({ q: '', status: 'all' });
          }}
          emptyAction={
            canEdit && !deletedView ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah jenis
              </Button>
            ) : undefined
          }
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
        />
      </ListPage>
      <StickerTypeFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        type={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={onSave}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined);
        }}
        count={deleteTarget?.kind === 'bulk' ? remove.eligibleCount : 1}
        subject="jenis"
        usage={usageText(
          deleteTarget?.kind === 'bulk'
            ? deletable
            : visible.filter((type) => deleteTarget?.kind === 'row' && type.id === deleteTarget.id),
        )}
        onConfirm={() => void confirmDelete()}
        busy={remove.busy || rowBusy !== null}
      />
    </>
  );
}
