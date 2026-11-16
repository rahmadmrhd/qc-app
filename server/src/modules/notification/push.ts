import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { type NotificationDto, type NotificationKind, pushPayloadOf } from '@shared/notifications';
import { canReadNotification } from './recipients';

/**
 * Pengirim push (spek §5.2). Antarmuka disuntik lewat `Env.PUSH` (seperti `MAILER`): pengirim nyata di
 * `web-push.ts` (kunci VAPID dari konfigurasi), pengirim palsu di `server/test-support/fake-push.ts`. Satu
 * kejadian = satu catatan notifikasi per penerima; saluran ini membaca catatan itu (`push_state = 'pending'`).
 */

export interface PushSubscriptionInfo {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Hasil pengiriman. `prunable` (hanya pada kegagalan) = kegagalan ini berasal dari layanan push (respons HTTP non-2xx)
 * atau dari endpoint tersimpan yang tak lagi lolos kebijakan (permanen), sehingga boleh dihitung menuju pemangkasan
 * langganan. Galat sisi server (egress mati, kunci VAPID rusak, batas waktu, pengirim melempar) `prunable: false`:
 * tetap menaikkan `fail_count` untuk status admin, tetapi tidak boleh menghapus langganan yang sehat.
 */
export type PushSendResult =
  | { ok: true }
  | { ok: false; gone: boolean; error: string; prunable: boolean };

export interface PushSender {
  send(sub: PushSubscriptionInfo, payload: string): Promise<PushSendResult>;
}

/** Notifikasi yang lebih tua dari ini tidak lagi didorong (sudah basi; tetap ada di lonceng). */
export const PUSH_MAX_AGE_MS = 10 * 60 * 1000;
/** Jumlah notifikasi `pending` yang diproses per putaran. */
const DELIVER_BATCH = 200;
/** Kegagalan berturut-turut pada SEMUA langganan pengguna sebelum status dinilai `failing`. */
export const PUSH_FAILING_THRESHOLD = 3;
/**
 * Pemangkasan langganan gagal-terus (keputusan pemilik 2026-11-13): langganan dihapus bila `fail_count` mencapai
 * `PUSH_PRUNE_FAIL_COUNT` DAN sukses terakhirnya (atau saat dibuat, bila belum pernah sukses) lebih tua dari
 * `PUSH_PRUNE_AFTER_MS`. Syarat waktu mencegah gangguan sesaat layanan push menghapus langganan yang sehat.
 */
export const PUSH_PRUNE_FAIL_COUNT = 10;
export const PUSH_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Banyak notifikasi yang diproses bersamaan dan banyak pengiriman `send` yang berjalan bersamaan (seluruh putaran). */
const DELIVER_CONCURRENCY = 5;
/** Batas waktu satu `send`; melewatinya = gagal (bukan `gone`: langganan tidak dihapus). */
const SEND_TIMEOUT_MS = 15_000;
/**
 * Anggaran waktu satu putaran (jam dinding nyata): setelah lewat, notifikasi yang belum disentuh tetap `pending`
 * untuk putaran berikutnya (atau `skipped` bila sudah basi), agar endpoint yang menggantung tidak menunda ringkasan
 * centang dan push pengguna lain.
 */
const ROUND_BUDGET_MS = 60_000;

/** Opsi pengiriman; hanya tes yang mengubahnya. */
export interface DeliverOptions {
  concurrency?: number;
  sendTimeoutMs?: number;
  budgetMs?: number;
}

/** `send` dengan batas waktu: pengirim yang menggantung dianggap gagal (galat umum, bukan `gone`). */
async function sendWithTimeout(
  push: PushSender,
  sub: PushSubscriptionInfo,
  payload: string,
  timeoutMs: number,
): Promise<PushSendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PushSendResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, gone: false, error: 'waktu habis', prunable: false }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      push.send(sub, payload).catch(
        (): PushSendResult => ({
          ok: false,
          gone: false,
          error: 'galat pengirim',
          prunable: false,
        }),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Pembatas konkurensi sederhana: paling banyak `limit` tugas berjalan; sisanya antre FIFO. */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    active--;
    queue.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

interface PendingRow {
  id: string;
  recipient: string;
  kind: string;
  handover_id: string;
  location_id: string;
  number: string;
  customer_name: string;
  actor_name: string;
  count: number | string;
  preview: string;
  created_at: string;
  serial_id: string;
  proof_id: string;
}

interface SubRow {
  endpoint_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function setPushState(
  env: Env,
  id: string,
  state: 'sent' | 'skipped' | 'failed',
): Promise<void> {
  await env.DB.prepare(
    "UPDATE notifications SET push_state = ? WHERE id = ? AND push_state = 'pending'",
  )
    .bind(state, id)
    .run();
}

/**
 * Mengirim push untuk notifikasi `pending`; tiap baris berakhir `sent`, `skipped`, atau `failed`. Dilewati
 * (`skipped`) bila: pengirim tidak dikonfigurasi, notifikasi lebih tua dari 10 menit, akun tidak lagi aktif atau
 * tidak lagi berhak di lokasi notifikasi (diperiksa SAAT KIRIM, A3), preferensi push dimatikan, atau tak ada
 * langganan. Muatan dari `pushPayloadOf` (termasuk cuplikan catatan/komentar). Langganan `gone` (404/410) dihapus;
 * minimal satu sukses = `sent`, semua gagal = `failed` (dan `fail_count` naik). Satu putaran pada satu waktu
 * (`startNotificationLoop`). Mengembalikan jumlah notifikasi yang `sent`.
 */
export async function deliverPendingPushes(
  env: Env,
  options: DeliverOptions = {},
): Promise<number> {
  const pending = await env.DB.prepare(
    "SELECT id, recipient, kind, handover_id, location_id, number, customer_name, actor_name, `count`, preview, created_at, serial_id, proof_id FROM notifications WHERE push_state = 'pending' ORDER BY created_at, id LIMIT ?",
  )
    .bind(DELIVER_BATCH)
    .all<PendingRow>();
  const push = env.PUSH;
  const now = nowOf(env);
  const concurrency = options.concurrency ?? DELIVER_CONCURRENCY;
  const sendTimeoutMs = options.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  const deadline = Date.now() + (options.budgetMs ?? ROUND_BUDGET_MS);
  const limitSend = createLimiter(concurrency);
  const contexts = new Map<string, Promise<UserContext | null>>();
  const contextOf = (email: string): Promise<UserContext | null> => {
    let hit = contexts.get(email);
    if (hit === undefined) {
      hit = loadUserContext(env, email);
      contexts.set(email, hit);
    }
    return hit;
  };
  let sent = 0;
  /** Memproses satu notifikasi; `continue` lama menjadi `return`. */
  const processRow = async (row: PendingRow): Promise<void> => {
    if (push === undefined || now - Date.parse(row.created_at) > PUSH_MAX_AGE_MS) {
      await setPushState(env, row.id, 'skipped');
      return;
    }
    const user = await contextOf(row.recipient);
    if (user === null || !(await canReadNotification(env, user, row))) {
      await setPushState(env, row.id, 'skipped');
      return;
    }
    const prefs = await env.DB.prepare(
      'SELECT push_enabled FROM notification_prefs WHERE recipient = ?',
    )
      .bind(row.recipient)
      .first<{ push_enabled: number | string }>();
    if (prefs !== null && Number(prefs.push_enabled) === 0) {
      await setPushState(env, row.id, 'skipped');
      return;
    }
    const subs = await env.DB.prepare(
      'SELECT endpoint_hash, endpoint, p256dh, auth FROM push_subscriptions WHERE recipient = ?',
    )
      .bind(row.recipient)
      .all<SubRow>();
    if (subs.results.length === 0) {
      await setPushState(env, row.id, 'skipped');
      return;
    }
    const dto: NotificationDto = {
      id: row.id,
      kind: row.kind as NotificationKind,
      handoverId: row.handover_id,
      locationId: row.location_id,
      number: row.number,
      customerName: row.customer_name,
      actor: row.actor_name,
      count: Number(row.count),
      // Cuplikan ikut dikirim (keputusan pemilik 2026-11-13: data tampil penuh agar task cepat ditangkap).
      preview: row.preview,
      createdAt: row.created_at,
      readAt: '',
      serialId: row.serial_id,
      photoId: row.proof_id,
    };
    const payload = JSON.stringify(pushPayloadOf(dto));
    const results = await Promise.all(
      subs.results.map(async (sub) => ({
        sub,
        // Slot kirim dibagi seluruh putaran. Anggaran hanya diperiksa SEBELUM sebuah notifikasi dimulai: sekali
        // dimulai, semua langganannya dikirim sampai selesai (dibatasi batas waktu per kirim).
        result: await limitSend(() =>
          sendWithTimeout(
            push,
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload,
            sendTimeoutMs,
          ),
        ),
      })),
    );
    const stamp = nowIso(env);
    let anyOk = false;
    for (const { sub, result } of results) {
      if (result.ok) {
        anyOk = true;
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_ok_at = ?, fail_count = 0, last_error = '', last_error_at = '' WHERE endpoint_hash = ? AND recipient = ?",
        )
          .bind(stamp, sub.endpoint_hash, row.recipient)
          .run();
      } else if (result.gone) {
        // Langganan sudah hilang di layanan push: hapus untuk semua pengguna yang berbagi endpoint itu.
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?')
          .bind(sub.endpoint_hash)
          .run();
      } else {
        await env.DB.prepare(
          'UPDATE push_subscriptions SET fail_count = fail_count + 1, last_error_at = ?, last_error = ? WHERE endpoint_hash = ? AND recipient = ?',
        )
          .bind(stamp, result.error.slice(0, 100), sub.endpoint_hash, row.recipient)
          .run();
        // Pangkas langganan yang sudah lama tidak pernah berhasil (bandingkan teks ISO: format sama dengan `nowIso`).
        // Hanya dinilai bila kegagalan INI berasal dari layanan push atau kebijakan endpoint, bukan dari sisi server.
        if (result.prunable) {
          await env.DB.prepare(
            "DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND recipient = ? AND fail_count >= ? AND (CASE WHEN last_ok_at <> '' THEN last_ok_at ELSE created_at END) < ?",
          )
            .bind(
              sub.endpoint_hash,
              row.recipient,
              PUSH_PRUNE_FAIL_COUNT,
              new Date(now - PUSH_PRUNE_AFTER_MS).toISOString(),
            )
            .run();
        }
      }
    }
    await setPushState(env, row.id, anyOk ? 'sent' : 'failed');
    if (anyOk) sent++;
  };
  // Pekerja berkonkurensi terbatas; anggaran habis = berhenti mengambil notifikasi baru (tetap `pending`); yang sudah
  // dimulai diselesaikan.
  const queue = [...pending.results];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
      if (Date.now() > deadline) return;
      await processRow(row);
    }
  });
  await Promise.all(workers);
  return sent;
}
