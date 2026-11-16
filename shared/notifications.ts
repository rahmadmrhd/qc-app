import type { HandoverStatus } from './handover';
import { handoverUnescapeText } from './handover-text';
import { stripControlChars } from './text';

// Aturan murni notifikasi Serah Terima (spek 2026-11-12-notifikasi-serah-terima-design.md). Tanpa API runtime/DOM.

/** Jenis kejadian notifikasi Serah Terima (spek §3). `createdBatch` = ringkasan satu permintaan `saveBatch` (§4.3). */
export const HANDOVER_NOTIFICATION_KINDS = [
  'created',
  'createdBatch',
  'updated',
  'cancelled',
  'reopened',
  'done',
  'checked',
  'commented',
] as const;
export type HandoverNotificationKind = (typeof HANDOVER_NOTIFICATION_KINDS)[number];

/**
 * Jenis notifikasi Serial Number (spek 2026-11-16-serial-bukti-foto-qc-masalah-design.md §4.1): `serialProofFailed` =
 * satu foto bukti QC gagal diproses (satu notifikasi per foto per kejadian gagal). Aturan akses jenis ini mengikuti BU
 * serial entri (bukan lokasi/izin Serah Terima).
 */
export const SERIAL_NOTIFICATION_KINDS = ['serialProofFailed'] as const;
export type SerialNotificationKind = (typeof SERIAL_NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KINDS = [
  ...HANDOVER_NOTIFICATION_KINDS,
  ...SERIAL_NOTIFICATION_KINDS,
] as const;
export type NotificationKind = HandoverNotificationKind | SerialNotificationKind;

/** Jenis notifikasi Serial Number? (akses dan tujuan klik berbeda dari jenis Serah Terima.) */
export function isSerialNotificationKind(kind: string): kind is SerialNotificationKind {
  return (SERIAL_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/** Sisi penerima: `qc` = `qc: edit`, `wh` = `handover: view` ke atas, `all` = salah satunya (di lokasi task). */
export type NotificationSide = 'qc' | 'wh' | 'all';

/** Sisi penerima jenis Serah Terima (jenis Serial berpenerima tunggal, tanpa sisi). */
export const NOTIFICATION_SIDE: Record<HandoverNotificationKind, NotificationSide> = {
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
  /** Kosong untuk `createdBatch` dan jenis Serial. */
  handoverId: string;
  locationId: string;
  /** Nomor task `ST-...`; kosong untuk `createdBatch`. Untuk `serialProofFailed` = nomor Serial Number (SN). */
  number: string;
  /** Nama customer task; untuk `createdBatch` berisi NAMA LOKASI (spek §4.3: "N task baru di <lokasi>"). */
  customerName: string;
  /** Nama pelaku. */
  actor: string;
  /** Jumlah butir (`checked`) atau jumlah task (`createdBatch`); selain itu 0. */
  count: number;
  /** Cuplikan satu baris (maks. `NOTIFICATION_PREVIEW_MAX`): catatan (task baru/diubah) atau teks komentar; ikut dikirim lewat push. */
  preview: string;
  createdAt: string;
  /** Kosong = belum dibaca. */
  readAt: string;
  /** Id Serial Number (tujuan buka) untuk jenis Serial; kosong untuk jenis Serah Terima. */
  serialId: string;
  /** Id foto bukti yang gagal (tag push per foto) untuk `serialProofFailed`; selain itu kosong. */
  photoId: string;
}

/** Judul notifikasi (Indonesia), dipakai lonceng dan push. */
export function notificationTitle(
  n: Pick<NotificationDto, 'kind' | 'actor' | 'number' | 'count' | 'customerName'>,
): string {
  switch (n.kind) {
    case 'created':
      return `${n.actor} membuat task ${n.number}`;
    case 'createdBatch':
      // `customerName` = nama lokasi pada jenis ini.
      return `${n.actor} membuat ${n.count} task baru${n.customerName === '' ? '' : ` di ${n.customerName}`}`;
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
    case 'serialProofFailed':
      return 'Foto bukti QC bermasalah';
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
): HandoverNotificationKind[] {
  if (action === 'create') return ['created'];
  if (before === null) return [];
  const becameDone = before.status !== 'done' && after.status === 'done';
  switch (action) {
    case 'save': {
      const events: HandoverNotificationKind[] = [];
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
 * Tujuan buka notifikasi Serah Terima: detail task (`/handover/<id>`) atau daftar untuk `createdBatch`; `loc` membawa
 * lokasi notifikasi agar halaman memuat task/papan lokasi itu walau tidak terpilih di pemilih lokasi header (spek §5.1).
 */
export function handoverUrlOf(n: Pick<NotificationDto, 'handoverId' | 'locationId'>): string {
  const base = n.handoverId === '' ? '/handover' : `/handover/${encodeURIComponent(n.handoverId)}`;
  return n.locationId === '' ? base : `${base}?loc=${encodeURIComponent(n.locationId)}`;
}

/** Tujuan buka notifikasi Serial Number: detail Serial Number (`/serial/<id>`; tanpa `loc`, akses mengikuti BU). */
export function serialUrlOf(n: Pick<NotificationDto, 'serialId'>): string {
  return n.serialId === '' ? '/serial' : `/serial/${encodeURIComponent(n.serialId)}`;
}

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** Pemisah baris: CRLF, LF, CR tunggal, NEL, dan pemisah baris/paragraf Unicode (U+2028/U+2029). */
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;

/**
 * Cuplikan satu baris dari teks Markdown (catatan atau komentar): penanda daftar/centang dibuang, escape Markdown
 * dan entitas HTML dari editor didekode (`handoverUnescapeText`), karakter kontrol dan pengatur arah teks dibuang
 * (`stripControlChars`), baris kosong dilewati, baris digabung dengan " · ". Dipakai SAAT notifikasi dibuat dan
 * hasilnya disimpan sebagai `preview`; lonceng dan push menampilkan nilai tersimpan itu apa adanya.
 */
export function notificationPreviewText(text: string): string {
  return text
    .split(LINE_BREAK)
    .map((line) => stripControlChars(handoverUnescapeText(line.replace(LIST_MARKER, ''))))
    .filter((line) => line !== '')
    .join(' · ');
}

/**
 * Muatan push (spek §6; keputusan pemilik 2026-11-13: data ditampilkan penuh agar task cepat ditangkap): judul,
 * lalu nomor task - nama customer, lalu cuplikan isi (`preview`: catatan task baru/diubah atau teks komentar).
 */
export function pushPayloadOf(n: NotificationDto): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  if (isSerialNotificationKind(n.kind)) {
    // Hanya nomor Serial Number (tanpa alasan teknis, merk, atau tipe); tag per foto (bukan per entri).
    return {
      title: notificationTitle(n),
      body: n.number === '' ? 'Serial Number' : n.number,
      url: serialUrlOf(n),
      tag: `${n.kind}:${n.photoId}`,
    };
  }
  const head = [n.number, n.customerName].filter((part) => part !== '').join(' - ');
  // `preview` sudah rata dan terbersih (dibentuk `notificationPreviewText` saat notifikasi dibuat): dipakai apa adanya
  // agar isi push sama dengan lonceng.
  const body = [head, n.preview].filter((part) => part !== '').join('\n');
  return {
    title: notificationTitle(n),
    body: body === '' ? 'Serah Terima' : body,
    url: handoverUrlOf(n),
    tag: `${n.kind}:${n.handoverId}`,
  };
}
