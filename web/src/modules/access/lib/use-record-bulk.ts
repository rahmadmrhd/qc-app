import { useBulkAction } from '@/components/data-table/use-bulk-action';
import type { RowSelection } from '@/components/data-table/use-row-selection';

export interface RecordBulkRow {
  id: string;
  status?: 'active' | 'inactive';
}

export interface RecordBulkOptions<R extends RecordBulkRow = RecordBulkRow> {
  selection: RowSelection;
  /** Sebutan pada toast: "N {subject} dihapus". */
  subject: string;
  /** Baris yang sedang tampil: dasar syarat aksi per baris dan penentu id yang berubah pada Urungkan. */
  rows: readonly R[];
  /** Tanpa ini (model tanpa status, mis. Role) aksi Aktifkan/Nonaktifkan tak berjalan. */
  setStatusBatch?: (input: {
    ids: string[];
    status: 'active' | 'inactive';
  }) => Promise<{ items: readonly unknown[] }>;
  removeBatch: (input: { ids: string[] }) => Promise<{ ids: readonly string[] }>;
  restoreBatch: (input: { ids: string[] }) => Promise<{ items: readonly unknown[] }>;
  reload: () => void;
  /** Syarat tambahan Nonaktifkan bagi baris Aktif (mis. akun sendiri dan super admin tak boleh). Bawaan: boleh. */
  canDeactivate?: (row: R) => boolean;
  /**
   * Syarat tambahan Hapus (mis. role yang masih dipakai tak boleh dihapus). Model ber-status juga mensyaratkan
   * Nonaktif (aturan server); model tanpa status tidak. Bawaan: boleh.
   */
  canDelete?: (row: R) => boolean;
}

/**
 * Aksi massal halaman daftar ber-soft-delete (Pengguna, Role, Lokasi, BU, Customer): Aktifkan, Nonaktifkan, Hapus
 * (Urungkan = Pulihkan), dan Pulihkan. Pola yang sama dengan halaman Merk; kirim bertahap lewat `useBulkAction`.
 *
 * Keputusan pemilik 2026-11-23: tombol aksi tampil bila minimal satu baris terpilih memenuhi syaratnya
 * (`eligibleCount > 0`) dan yang dikirim hanya baris itu. `isEligible` mengekspos syarat yang sama per id untuk
 * hitungan di dialog konfirmasi.
 */
export function useRecordBulk<R extends RecordBulkRow = RecordBulkRow>({
  selection,
  subject,
  rows,
  setStatusBatch,
  removeBatch,
  restoreBatch,
  reload,
  canDeactivate,
  canDelete,
}: RecordBulkOptions<R>) {
  const rowOf = (id: string) => rows.find((row) => row.id === id);
  const statusOf = (id: string) => rowOf(id)?.status;
  /** Id terpilih yang memenuhi `changes` (mis. belum Aktif): hanya itu yang dibalik oleh Urungkan. */
  const changedIds = (
    ids: string[],
    changes: (status: 'active' | 'inactive' | undefined) => boolean,
  ) => ids.filter((id) => changes(statusOf(id)));
  const sendStatus = (ids: string[], status: 'active' | 'inactive') =>
    setStatusBatch ? setStatusBatch({ ids, status }).then((r) => r.items) : Promise.resolve([]);

  const isEligible = {
    activate: (id: string) => !!setStatusBatch && statusOf(id) === 'inactive',
    deactivate: (id: string) => {
      const row = rowOf(id);
      return !!setStatusBatch && !!row && row.status === 'active' && (canDeactivate?.(row) ?? true);
    },
    remove: (id: string) => {
      const row = rowOf(id);
      if (!row) return false;
      if (setStatusBatch && row.status !== 'inactive') return false;
      return canDelete?.(row) ?? true;
    },
    restore: (id: string) => rowOf(id) !== undefined,
  };

  const activate = useBulkAction({
    selection,
    subject,
    verb: 'diaktifkan',
    send: (ids) => sendStatus(ids, 'active'),
    eligible: isEligible.activate,
    undo: {
      changed: (ids) => changedIds(ids, (status) => status !== 'active'),
      run: (ids) => sendStatus(ids, 'inactive'),
    },
    reload,
  });
  const deactivate = useBulkAction({
    selection,
    subject,
    verb: 'dinonaktifkan',
    send: (ids) => sendStatus(ids, 'inactive'),
    eligible: isEligible.deactivate,
    undo: {
      changed: (ids) => changedIds(ids, (status) => status !== 'inactive'),
      run: (ids) => sendStatus(ids, 'active'),
    },
    reload,
  });
  const remove = useBulkAction({
    selection,
    subject,
    verb: 'dihapus',
    send: (ids) => removeBatch({ ids }).then((r) => r.ids),
    eligible: isEligible.remove,
    undo: {
      label: 'Pulihkan',
      run: (ids) => restoreBatch({ ids }).then((r) => r.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject,
    verb: 'dipulihkan',
    send: (ids) => restoreBatch({ ids }).then((r) => r.items),
    eligible: isEligible.restore,
    reload,
  });
  return {
    activate,
    deactivate,
    remove,
    restore,
    isEligible,
    busy: activate.busy || deactivate.busy || remove.busy || restore.busy,
  };
}
