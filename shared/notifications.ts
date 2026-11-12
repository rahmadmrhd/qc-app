import type { HandoverStatus } from './handover';

// Aturan murni notifikasi Serah Terima (spek 2026-11-12-notifikasi-serah-terima-design.md). Tanpa API runtime/DOM.

/** Jenis kejadian notifikasi (spek §3). `createdBatch` = ringkasan satu permintaan `saveBatch` (§4.3). */
export const NOTIFICATION_KINDS = [
  'created',
  'createdBatch',
  'updated',
  'cancelled',
  'reopened',
  'done',
  'checked',
  'commented',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Sisi penerima: `qc` = `qc: edit`, `wh` = `handover: view` ke atas, `all` = salah satunya (di lokasi task). */
export type NotificationSide = 'qc' | 'wh' | 'all';

export const NOTIFICATION_SIDE: Record<NotificationKind, NotificationSide> = {
  created: 'qc',
  createdBatch: 'qc',
  updated: 'qc',
  cancelled: 'qc',
  reopened: 'qc',
  done: 'wh',
  checked: 'wh',
  commented: 'all',
};

/** Jendela penggabungan centang: tetap 5 menit sejak centang pertama dalam rangkaian (spek §4.2). */
export const CHECK_WINDOW_MS = 300_000;
/** Umur penyimpanan notifikasi sebelum dibersihkan (hari; pilihan perancang, spek §5.1 dan §10). */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** Panjang maksimum cuplikan teks (catatan atau komentar) pada notifikasi lonceng. */
export const NOTIFICATION_PREVIEW_MAX = 140;

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  /** Kosong untuk `createdBatch`. */
  handoverId: string;
  locationId: string;
  /** Nomor task `ST-...`; kosong untuk `createdBatch`. */
  number: string;
  customerName: string;
  /** Nama pelaku. */
  actor: string;
  /** Jumlah butir (`checked`) atau jumlah task (`createdBatch`); selain itu 0. */
  count: number;
  /** Cuplikan teks untuk lonceng saja; TIDAK dikirim lewat push. */
  preview: string;
  createdAt: string;
  /** Kosong = belum dibaca. */
  readAt: string;
}

/** Judul notifikasi (Indonesia), dipakai lonceng dan push. */
export function notificationTitle(
  n: Pick<NotificationDto, 'kind' | 'actor' | 'number' | 'count'>,
): string {
  switch (n.kind) {
    case 'created':
      return `${n.actor} membuat task ${n.number}`;
    case 'createdBatch':
      return `${n.actor} membuat ${n.count} task baru`;
    case 'updated':
      return `${n.actor} mengubah task ${n.number}`;
    case 'cancelled':
      return `${n.actor} membatalkan task ${n.number}`;
    case 'reopened':
      return `${n.actor} membuka kembali task ${n.number}`;
    case 'done':
      return `${n.actor} menyelesaikan task ${n.number}`;
    case 'checked':
      return `${n.actor} memperbarui ${n.count} butir di ${n.number}`;
    case 'commented':
      return `${n.actor} mengomentari task ${n.number}`;
  }
}

/** Keadaan task yang relevan bagi penentuan kejadian; `status` = status TURUNAN (`deriveHandoverStatus`). */
export interface HandoverSnap {
  status: HandoverStatus;
  customerId: string;
  note: string;
}

export type HandoverAction = 'create' | 'save' | 'check' | 'done' | 'cancel' | 'reopen' | 'comment';

/**
 * Kejadian yang dihasilkan satu penulisan, dihitung dari keadaan sebelum dan sesudah (spek §4.4), bukan dari
 * endpoint. `before` null hanya untuk `create`; pada aksi lain `before` null berarti tak ada pembanding, sehingga
 * tidak ada kejadian (konservatif: tanpa perubahan keadaan nyata tak ada notifikasi, A4).
 *  - "Task selesai" = status turunan berubah menjadi Selesai, apa pun penyebabnya; mengalahkan "centang" (A2).
 *  - "Dibuka kembali" hanya `reopen`; task Selesai yang berjalan lagi lewat centang tetap `checked`.
 *  - "Diubah" = customer atau catatan berbeda (butir checklist adalah baris catatan).
 */
export function handoverEventsOf(
  action: HandoverAction,
  before: HandoverSnap | null,
  after: HandoverSnap,
): NotificationKind[] {
  if (action === 'create') return ['created'];
  if (before === null) return [];
  const becameDone = before.status !== 'done' && after.status === 'done';
  switch (action) {
    case 'save': {
      const events: NotificationKind[] = [];
      if (before.customerId !== after.customerId || before.note !== after.note) {
        events.push('updated');
      }
      if (becameDone) events.push('done');
      return events;
    }
    case 'check':
      return becameDone ? ['done'] : ['checked'];
    case 'done':
      return becameDone ? ['done'] : [];
    case 'cancel':
      return ['cancelled'];
    case 'reopen':
      return ['reopened'];
    case 'comment':
      return ['commented'];
  }
}

/**
 * Muatan push (spek §6): judul + nomor task dan nama customer saja. Isi catatan dan teks komentar (`preview`)
 * TIDAK pernah ikut, karena tampil di layar kunci perangkat.
 */
export function pushPayloadOf(n: NotificationDto): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  const body = [n.number, n.customerName].filter((part) => part !== '').join(' - ');
  return {
    title: notificationTitle(n),
    body: body === '' ? 'Serah Terima' : body,
    url: n.handoverId === '' ? '/handover' : `/handover/${n.handoverId}`,
    tag: `${n.kind}:${n.handoverId}`,
  };
}
