import type { PostelNumberRecord, PostelRecord } from './repo';

/** Target audit catatan Postel (`postel:<id>`): dasar riwayat per catatan (indeks `audit_log_target_ts`). */
export function postelTarget(id: string): string {
  return `postel:${id}`;
}

export interface PostelSnapshot {
  note: string;
  /** `"<nomor> | <expiresOn> | <link>"`, urut `seq`. */
  numbers: string[];
  items: number;
  attachments: number;
}

/**
 * Snapshot datar untuk audit (`before`/`after`): isi bisnis catatan; item dan lampiran hanya jumlahnya (identitas item
 * di luar BU pembaca tidak boleh bocor lewat riwayat).
 */
export function postelSnapshot(
  record: Pick<PostelRecord, 'note'>,
  numbers: readonly Pick<PostelNumberRecord, 'number' | 'expiresOn' | 'link' | 'seq'>[],
  itemCount: number,
  attachmentCount: number,
): PostelSnapshot {
  return {
    note: record.note,
    numbers: [...numbers]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => `${entry.number} | ${entry.expiresOn} | ${entry.link}`),
    items: itemCount,
    attachments: attachmentCount,
  };
}
