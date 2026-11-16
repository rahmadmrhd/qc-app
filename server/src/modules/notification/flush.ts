import { createHash } from 'node:crypto';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { checklistOf } from '@server/modules/handover/checklist';
import { handoverCanonicalText } from '@shared/handover-text';
import { CHECK_WINDOW_MS, NOTIFICATION_SIDE } from '@shared/notifications';
import { resolveRecipients } from './recipients';
import { insertNotificationStmts } from './repo';

/**
 * Penggabungan centang (spek §4.2). Tiap centang/lepas centang oleh seorang pelaku pada satu task tidak langsung
 * menjadi notifikasi: ia masuk tabel tunggu `notification_pending` (kunci `(task, pelaku)`, jendela TETAP 1 menit
 * sejak centang pertama) beserta butirnya (`notification_pending_items`, `parity` 1 = keadaan akhir butir berbeda
 * dari awal jendela). `flushDueCheckSummaries` melepasnya menjadi satu ringkasan "N butir"; "Task selesai"
 * membuang baris tunggu task itu (`dropPendingStatements`) sehingga tak ada notifikasi berantai (A2).
 */

const ITEM_TEXT_MAX = 1000;

/**
 * Kunci butir dalam satu rangkaian: hash teks kanonis + kemunculan ke-n (butir kembar). Dicocokkan lewat teks
 * kanonis (`handoverCanonicalText`), bukan indeks, sehingga suntingan catatan di tengah jendela tak merusak hitungan.
 */
export function pendingItemKey(text: string, occurrence: number): string {
  const digest = createHash('sha256').update(handoverCanonicalText(text)).digest('hex');
  return `${digest}#${occurrence}`;
}

export interface PendingCheck {
  handoverId: string;
  /** Email ternormalisasi pelaku. */
  actorEmail: string;
  actorName: string;
  locationId: string;
  number: string;
  customerName: string;
  /** Waktu centang ini (ISO); menjadi `first_at` hanya bila rangkaian baru. */
  now: string;
  item: { text: string; occurrence: number };
}

/**
 * Pernyataan untuk satu centang/lepas centang: membuat baris tunggu bila belum ada (jendela tetap sejak centang
 * pertama; centang berikutnya TIDAK mengubah `first_at`/`release_at`) dan membalik `parity` butirnya.
 */
export function pendingCheckStatements(db: Preparer, check: PendingCheck): DbStatement[] {
  const releaseAt = new Date(Date.parse(check.now) + CHECK_WINDOW_MS).toISOString();
  const text = handoverCanonicalText(check.item.text);
  return [
    db
      .prepare(
        'INSERT INTO notification_pending (handover_id, actor_email, location_id, number, customer_name, actor_name, first_at, release_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE handover_id = handover_id',
      )
      .bind(
        check.handoverId,
        check.actorEmail,
        check.locationId,
        check.number,
        check.customerName,
        check.actorName,
        check.now,
        releaseAt,
      ),
    db
      .prepare(
        'INSERT INTO notification_pending_items (handover_id, actor_email, item_key, item_text, occurrence, parity) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE parity = 1 - parity',
      )
      .bind(
        check.handoverId,
        check.actorEmail,
        pendingItemKey(text, check.item.occurrence),
        [...text].slice(0, ITEM_TEXT_MAX).join(''),
        check.item.occurrence,
      ),
  ];
}

/** Membuang semua ringkasan tertahan satu task (semua pelaku): task selesai mengalahkan centang (spek §4.2). */
export function dropPendingStatements(db: Preparer, handoverId: string): DbStatement[] {
  // Baris tunggu lebih dulu, lalu butirnya: urutan kunci sama dengan `flushDueCheckSummaries` (tanpa deadlock).
  return [
    db.prepare('DELETE FROM notification_pending WHERE handover_id = ?').bind(handoverId),
    db.prepare('DELETE FROM notification_pending_items WHERE handover_id = ?').bind(handoverId),
  ];
}

interface DueRow {
  handover_id: string;
  actor_email: string;
  location_id: string;
  number: string;
  customer_name: string;
  actor_name: string;
}

/** Kunci butir yang kini ada di catatan, dengan nomor kemunculan yang dihitung sama seperti `occurrenceAt`. */
function currentItemKeys(note: string): Set<string> {
  const seen = new Map<string, number>();
  const keys = new Set<string>();
  for (const entry of checklistOf(note)) {
    const occurrence = seen.get(entry.text) ?? 0;
    seen.set(entry.text, occurrence + 1);
    keys.add(pendingItemKey(entry.text, occurrence));
  }
  return keys;
}

/**
 * Melepas ringkasan centang yang jendelanya sudah habis: untuk tiap baris tunggu dengan `release_at <= sekarang`,
 * N = butir berbalik (`parity = 1`) yang masih ada di catatan task sekarang; N > 0 menghasilkan satu baris
 * `checked` per penerima sisi WH (kecuali pelaku; hak dihitung saat ini). Klaim atomik: baris tunggu dikunci
 * (`FOR UPDATE`) di dalam transaksi yang juga menghapusnya dan menulis notifikasi, sehingga pemanggil serentak
 * tidak menggandakan dan kegagalan tidak menghilangkan ringkasan. Mengembalikan jumlah ringkasan yang terkirim.
 */
export async function flushDueCheckSummaries(env: Env): Promise<number> {
  const now = nowIso(env);
  const due = await env.DB.prepare(
    'SELECT handover_id, actor_email, location_id, number, customer_name, actor_name FROM notification_pending WHERE release_at <= ? ORDER BY release_at, handover_id, actor_email',
  )
    .bind(now)
    .all<DueRow>();
  let sent = 0;
  // Penerima dihitung sekali per (lokasi, pelaku) dalam satu putaran, bukan per baris tunggu.
  const recipientsByKey = new Map<string, ReturnType<typeof resolveRecipients>>();
  for (const row of due.results) {
    const key = `${row.location_id}\u0000${row.actor_email}`;
    let pending = recipientsByKey.get(key);
    if (pending === undefined) {
      pending = resolveRecipients(env, {
        locationId: row.location_id,
        side: NOTIFICATION_SIDE.checked,
        excludeEmail: row.actor_email,
      });
      recipientsByKey.set(key, pending);
    }
    const recipients = await pending;
    const delivered = await env.DB.transaction(async (tx) => {
      const locked = await tx
        .prepare(
          'SELECT handover_id FROM notification_pending WHERE handover_id = ? AND actor_email = ? AND release_at <= ? FOR UPDATE',
        )
        .bind(row.handover_id, row.actor_email, now)
        .first();
      if (locked === null) return false; // sudah diklaim pemanggil lain
      const items = await tx
        .prepare(
          'SELECT item_key FROM notification_pending_items WHERE handover_id = ? AND actor_email = ? AND parity = 1',
        )
        .bind(row.handover_id, row.actor_email)
        .all<{ item_key: string }>();
      const task = await tx
        .prepare('SELECT note FROM handovers WHERE id = ?')
        .bind(row.handover_id)
        .first<{ note: string }>();
      const alive = currentItemKeys(task?.note ?? '');
      const count = items.results.filter((item) => alive.has(item.item_key)).length;
      await tx
        .prepare('DELETE FROM notification_pending WHERE handover_id = ? AND actor_email = ?')
        .bind(row.handover_id, row.actor_email)
        .run();
      await tx
        .prepare('DELETE FROM notification_pending_items WHERE handover_id = ? AND actor_email = ?')
        .bind(row.handover_id, row.actor_email)
        .run();
      if (count === 0 || recipients.length === 0) return false;
      const statements = insertNotificationStmts(
        tx,
        recipients.map((recipient) => ({
          recipient: recipient.email,
          kind: 'checked' as const,
          handoverId: row.handover_id,
          locationId: row.location_id,
          number: row.number,
          customerName: row.customer_name,
          actorEmail: row.actor_email,
          actorName: row.actor_name,
          count,
          preview: '',
          createdAt: now,
        })),
      );
      for (const statement of statements) await statement.run();
      return true;
    });
    if (delivered) sent++;
  }
  return sent;
}
