import type { SerialDto, SerialSummaryDto } from '@shared/contract';
import { resolveAction } from '@shared/serial-flow';
import { useInfiniteQuery } from '@tanstack/react-query';
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
import { DisabledReason } from '@/components/disabled-reason';
import { ListPage } from '@/components/page/list-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { businessUnitLinkAccess, itemLinkAccess, locationLinkAccess } from '@/lib/link-access';
import {
  buIdsWithLevelOf,
  canManageAnySerial,
  canManageSerial,
  canReportSerials,
  canUseSerialLocationOptions,
  serialActorModules,
} from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { pendingSummary, usePendingApplyStickers } from '../lib/apply-stickers-intent';
import { CUSTODY_LABEL, formatDay } from '../lib/labels';
import { filterOfSearch, type SerialSearch } from '../lib/list-filter';
import { todayWib } from '../lib/locations';
import { groupSerialsByItemBu, stickerGroupsBlocker } from '../lib/sticker-groups';
import { daysBetweenDates } from '../lib/transit';
import { useLoadSerialDetail } from '../lib/use-load-serial-detail';
import { serialListQueryOptions, useRemoveSerials, useRestoreSerials } from '../queries';
import { type ActKind, canReportDamage } from './act-buttons';
import { ActDialog } from './act-dialog';
import { ApplyStickersDialog } from './apply-stickers-dialog';
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
 * Aksi baris: Lapor rusak (bila serial Lolos di QC dan pengguna `serial: edit`), Ubah, Hapus/Pulihkan. Checkbox tersedia
 * bagi pemegang `serial: edit` (Tempel stiker massal) atau `manage` (Hapus/Pulihkan massal; tanpa ubah massal, keputusan
 * 13): "Tempel stiker" tampil hanya bila SEMUA serial terpilih dapat ditempeli dan "Hapus" hanya bila semuanya dapat
 * dikelola. Tampilan Terhapus lewat pilihan "Terhapus" pada chip Status. Filter ada di URL; di ponsel baris menjadi kartu.
 */
export function SerialListPage({ search, onSearchChange, onNew }: SerialListPageProps) {
  const me = useMe();
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
  const [acting, setActing] = useState<{ serial: SerialDto; kind: ActKind } | null>(null);
  const [stickering, setStickering] = useState<SerialSummaryDto[] | null>(null);
  // Niat Tempel stiker yang hasilnya belum jelas: store tingkat modul per email (bukan state dialog atau halaman), jadi id idempoten selamat dari tutup-buka dan pindah halaman.
  const [pendingStickers, setPendingStickers] = usePendingApplyStickers(me.email);
  const detailLoader = useLoadSerialDetail();

  const itemAccess = itemLinkAccess(me);
  const canOpenBu = businessUnitLinkAccess(me).openBusinessUnitHref !== undefined;
  const canOpenLocation = locationLinkAccess(me).openLocationHref !== undefined;
  const editableBuIds = new Set(buIdsWithLevelOf(me, 'serial', 'edit'));
  // Hanya baris yang boleh dikelola pemanggil yang dapat dipilih: satu id di luar hak membuat seluruh tahap
  // `NOT_FOUND` di server. Hak penuh = `serial: manage` pada SEMUA BU riwayat, dihitung server (`canManage`); tanpa
  // field itu (balasan pulihkan, server lama) jatuh ke BU saat ini saja. Server tetap yang berwenang.
  const manageable = (serial: SerialSummaryDto) =>
    serial.canManage ?? canManageSerial(me, [serial.buId]);
  // Dapat ditempeli stiker: tabel transisi (status, posisi, hak edit di BU serial) dan bukan tampilan Terhapus.
  const stickable = (serial: SerialSummaryDto) =>
    !deletedView &&
    serial.deleted === undefined &&
    'row' in
      resolveAction(
        'apply_stickers',
        { status: serial.status, custody: serial.custody },
        serialActorModules(me, serial.buId),
      );
  // Pilihan baris: pemegang edit (Tempel stiker) atau manage (Hapus/Pulihkan).
  const canSelect = manageAny || canReportSerials(me);
  const selectedRows = items.filter((serial) => selection.selected.has(serial.id));
  const allStickable = selectedRows.length > 0 && selectedRows.every(stickable);
  const allManageable = selectedRows.length > 0 && selectedRows.every(manageable);
  const stickerBlocker = stickerGroupsBlocker(groupSerialsByItemBu(selectedRows).length);

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

  /** Dialog Ubah dan aksi alur butuh data lengkap (`SerialDto`), sedangkan baris daftar hanya ringkasan: dimuat saat dibutuhkan. */
  function editRow(serial: SerialSummaryDto) {
    void detailLoader.load(serial.id).then((detail) => detail && setEditing(detail));
  }

  function actRow(serial: SerialSummaryDto, kind: ActKind) {
    void detailLoader
      .load(serial.id)
      .then((detail) => detail && setActing({ serial: detail, kind }));
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
      detailLoader.loadingId === serial.id ||
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
        // Sebelum Ubah; tampil hanya bila `report_failure` tersedia menurut tabel transisi (Lolos di QC, hak edit).
        id: 'report',
        action: 'reportDamage',
        label: `Lapor rusak ${name}`,
        shortLabel: 'Lapor rusak',
        hidden: !canReportDamage(
          { status: serial.status, custody: serial.custody },
          serialActorModules(me, serial.buId),
        ),
        busy,
        onSelect: () => actRow(serial, 'report'),
      },
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
    filter.itemIds !== undefined ||
    filter.locationIds !== undefined ||
    filter.buIds !== undefined ||
    filter.custodies !== undefined ||
    filter.createdBy !== undefined ||
    filter.statuses !== undefined ||
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
          canSelect ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                allManageable ? (
                  <ActionButton action="restore" onClick={() => void restore.run()} />
                ) : null
              ) : (
                <>
                  {allStickable ? (
                    <DisabledReason reason={stickerBlocker}>
                      <ActionButton
                        action="stickers"
                        disabled={stickerBlocker !== undefined}
                        onClick={() => setStickering(selectedRows)}
                      />
                    </DisabledReason>
                  ) : null}
                  {allManageable ? (
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
        <div className="space-y-3" data-tour="serial-table">
          <NoLocationNotice relevant={!canUseSerialLocationOptions(me)} />
          {pendingStickers && !stickering ? (
            <Alert color="warning">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Kiriman Tempel stiker sebelumnya ({pendingSummary(pendingStickers)}; bukan pilihan
                  saat ini) belum jelas hasilnya. Kirim ulang persis sama agar stok tidak terpotong
                  dua kali.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  color="warning"
                  onClick={() => setStickering(selectedRows)}
                >
                  Kirim ulang
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <DataTable
            rows={items}
            rowKey={(serial) => serial.id}
            columns={columns}
            label="Daftar Serial Number"
            rowTo={(serial) => ({ to: '/serial/$serialId', params: { serialId: serial.id } })}
            selectLabel={(serial) => serial.serial}
            selection={canSelect ? selection : undefined}
            rowSelectable={(serial) => manageable(serial) || stickable(serial)}
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
      {acting ? (
        <ActDialog serial={acting.serial} kind={acting.kind} onClose={() => setActing(null)} />
      ) : null}
      {stickering ? (
        <ApplyStickersDialog
          rows={stickering}
          pending={pendingStickers}
          onPendingChange={setPendingStickers}
          onClose={() => setStickering(null)}
          onDone={(ids) => selection.remove(ids)}
        />
      ) : null}
    </>
  );
}

/** Menghapus semua filter dan pencarian (tampilan Terhapus ikut kembali ke Hidup). */
const CLEAR_FILTERS: Partial<SerialSearch> = {
  sn: undefined,
  itemIds: undefined,
  locationIds: undefined,
  buIds: undefined,
  custodies: undefined,
  statuses: undefined,
  // Param tunggal lama (tautan) ikut dibuang.
  item: undefined,
  itemLabel: undefined,
  loc: undefined,
  bu: undefined,
  custody: undefined,
  status: undefined,
  mine: undefined,
  deleted: undefined,
  from: undefined,
  to: undefined,
};
