import type { SerialDto, SerialSummaryDto } from '@shared/contract';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
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
import { ListPage } from '@/components/page/list-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { businessUnitLinkAccess, itemLinkAccess, locationLinkAccess } from '@/lib/link-access';
import {
  buIdsWithLevelOf,
  canManageAnySerial,
  canManageSerial,
  canUseSerialLocationOptions,
} from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { CUSTODY_LABEL, formatDay } from '../lib/labels';
import { filterOfSearch, type SerialSearch } from '../lib/list-filter';
import { todayWib } from '../lib/locations';
import { daysBetweenDates } from '../lib/transit';
import {
  serialDetailQueryOptions,
  serialListQueryOptions,
  useRemoveSerials,
  useRestoreSerials,
} from '../queries';
import { EditSerialDialog } from './edit-serial-dialog';
import { ProofBadge, ProofProblemBadge } from './proof-badge';
import { SerialFilters } from './serial-filters';
import { SerialStatusBadge } from './serial-status-badge';

export interface SerialListPageProps {
  search: SerialSearch;
  onSearchChange: (patch: Partial<SerialSearch>) => void;
  /** Tombol "Tambah Serial Number" (hanya pengguna yang boleh mencatat). */
  onNew?: (() => void) | undefined;
}

/** Posisi serial: "Dalam pengiriman · 3 hari" (+ tujuan) saat dikirim, dan nomor kasus yang sedang terbuka. */
function PositionCell({ serial, today }: { serial: SerialSummaryDto; today: string }) {
  const days = serial.transitOn ? daysBetweenDates(serial.transitOn, today) : null;
  return (
    <div className="space-y-0.5">
      <div>
        {CUSTODY_LABEL[serial.custody]}
        {serial.custody === 'transit' && days !== null
          ? ` · ${days === 0 ? 'hari ini' : `${days} hari`}`
          : ''}
      </div>
      {serial.custody === 'transit' && serial.transitToLocationName ? (
        <div className="text-xs text-muted-foreground">ke {serial.transitToLocationName}</div>
      ) : null}
      {serial.openCaseNumber ? (
        <div className="font-mono text-xs text-muted-foreground">{serial.openCaseNumber}</div>
      ) : null}
    </div>
  );
}

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; serial: SerialSummaryDto };

/** Catatan pada dialog hapus: stok yang sudah terpotong tidak kembali (soft delete Serial Number). */
const DELETE_USAGE =
  'Stok stiker yang sudah dipotong oleh Serial Number ini tidak dikembalikan, dan laporan rusaknya ikut tak tampil.';

/**
 * Daftar serial (kit CRUD): kolom [checkbox][Aksi][Serial → View][Item][BU][Lokasi][Tanggal uji][Status][Posisi][Sample].
 * Checkbox dan Hapus/Pulihkan massal hanya bagi pemegang `serial: manage` (tanpa ubah massal, keputusan 13); tampilan
 * Terhapus lewat chip "Tampilan". Filter ada di URL; di ponsel baris menjadi kartu.
 */
export function SerialListPage({ search, onSearchChange, onNew }: SerialListPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const manageAny = canManageAnySerial(me);
  const filter = filterOfSearch(search, me.email, manageAny);
  const deletedView = filter.deleted === true;
  const list = useInfiniteQuery(serialListQueryOptions(filter));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const today = todayWib();
  const removeSerials = useRemoveSerials();
  const restoreSerials = useRestoreSerials();
  const selection = useRowSelection(JSON.stringify(filter));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [editing, setEditing] = useState<SerialDto | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);

  const itemAccess = itemLinkAccess(me);
  const canOpenBu = businessUnitLinkAccess(me).openBusinessUnitHref !== undefined;
  const canOpenLocation = locationLinkAccess(me).openLocationHref !== undefined;
  const editableBuIds = new Set(buIdsWithLevelOf(me, 'serial', 'edit'));
  // Hanya baris yang boleh dikelola pemanggil yang dapat dipilih: satu id di luar hak membuat seluruh tahap
  // `NOT_FOUND` di server. Hak penuh = `serial: manage` pada SEMUA BU riwayat, dihitung server (`canManage`); tanpa
  // field itu (balasan pulihkan, server lama) jatuh ke BU saat ini saja. Server tetap yang berwenang.
  const manageable = (serial: SerialSummaryDto) =>
    serial.canManage ?? canManageSerial(me, [serial.buId]);

  const reload = () => void list.refetch();
  const remove = useBulkAction({
    selection,
    subject: 'Serial Number',
    verb: 'dihapus',
    send: (ids) => removeSerials.mutateAsync({ ids }).then((result) => result.ids),
    undo: {
      label: 'Pulihkan',
      run: (ids) => restoreSerials.mutateAsync({ ids }).then((result) => result.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'Serial Number',
    verb: 'dipulihkan',
    send: (ids) => restoreSerials.mutateAsync({ ids }).then((result) => result.items),
    reload,
  });
  const bulkBusy = remove.busy || restore.busy;

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removeSerials.mutate(
      { ids: [target.serial.id] },
      {
        onSuccess: () => toast.success('Serial Number dihapus'),
        onError: (error) => {
          toast.error(describeError(error));
          reload();
        },
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  function restoreRow(serial: SerialSummaryDto) {
    restoreSerials.mutate(
      { ids: [serial.id] },
      {
        onSuccess: () => toast.success('Serial Number dipulihkan'),
        onError: (error) => {
          toast.error(describeError(error));
          reload();
        },
      },
    );
  }

  /** Dialog Ubah butuh data lengkap (`SerialDto`), sedangkan baris daftar hanya ringkasan: dimuat saat dibutuhkan. */
  function editRow(serial: SerialSummaryDto) {
    setLoadingEditId(serial.id);
    queryClient
      .fetchQuery({ ...serialDetailQueryOptions(serial.id), staleTime: 0 })
      .then((detail) => setEditing(detail.serial))
      .catch((error: unknown) => toast.error(describeError(error)))
      .finally(() => setLoadingEditId(null));
  }

  const columns: DataColumn<SerialSummaryDto>[] = [
    {
      id: 'serial',
      header: 'Serial',
      mobile: 'title',
      cell: (serial) => (
        <>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-mono">
              <LinkCell to="/serial/$serialId" params={{ serialId: serial.id }} tour="serial-open">
                {serial.serial}
              </LinkCell>
            </span>
            {serial.deleted ? <DeletedBadge /> : null}
          </span>
          {serial.hasProofPhotos || serial.proofProblemCount > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {serial.hasProofPhotos ? <ProofBadge /> : null}
              <ProofProblemBadge count={serial.proofProblemCount} />
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'item',
      header: 'Item',
      cell: (serial) =>
        itemAccess.openItemHref ? (
          <LinkCell to="/item/$itemId" params={{ itemId: serial.itemId }}>
            {serial.itemLabel}
          </LinkCell>
        ) : (
          serial.itemLabel
        ),
    },
    {
      id: 'bu',
      header: 'BU',
      cell: (serial) =>
        canOpenBu ? (
          <LinkCell
            to="/access/business-units/$businessUnitId"
            params={{ businessUnitId: serial.buId }}
          >
            {serial.buCode}
          </LinkCell>
        ) : (
          serial.buCode
        ),
    },
    {
      id: 'location',
      header: 'Lokasi',
      cell: (serial) =>
        canOpenLocation ? (
          <LinkCell to="/access/locations/$locationId" params={{ locationId: serial.locationId }}>
            {serial.locationName}
          </LinkCell>
        ) : (
          serial.locationName
        ),
    },
    { id: 'testDate', header: 'Tanggal uji', cell: (serial) => formatDay(serial.testDate) },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (serial) => serial.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (serial) => (serial.deleted ? formatStamp(serial.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<SerialSummaryDto>[])
      : ([
          {
            id: 'status',
            header: 'Status',
            cell: (serial) => <SerialStatusBadge status={serial.status} />,
          },
          {
            id: 'position',
            header: 'Posisi',
            cell: (serial) => <PositionCell serial={serial} today={today} />,
          },
          { id: 'sample', header: 'Sample', cell: (serial) => (serial.sample ? 'Ya' : '—') },
        ] satisfies DataColumn<SerialSummaryDto>[])),
  ];

  const actions = (serial: SerialSummaryDto): RowAction[] => {
    const name = serial.serial;
    const busy =
      loadingEditId === serial.id ||
      (removeSerials.isPending && removeSerials.variables?.ids.includes(serial.id)) ||
      (restoreSerials.isPending && restoreSerials.variables?.ids.includes(serial.id)) ||
      false;
    if (serial.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${name}`,
          shortLabel: 'Pulihkan',
          hidden: !manageable(serial),
          busy,
          onSelect: () => restoreRow(serial),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${name}`,
        shortLabel: 'Ubah',
        hidden: !editableBuIds.has(serial.buId),
        busy,
        onSelect: () => editRow(serial),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${name}`,
        shortLabel: 'Hapus',
        hidden: !manageable(serial),
        busy,
        onSelect: () => setDeleteTarget({ kind: 'row', serial }),
      },
    ];
  };

  const filtered =
    filter.query !== undefined ||
    filter.serials !== undefined ||
    filter.itemId !== undefined ||
    filter.locationId !== undefined ||
    filter.buId !== undefined ||
    filter.custody !== undefined ||
    filter.createdBy !== undefined ||
    filter.status !== undefined ||
    filter.from !== undefined ||
    filter.to !== undefined ||
    deletedView;
  const countLabel =
    list.isSuccess && (items.length > 0 || filtered)
      ? `${items.length}${list.hasNextPage ? '+' : ''} serial`
      : undefined;

  return (
    <>
      <ListPage
        title="Daftar Serial Number"
        count={countLabel}
        createAction={
          onNew ? { label: 'Tambah Serial Number', onClick: onNew, tour: 'serial-new' } : undefined
        }
        filters={
          <div data-tour="serial-filters">
            <SerialFilters search={search} onChange={onSearchChange} canSeeDeleted={manageAny} />
          </div>
        }
        bulkBar={
          manageAny ? (
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
        <div className="space-y-3" data-tour="serial-table">
          <NoLocationNotice relevant={!canUseSerialLocationOptions(me)} />
          <DataTable
            rows={items}
            rowKey={(serial) => serial.id}
            columns={columns}
            label="Daftar Serial Number"
            rowTo={(serial) => ({ to: '/serial/$serialId', params: { serialId: serial.id } })}
            selectLabel={(serial) => serial.serial}
            selection={manageAny ? selection : undefined}
            rowSelectable={manageable}
            actions={actions}
            empty="Belum ada Serial Number yang tercatat."
            filtered={filtered}
            onClearFilters={() => onSearchChange(CLEAR_FILTERS)}
            isLoading={list.isPending}
            isError={list.isLoadingError}
            onRetry={reload}
            hasMore={list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            loadMoreError={list.isFetchNextPageError}
            onLoadMore={() => void list.fetchNextPage()}
          />
        </div>
      </ListPage>
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="Serial Number"
        usage={DELETE_USAGE}
        onConfirm={confirmDelete}
        busy={remove.busy || removeSerials.isPending}
      />
      {editing ? <EditSerialDialog serial={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** Menghapus semua filter dan pencarian (tampilan Terhapus ikut kembali ke Hidup). */
const CLEAR_FILTERS: Partial<SerialSearch> = {
  sn: undefined,
  item: undefined,
  itemLabel: undefined,
  loc: undefined,
  bu: undefined,
  custody: undefined,
  mine: undefined,
  status: undefined,
  deleted: undefined,
  from: undefined,
  to: undefined,
};
