import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import { listLocationBriefs } from '@server/modules/access/repo';
import { matchedChecks } from '@server/modules/handover/checklist';
import type { HandoverRecord } from '@server/modules/handover/repo';
import { deriveHandoverStatus } from '@shared/handover';
import {
  type HandoverAction,
  type HandoverSnap,
  handoverEventsOf,
  NOTIFICATION_SIDE,
  type NotificationKind,
  type NotificationSide,
  notificationPreviewText,
} from '@shared/notifications';
import { dropPendingStatements, pendingCheckStatements } from './flush';
import { type Recipient, resolveRecipients } from './recipients';
import { insertNotificationStmts, type NewNotification } from './repo';

/**
 * Pembuat notifikasi di jalur tulis Serah Terima (spek §3, §4.4): kejadian dihitung dari keadaan SEBELUM dan
 * SESUDAH penulisan (`handoverEventsOf`), bukan dari endpoint, lalu dikembalikan sebagai pernyataan SQL yang
 * digabung ke `batch()` penulisan task yang sama, sehingga atomik: penulisan sukses = notifikasi tercatat,
 * penulisan gagal atau diulang (CAS) = tidak ada notifikasi (A5). Perencana dipanggil SETELAH semua early return
 * idempoten, jadi penulisan tanpa perubahan keadaan nyata (mis. centang ulang bernilai sama) tak pernah sampai
 * ke sini (A4).
 */

export interface HandoverChange {
  action: HandoverAction;
  actor: ActorRef;
  /** Waktu penulisan (ISO), sama dengan `updated_at` task. */
  now: string;
  /** Keadaan sebelum penulisan; null hanya untuk `create`. */
  before: HandoverRecord | null;
  after: HandoverRecord;
  customerName: string;
  /** Teks komentar (hanya `comment`); menjadi cuplikan lonceng. */
  commentBody?: string;
  /** Butir yang dicentang/dilepas (hanya `check`); dipakai penggabungan centang. */
  toggledItem?: { text: string; occurrence: number };
}

/** Status turunan (`deriveHandoverStatus`) dari catatan dan centang tersimpan. */
function snapOf(record: HandoverRecord): HandoverSnap {
  const matched = matchedChecks(record.note, record.checks);
  return {
    status: deriveHandoverStatus(record.status, {
      total: matched.length,
      done: matched.filter((check) => check !== null).length,
      completed: record.completedAt !== '',
    }),
    customerId: record.customerId,
    note: record.note,
  };
}

/** Nama tampilan pelaku: `users.name` bila ada, selain itu email. */
async function actorDisplayName(env: Env, email: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT name FROM users WHERE email = ? AND ${liveWhere()}`)
    .bind(normalizeEmail(email))
    .first<{ name: string | null }>();
  const name = (row?.name ?? '').trim();
  return name === '' ? email : name;
}

function recipientsCache(env: Env, locationId: string, excludeEmail: string) {
  const cache = new Map<NotificationSide, Promise<Recipient[]>>();
  return (side: NotificationSide): Promise<Recipient[]> => {
    let hit = cache.get(side);
    if (hit === undefined) {
      hit = resolveRecipients(env, { locationId, side, excludeEmail });
      cache.set(side, hit);
    }
    return hit;
  };
}

/**
 * Pernyataan notifikasi untuk satu penulisan task. Daftar kosong bila tak ada kejadian. `checked` tidak menjadi
 * baris notifikasi: ia masuk tabel tunggu penggabungan (`pendingCheckStatements`). `done` membuang tabel tunggu
 * task itu (Selesai mengalahkan centang, spek §4.2).
 */
/**
 * Apakah perubahan ini menghasilkan notifikasi yang harus segera dikirim. Centang biasa (`checked`) hanya masuk tabel
 * tunggu penggabungan 1 menit, jadi tidak perlu membangunkan putaran pengirim (centang adalah penulisan paling sering);
 * centang yang menyelesaikan task menghasilkan `done` dan tetap membangunkan. Aturan kejadian sama dengan
 * `planNotifications` (`handoverEventsOf`).
 */
export function needsImmediateDelivery(change: HandoverChange): boolean {
  return handoverEventsOf(
    change.action,
    change.before === null ? null : snapOf(change.before),
    snapOf(change.after),
  ).some((kind) => kind !== 'checked');
}

export async function planNotifications(env: Env, change: HandoverChange): Promise<DbStatement[]> {
  const events = handoverEventsOf(
    change.action,
    change.before === null ? null : snapOf(change.before),
    snapOf(change.after),
  );
  if (events.length === 0) return [];
  const { after, actor } = change;
  const recipientsOf = recipientsCache(env, after.locationId, actor.email);
  const actorName = await actorDisplayName(env, actor.email);
  const statements: DbStatement[] = [];
  const rows: NewNotification[] = [];
  for (const kind of events) {
    if (kind === 'checked') {
      statements.push(...pendingChecked(env, change, actorName));
      continue;
    }
    if (kind === 'done') statements.push(...dropPendingStatements(env.DB, after.id));
    const recipients = await recipientsOf(NOTIFICATION_SIDE[kind]);
    for (const recipient of recipients) {
      rows.push(notificationRow(kind, recipient, change, actorName));
    }
  }
  return [...insertNotificationStmts(env.DB, rows), ...statements];
}

/**
 * Cuplikan notifikasi (keputusan pemilik 2026-11-13: data tampil penuh): isi catatan untuk task baru/diubah, teks
 * komentar untuk komentar; jenis lain kosong. Diratakan satu baris; pemotongan ke batas di `insertNotificationStmts`.
 */
function previewOf(kind: NotificationKind, change: HandoverChange): string {
  if (kind === 'commented') return notificationPreviewText(change.commentBody ?? '');
  if (kind === 'created' || kind === 'updated') return notificationPreviewText(change.after.note);
  return '';
}

function notificationRow(
  kind: NotificationKind,
  recipient: Recipient,
  change: HandoverChange,
  actorName: string,
): NewNotification {
  const { after } = change;
  return {
    recipient: recipient.email,
    kind,
    handoverId: after.id,
    locationId: after.locationId,
    number: after.number,
    customerName: change.customerName,
    actorEmail: normalizeEmail(change.actor.email),
    actorName,
    count: 0,
    preview: previewOf(kind, change),
    createdAt: change.now,
  };
}

/** Pernyataan tabel tunggu untuk satu centang/lepas centang; tanpa `toggledItem` (tak seharusnya) tidak ada. */
function pendingChecked(env: Env, change: HandoverChange, actorName: string): DbStatement[] {
  if (change.toggledItem === undefined) return [];
  return pendingCheckStatements(env.DB, {
    handoverId: change.after.id,
    actorEmail: normalizeEmail(change.actor.email),
    actorName,
    locationId: change.after.locationId,
    number: change.after.number,
    customerName: change.customerName,
    now: change.now,
    item: change.toggledItem,
  });
}

/**
 * Notifikasi pembuatan task (spek §4.3): satu task = `created`; dua atau lebih (satu permintaan `saveBatch`) =
 * SATU `createdBatch` per penerima sisi QC (`count` = jumlah task, tanpa task/nomor). Semua task satu lokasi.
 */
export async function planCreateNotifications(
  env: Env,
  input: { records: readonly HandoverRecord[]; actor: ActorRef; now: string },
): Promise<DbStatement[]> {
  const [first] = input.records;
  if (first === undefined) return [];
  if (input.records.length === 1) {
    return planNotifications(env, {
      action: 'create',
      actor: input.actor,
      now: input.now,
      before: null,
      after: first,
      customerName: first.customerName,
    });
  }
  const recipients = await resolveRecipients(env, {
    locationId: first.locationId,
    side: NOTIFICATION_SIDE.createdBatch,
    excludeEmail: input.actor.email,
  });
  if (recipients.length === 0) return [];
  const actorName = await actorDisplayName(env, input.actor.email);
  // `customer_name` memuat NAMA LOKASI pada `createdBatch` (spek §4.3: "N task baru di <lokasi>").
  const locations = await listLocationBriefs(env);
  const locationName = locations.find((row) => row.id === first.locationId)?.name ?? '';
  return insertNotificationStmts(
    env.DB,
    recipients.map((recipient) => ({
      recipient: recipient.email,
      kind: 'createdBatch' as const,
      handoverId: '',
      locationId: first.locationId,
      number: '',
      customerName: locationName,
      actorEmail: normalizeEmail(input.actor.email),
      actorName,
      count: input.records.length,
      preview: '',
      createdAt: input.now,
    })),
  );
}
