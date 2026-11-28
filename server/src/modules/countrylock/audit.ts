import type { ClFileRecord, ClRevisionRecord } from './repo';

/** Snapshot audit satu berkas: metadata revisi saja (isi teks tidak disalin ke log; riwayat isi ada di `cl_revisions`). */
export interface ClFileSnapshot {
  path: string;
  role: string;
  seq: number;
  sha256: string;
  size: number;
}

export function clFileSnapshot(
  file: Pick<ClFileRecord, 'path' | 'role'>,
  revision: Pick<ClRevisionRecord, 'seq' | 'sha256' | 'size'>,
): ClFileSnapshot {
  return {
    path: file.path,
    role: file.role,
    seq: revision.seq,
    sha256: revision.sha256,
    size: revision.size,
  };
}
