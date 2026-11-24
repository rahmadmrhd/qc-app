import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LinkMultiField } from '@/components/link-field';
import { FilterBar, FilterChip, multiFilterDisplay } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { ListState } from '@/components/page/list-state';
import { Select } from '@/components/select';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { customerLinkAccess } from '@/lib/link-access';
import { canAt, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { BOARD_STATUSES } from '../lib/group-board';
import { readableLocationIds } from '../lib/readable-locations';
import { scopedLocationIds } from '../lib/search';
import { useSendComment } from '../lib/send-comment';
import { HANDOVER_STATUS_LABELS } from '../lib/status';
import { useCheckQueue } from '../lib/use-check-queue';
import { usePendingCreates } from '../lib/use-pending-creates';
import { usePendingIds } from '../lib/use-pending-ids';
import {
  handoverKeys,
  handoverOptionsQueryOptions,
  useCancelHandover,
  useHandoverBoard,
  useRemoveHandover,
  useReopenHandover,
  useRestoreHandover,
  useSetDone,
} from '../queries';
import { HandoverBoard } from './handover-board';

/** Perubahan tampilan papan yang diterapkan SEKALIGUS (satu navigasi): bagian yang tak disebut tetap seperti URL. */
export interface HandoverViewPatch {
  status?: HandoverStatus | 'all';
  deleted?: boolean;
  customers?: string[];
}

export interface HandoverBoardPageProps {
  /** Filter daftar kartu ponsel (search param rute). */
  status: HandoverStatus | 'all';
  /** Lokasi dari URL (notifikasi): papan memuat lokasi ini, bukan pilihan lokasi header. */
  locationId?: string;
  /** Hanya task milik salah satu customer ini (search param `customers`; kosong = semua customer). */
  customerIds?: readonly string[];
  /** Tampilan Terhapus (search param `deleted`): hanya berlaku bagi pemegang `handover: manage`. */
  deleted?: boolean;
  /** Mengganti daftar customer yang disaring (mengganti entri riwayat, bukan menambah); kosong = hapus filter. */
  onCustomersChange?: (customerIds: string[]) => void;
  /**
   * Mengubah status, tampilan Hidup/Terhapus, dan/atau customer dalam SATU navigasi (mengganti entri riwayat). Dua
   * navigasi beruntun membaca search yang sama-sama basi, jadi yang kedua menimpa yang pertama.
   */
  onViewChange: (patch: HandoverViewPatch) => void;
  onStatusChange: (status: HandoverStatus | 'all') => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

/**
 * Halaman board (kit `ListPage`): satu permintaan berkursor `handovers.board` per kolom (4 paralel) untuk lokasi
 * terpilih yang boleh dibaca. Tampilan Terhapus (chip, bagi `handover: manage`) memuat task terhapus dari lokasi
 * ber-manage dan membuat kartu hanya-baca dengan aksi Pulihkan.
 */
export function HandoverBoardPage({
  status,
  locationId,
  customerIds = [],
  deleted = false,
  onCustomersChange,
  onViewChange,
  onStatusChange,
  onOpen,
  onEdit,
  onCreate,
}: HandoverBoardPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = readableLocationIds(me, scopedLocationIds(locationId, selectedIds));
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  // Tampilan Terhapus hanya bila ada lokasi terbaca ber-manage; `?deleted` dari URL diabaikan bila tidak (server menolak).
  const manageIds = locationsWith(me, 'handover', 'manage', readable).map(
    (location) => location.id,
  );
  const canSeeDeleted = manageIds.length > 0;
  const deletedView = deleted && canSeeDeleted;
  const boardLocations = deletedView ? manageIds : readable;
  const board = useHandoverBoard(boardLocations, customerIds, deletedView);
  // Nama customer pada chip: dari task yang termuat, lalu daftar customer lokasi (dimuat hanya bila ada filter customer
  // atau chip dibuka), selain itu label umum.
  const options = useQuery({
    ...handoverOptionsQueryOptions(readable),
    enabled: readable.length > 0 && customerIds.length > 0,
  });
  const customerLabel = (id: string) =>
    board.handovers.find((task) => task.customerId === id)?.customerName ??
    options.data?.customers?.find((customer) => customer.id === id)?.name ??
    'Customer terpilih';
  const setDone = useSetDone();
  const cancel = useCancelHandover();
  const reopen = useReopenHandover();
  const remove = useRemoveHandover();
  const restore = useRestoreHandover();
  const sendComment = useSendComment(me.email);
  const { isPending, track } = usePendingIds();
  // Task baru yang masih di antrean perangkat (hanya lokasi terpilih): kartu sementara di kolom Baru. Tidak di tampilan
  // Terhapus.
  const pendingCreates = usePendingCreates(me.email, readable).flatMap((entry) =>
    deletedView
      ? []
      : entry.tasks.map((task) => ({
          key: `${entry.id}:${task.clientId}`,
          customerName: task.customerName,
          note: task.note,
          status: entry.status,
        })),
  );
  // Centang instan + antrean serial per task; aksi lain menunggu antrean centang task itu kosong.
  const checks = useCheckQueue(me.email);
  const locationNames = new Map(me.locations.map((location) => [location.id, location.name]));

  // Gagal (mis. CONFLICT karena catatan berubah): tampilkan pesan dan muat ulang papan agar tidak basi.
  const onError = (error: unknown) => {
    toast.error(describeError(error));
    void queryClient.invalidateQueries({ queryKey: handoverKeys.boards });
  };

  // Mutasi dilacak per task: hanya kartu yang sedang diproses yang dinonaktifkan.
  const run = (id: string, action: () => Promise<unknown>, onSuccess?: () => void) =>
    void track(id, action).then(onSuccess, onError);

  const bindings = (handover: HandoverDto) => {
    const ref = { id: handover.id, locationId: handover.locationId };
    return {
      owner: me.email,
      canMarkDone: canAt(me, 'qc', 'edit', handover.locationId),
      canEdit: canAt(me, 'handover', 'edit', handover.locationId),
      canCancel: canAt(me, 'handover', 'manage', handover.locationId),
      canDelete: canAt(me, 'handover', 'manage', handover.locationId),
      pending: isPending(handover.id),
      locationName: readable.length > 1 ? locationNames.get(handover.locationId) : undefined,
      canOpenCustomer: customerLinkAccess(me).openCustomerHref !== undefined,
      onOpen: () => onOpen(handover.id),
      onCheck: (item: { index: number; text: string }, checked: boolean) =>
        checks.toggle(ref, item, checked),
      saving: checks.isSaving(handover.id),
      onMarkDone: () =>
        run(handover.id, async () => {
          await checks.whenIdle(handover.id);
          return setDone.mutateAsync(ref);
        }),
      onReopen: () =>
        run(
          handover.id,
          async () => {
            await checks.whenIdle(handover.id);
            return reopen.mutateAsync(ref);
          },
          () => toast.success('Task dibuka kembali'),
        ),
      onEdit: () => onEdit(handover.id),
      onCancel: () =>
        run(
          handover.id,
          async () => {
            await checks.whenIdle(handover.id);
            return cancel.mutateAsync(ref);
          },
          () => toast.success('Task dibatalkan'),
        ),
      onDelete: () =>
        run(
          handover.id,
          async () => {
            await checks.whenIdle(handover.id);
            return remove.mutateAsync(ref);
          },
          () =>
            toast.success('Dihapus', {
              action: {
                label: 'Pulihkan',
                // `mutateAsync` di closure: aksi toast dapat berjalan setelah kartu ini dilepas dari papan.
                onClick: () =>
                  void restore.mutateAsync(ref).then(
                    () => toast.success('Task dipulihkan'),
                    (error: unknown) => toast.error(describeError(error)),
                  ),
              },
            }),
        ),
      onRestore: () =>
        run(
          handover.id,
          () => restore.mutateAsync(ref),
          () => toast.success('Task dipulihkan'),
        ),
      // Galat komentar ditampilkan oleh composer (draf dipertahankan), jadi dilempar kembali.
      onComment: async (input: { quote: string; before: string; after: string; body: string }) => {
        await track(handover.id, () => sendComment({ ...ref, ...input }));
      },
    };
  };

  // Ponsel menampilkan daftar kartu yang disaring menurut status alur; di desktop kolom kanban sudah per status.
  const statusFiltered = !desktop && status !== 'all' && !deletedView;
  const filtered = customerIds.length > 0 || deletedView || statusFiltered;
  const clearFilters = () => {
    const patch: HandoverViewPatch = {};
    if (customerIds.length > 0) patch.customers = [];
    if (deletedView) patch.deleted = false;
    if (statusFiltered) patch.status = 'all';
    if (Object.keys(patch).length > 0) onViewChange(patch);
  };
  // Satu chip "Status": di ponsel memuat status alur + "Terhapus" (eksklusif: Terhapus menampilkan task terhapus apa
  // pun statusnya), di desktop hanya Hidup/Terhapus.
  const statusOptions = desktop
    ? liveStatusFilterOptions(canSeeDeleted)
    : [
        { value: 'all', label: 'Semua' },
        ...BOARD_STATUSES.map((value) => ({ value, label: HANDOVER_STATUS_LABELS[value] })),
        ...(canSeeDeleted ? [{ value: 'deleted', label: 'Terhapus' }] : []),
      ];
  const statusValue = deletedView ? 'deleted' : desktop ? 'live' : status;
  const statusDisplay = deletedView
    ? 'Terhapus'
    : statusFiltered
      ? HANDOVER_STATUS_LABELS[status as HandoverStatus]
      : null;
  const changeStatus = (next: string) => {
    if (next === 'deleted') {
      onViewChange(desktop ? { deleted: true } : { deleted: true, status: 'all' });
      return;
    }
    const patch: HandoverViewPatch = {};
    if (deletedView) patch.deleted = false;
    if (!desktop && next !== 'live') patch.status = next as HandoverStatus | 'all';
    if (Object.keys(patch).length > 0) onViewChange(patch);
  };

  return (
    <ListPage
      title="Serah Terima"
      pinned={desktop}
      {...(canCreate
        ? { createAction: { label: 'Tambah task', onClick: onCreate, tour: 'handover-new' } }
        : {})}
      filters={
        customerIds.length > 0 || onCustomersChange || statusOptions.length > 0 ? (
          <FilterBar>
            {onCustomersChange || customerIds.length > 0 ? (
              <FilterChip
                label="Customer"
                display={multiFilterDisplay(customerIds.map(customerLabel))}
                onClear={() => onCustomersChange?.([])}
              >
                <CustomerFilterField
                  locationIds={readable}
                  value={customerIds}
                  labelOf={customerLabel}
                  onChange={(next) => onCustomersChange?.(next)}
                />
              </FilterChip>
            ) : null}
            {statusOptions.length > 0 ? (
              <FilterChip
                label="Status"
                display={statusDisplay}
                onClear={() => {
                  const patch: HandoverViewPatch = {};
                  if (deletedView) patch.deleted = false;
                  if (!desktop) patch.status = 'all';
                  if (Object.keys(patch).length > 0) onViewChange(patch);
                }}
              >
                <Select
                  id="handover-filter-view"
                  label="Filter status"
                  hideLabel
                  options={statusOptions}
                  value={statusValue}
                  onValueChange={changeStatus}
                />
              </FilterChip>
            ) : null}
          </FilterBar>
        ) : undefined
      }
    >
      <div data-tour="handover-board" className="space-y-3">
        <NoLocationNotice />
        {readable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
          </p>
        ) : board.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ListState
            isError={board.isError}
            onRetry={board.refetch}
            errorText="Gagal memuat task. Coba muat ulang."
            // Galat satu kolom menggantikan papan (pesan + Coba lagi), seperti sebelumnya.
            isEmpty={board.isError || (board.handovers.length === 0 && pendingCreates.length === 0)}
            filtered={filtered}
            onClearFilters={clearFilters}
            empty={
              deletedView
                ? 'Belum ada task terhapus di lokasi ini.'
                : 'Belum ada task serah terima di lokasi ini.'
            }
          >
            <HandoverBoard
              handovers={board.handovers}
              columns={board.columns}
              filter={status}
              onFilterChange={onStatusChange}
              bindings={bindings}
              pendingCreates={pendingCreates}
            />
          </ListState>
        )}
      </div>
    </ListPage>
  );
}

/**
 * Pilih customer untuk menyaring papan (banyak nilai = salah satu dari). Daftar customer lokasi yang terbaca dimuat
 * saat chip dibuka (`handovers.options`, disaring di klien); tanpa daftar (ditolak/gagal) isinya hanya chip terpilih.
 */
function CustomerFilterField({
  locationIds,
  value,
  labelOf,
  onChange,
}: {
  locationIds: readonly string[];
  value: readonly string[];
  labelOf: (id: string) => string;
  onChange: (ids: string[]) => void;
}) {
  const options = useQuery({
    ...handoverOptionsQueryOptions(locationIds),
    enabled: locationIds.length > 0,
    retry: false,
  });
  const list = (options.data?.customers ?? []).map((customer) => ({
    id: customer.id,
    label: customer.name,
  }));
  return (
    <LinkMultiField
      maxSelected={FILTER_LIST_MAX}
      id="handover-filter-customer"
      label="Filter customer"
      hideLabel
      placeholder="Semua customer"
      localFilter
      highlight
      loading={options.isPending && locationIds.length > 0}
      value={value}
      labelOf={labelOf}
      options={list}
      onChange={onChange}
    />
  );
}
