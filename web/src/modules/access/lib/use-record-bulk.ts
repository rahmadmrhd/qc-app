import { useBulkAction } from '@/components/data-table/use-bulk-action';
import type { RowSelection } from '@/components/data-table/use-row-selection';

export interface RecordBulkOptions {
  selection: RowSelection;
  /** Sebutan pada toast: "N {subject} dihapus". */
  subject: string;
  /** Baris yang sedang tampil (untuk menentukan id yang benar-benar berubah pada Urungkan). */
  rows: readonly { id: string; status?: 'active' | 'inactive' }[];
  /** Tanpa ini (model tanpa status, mis. Role) aksi Aktifkan/Nonaktifkan tak berjalan. */
  setStatusBatch?: (input: {
    ids: string[];
    status: 'active' | 'inactive';
  }) => Promise<{ items: readonly unknown[] }>;
  removeBatch: (input: { ids: string[] }) => Promise<{ ids: readonly string[] }>;
  restoreBatch: (input: { ids: string[] }) => Promise<{ items: readonly unknown[] }>;
  reload: () => void;
}

/**
 * Aksi massal halaman daftar ber-soft-delete (Pengguna, Role, Lokasi, BU, Customer): Aktifkan, Nonaktifkan, Hapus
 * (Urungkan = Pulihkan), dan Pulihkan. Pola yang sama dengan halaman Merk; kirim bertahap lewat `useBulkAction`.
 */
export function useRecordBulk({
  selection,
  subject,
  rows,
  setStatusBatch,
  removeBatch,
  restoreBatch,
  reload,
}: RecordBulkOptions) {
  const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
  /** Id terpilih yang memenuhi `changes` (mis. belum Aktif): hanya itu yang dibalik oleh Urungkan. */
  const changedIds = (
    ids: string[],
    changes: (status: 'active' | 'inactive' | undefined) => boolean,
  ) => ids.filter((id) => changes(statusOf(id)));
  const sendStatus = (ids: string[], status: 'active' | 'inactive') =>
    setStatusBatch ? setStatusBatch({ ids, status }).then((r) => r.items) : Promise.resolve([]);

  const activate = useBulkAction({
    selection,
    subject,
    verb: 'diaktifkan',
    send: (ids) => sendStatus(ids, 'active'),
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
    reload,
  });
  return {
    activate,
    deactivate,
    remove,
    restore,
    busy: activate.busy || deactivate.busy || remove.busy || restore.busy,
  };
}
