/**
 * Penyambung antara aksi hapus task (modul handover) dan penyimpan papan di perangkat (`app/board-persist.ts`), agar
 * keduanya tak saling mengimpor. Penyimpan mendaftarkan fungsinya saat berjalan; tanpa penyimpan (tes, SSR) memanggil
 * `forgetBoardTask` tidak berbuat apa-apa.
 */
type Forgetter = (id: string) => Promise<void>;

let forgetter: Forgetter | null = null;

/** Dipanggil penyimpan papan saat mulai (dan `null` saat berhenti). */
export function setBoardTaskForgetter(next: Forgetter | null): void {
  forgetter = next;
}

/**
 * Membuang task `id` dari snapshot IndexedDB (rekaman detail dan butirnya di rekaman kolom). Dipanggil setelah task
 * dihapus (soft delete) dan saat server menolak detail (task sudah tak ada); tidak pernah menolak.
 */
export function forgetBoardTask(id: string): void {
  if (forgetter) void forgetter(id).catch(() => undefined);
}
