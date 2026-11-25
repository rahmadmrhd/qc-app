/**
 * Daftar penerima surel yang dapat dikonfigurasi (keputusan pemilik 2026-11-25): Kepada (To), Tembusan (CC), dan
 * Tembusan tersembunyi (BCC). Murni (dipakai server dan web). Kunci `recipients` dipertahankan untuk daftar To agar
 * kontrak lama tetap berlaku; `cc` dan `bcc` ditambahkan sebagai kolom opsional di kabel (server mengisinya `[]`).
 */
export const MAIL_LIST_FIELDS = ['recipients', 'cc', 'bcc'] as const;
export type MailListField = (typeof MAIL_LIST_FIELDS)[number];

export interface MailLists {
  recipients: string[];
  cc: string[];
  bcc: string[];
}

export const MAIL_LIST_LABELS: Record<MailListField, string> = {
  recipients: 'Kepada (To)',
  cc: 'Tembusan (CC)',
  bcc: 'Tembusan tersembunyi (BCC)',
};

export function emptyMailLists(): MailLists {
  return { recipients: [], cc: [], bcc: [] };
}

/** Jumlah seluruh alamat di ketiga daftar. */
export function mailListsCount(lists: Pick<MailLists, 'recipients' | 'cc' | 'bcc'>): number {
  return lists.recipients.length + lists.cc.length + lists.bcc.length;
}

/** Bentuk daftar dari objek apa pun yang punya (sebagian dari) ketiga kunci; kunci hilang = `[]`. */
export function mailListsOf(source: Partial<MailLists>): MailLists {
  return {
    recipients: [...(source.recipients ?? [])],
    cc: [...(source.cc ?? [])],
    bcc: [...(source.bcc ?? [])],
  };
}

/** Sama-isi (urutan diabaikan) pada ketiga daftar; dipakai penanda "ada perubahan" di form. */
export function sameMailLists(a: MailLists, b: MailLists): boolean {
  return MAIL_LIST_FIELDS.every((field) => {
    const left = [...a[field]].sort();
    const right = [...b[field]].sort();
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  });
}
