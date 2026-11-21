import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { ListState } from '@/components/page/list-state';
import { Select } from '@/components/select';
import { liveStatusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { customerLinkAccess } from '@/lib/link-access';
import { canAt, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import { readableLocationIds } from '../lib/readable-locations';
import { scopedLocationIds } from '../lib/search';
import { useSendComment } from '../lib/send-comment';
import { useCheckQueue } from '../lib/use-check-queue';
import { usePendingCreates } from '../lib/use-pending-creates';
import { usePendingIds } from '../lib/use-pending-ids';
import {
  handoverKeys,
  useCancelHandover,
  useHandoverBoard,
  useRemoveHandover,
  useReopenHandover,
  useRestoreHandover,
  useSetDone,
} from '../queries';
import { HandoverBoard } from './handover-board';

export interface HandoverBoardPageProps {
  /** Filter daftar kartu ponsel (search param rute). */
  status: HandoverStatus | 'all';
  /** Lokasi dari URL (notifikasi): papan memuat lokasi ini, bukan pilihan lokasi header. */
  locationId?: string;
  /** Hanya task milik customer ini (search param `customer`; keputusan pemilik 2026-11-21). */
  customerId?: string;
  /** Tampilan Terhapus (search param `deleted`): hanya berlaku bagi pemegang `handover: manage`. */
  deleted?: boolean;
  /** Menghapus filter customer (mengganti entri riwayat, bukan menambah). */
  onClearCustomer?: () => void;
  /** Mengubah tampilan Hidup/Terhapus (mengganti entri riwayat). */
  onDeletedChange?: (deleted: boolean) => void;
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
  customerId,
  deleted = false,
  onClearCustomer,
  onDeletedChange,
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
  const board = useHandoverBoard(boardLocations, customerId, deletedView);
  // Nama customer pada chip: dari task yang termuat; tanpa task = label umum (tak ada pembacaan customer lain).
  const customerLabel = customerId
    ? (board.handovers.find((task) => task.customerId === customerId)?.customerName ??
      'Customer terpilih')
    : undefined;
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

  const filtered = Boolean(customerId) || deletedView;
  const clearFilters = () => {
    if (customerId) onClearCustomer?.();
    if (deletedView) onDeletedChange?.(false);
  };
  const viewOptions = liveStatusFilterOptions(canSeeDeleted);

  return (
    <ListPage
      title="Serah Terima"
      pinned={desktop}
      {...(canCreate
        ? { createAction: { label: 'Tambah task', onClick: onCreate, tour: 'handover-new' } }
        : {})}
      filters={
        customerId || viewOptions.length > 0 ? (
          <FilterBar>
            {customerId ? (
              <FilterChip label="Customer" display={customerLabel} onClear={onClearCustomer}>
                <div className="space-y-2 text-sm">
                  <p>Menampilkan task milik customer ini saja.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    color="primary"
                    onClick={onClearCustomer}
                  >
                    Hapus filter
                  </Button>
                </div>
              </FilterChip>
            ) : null}
            {viewOptions.length > 0 ? (
              <FilterChip
                label="Status"
                display={deletedView ? 'Terhapus' : null}
                onClear={() => onDeletedChange?.(false)}
              >
                <Select
                  id="handover-filter-view"
                  label="Filter status"
                  hideLabel
                  options={viewOptions}
                  value={deletedView ? 'deleted' : 'live'}
                  onValueChange={(next) => onDeletedChange?.(next === 'deleted')}
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
