// Kontrak bersama rute batch atomik dan soft delete (rancangan redesain §6.9, rancangan soft delete §4.3). Murni.

/** Maksimal id per permintaan batch; klien membagi pilihan lebih besar menjadi tahap-tahap. */
export const BATCH_MAX = 100;

/** Masukan batch tanpa versi (hapus, pulihkan, dan rute yang tunggalnya tak memeriksa `updatedAt`). */
export interface IdBatchInput {
  ids: string[];
}

/** Masukan batch untuk model yang rute tunggalnya CAS `updatedAt`. */
export interface VersionedBatchInput {
  items: { id: string; updatedAt: string }[];
}

/** Batch status (rute `setStatus` tunggal hari ini tak membawa `updatedAt`, jadi cukup id). */
export interface StatusBatchInput extends IdBatchInput {
  status: 'active' | 'inactive';
}

/** Hasil batch: record yang berubah (atau sudah berkeadaan sama), urut sesuai masukan. */
export interface BatchResult<T> {
  items: T[];
}

/** Jejak penghapusan pada DTO record terhapus. `deletedAt` = ISO UTC, `deletedBy` = email pelaku. */
export interface SoftDeleteInfo {
  deletedAt: string;
  deletedBy: string;
}

/** Filter status daftar; `deleted` hanya bagi pemegang izin Pulihkan. */
export type ListStatusFilter = 'active' | 'inactive' | 'deleted' | 'all';
