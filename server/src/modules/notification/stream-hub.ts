import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { type NotificationDto, pushPayloadOf } from '@shared/notifications';
import { PUSH_MAX_AGE_MS } from './push';
import { canReadNotification } from './recipients';
import { listNotificationsSince } from './repo';

/**
 * Aliran notifikasi SSE untuk aplikasi desktop (Web Push tidak tersedia di Electron; keputusan pemilik 2026-11-16):
 * proses utama desktop membuka `GET /api/v1/notifications/stream` dengan token Bearer dan menampilkan notifikasi
 * Windows dari kejadian yang diterimanya. Lonceng web memakai aliran DAN hub yang sama dengan cookie sesi (keputusan
 * pemilik 2026-11-16, setelah SSE desktop): tiap bingkai `notification` membuat lonceng memuat ulang daftarnya; jenis
 * koneksi (`StreamKind`) hanya membedakan batas koneksi per pengguna. Satu proses server (tanpa antrean antar-proses), jadi koneksi disimpan di
 * memori. Sumber kebenaran tetap tabel `notifications`: aliran hanya MENDORONG baris baru yang sama dengan lonceng
 * dan push (hak lokasi diperiksa saat kirim, `hasReadAccess`, seperti lonceng dan push).
 *
 * Pemicunya `pumpNotificationStreams`, dipanggil putaran notifikasi (`jobs/runner.ts`) setelah tiap putaran, yang
 * berjalan segera setelah penulisan di-commit (`wakeNotifications`) dan tiap 10 dtk sebagai jaminan.
 */

/** Detak jantung: komentar SSE agar koneksi tak dianggap menganggur (Bun, nginx, Cloudflare). */
export const STREAM_HEARTBEAT_MS = 5_000;
/** Koneksi desktop serentak per pengguna (instalasi/perangkat berbeda); yang berlebih menutup yang TERTUA. */
export const STREAM_MAX_PER_USER = 3;
/**
 * Koneksi web (satu per tab terbuka) serentak per pengguna; yang berlebih menutup yang tertua. Bucket TERPISAH dari
 * desktop dan lebih longgar: dengan batas 3, pengguna yang membuka 4 tab akan membuat tab-tab itu saling menutup
 * (`EventSource` menyambung ulang dan menutup yang lain) tanpa henti, dan tab web tak boleh menggusur aplikasi desktop.
 */
export const STREAM_MAX_WEB_PER_USER = 8;
/** Batas keras seluruh koneksi; di atasnya 503 (melindungi memori dan kueri pump). */
export const STREAM_MAX_TOTAL = 500;
/** Akun/izin diperiksa ulang berkala; akun nonaktif = aliran ditutup. */
export const STREAM_REVALIDATE_MS = 5 * 60 * 1000;
/** Tumpang tindih jendela kueri: baris yang di-commit terlambat dengan `created_at` sedikit lebih lama tetap tertangkap. */
const OVERLAP_MS = 30_000;
const BACKLOG_LIMIT = 50;
const QUERY_LIMIT = 100;
/** Id yang sudah terkirim per koneksi (deduplikasi atas tumpang tindih jendela dan sambung ulang). */
const SENT_MEMORY = 300;
const PUMP_CONCURRENCY = 5;

export interface StreamEvent {
  id: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  createdAt: string;
}

/** Jenis klien: `desktop` = Bearer desktop (Electron), `web` = cookie sesi peramban (lonceng yang terbuka). */
export type StreamKind = 'desktop' | 'web';

interface Connection {
  serial: number;
  email: string;
  kind: StreamKind;
  /** Batas bawah waktu pembuatan notifikasi yang masih perlu dicek (ISO; maju bersama baris yang terkirim). */
  since: string;
  /** Titik awal koneksi (saat dibuka, atau `Last-Event-ID`): jendela tumpang tindih tak pernah mundur melewatinya. */
  floor: string;
  sent: Set<string>;
  validatedAt: number;
  /** Kedaluwarsa token Bearer (epoch ms): aliran ditutup saat lewat, seperti permintaan REST biasa akan 401. */
  expiresAt: number;
  write(text: string): void;
  close(): void;
}

const connections = new Set<Connection>();
let heartbeat: ReturnType<typeof setInterval> | undefined;
let serial = 0;

const encoder = new TextEncoder();

export function streamEventText(n: NotificationDto): string {
  const payload = pushPayloadOf(n);
  const data: StreamEvent = {
    id: n.id,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    createdAt: n.createdAt,
  };
  return `id: ${n.createdAt}|${n.id}\nevent: notification\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `Last-Event-ID` sah = `<createdAt ISO>|<id>`; selain itu `null` (koneksi baru tanpa tunggakan). */
export function parseLastEventId(
  value: string | null | undefined,
): { at: string; id: string } | null {
  if (!value) return null;
  const cut = value.indexOf('|');
  if (cut <= 0) return null;
  const at = value.slice(0, cut);
  const id = value.slice(cut + 1);
  if (!Number.isFinite(Date.parse(at)) || id === '' || id.length > 64) return null;
  return { at, id };
}

function startHeartbeat(): void {
  if (heartbeat !== undefined) return;
  heartbeat = setInterval(() => {
    for (const conn of connections) conn.write(': ping\n\n');
  }, STREAM_HEARTBEAT_MS);
  heartbeat.unref();
}

function removeConnection(conn: Connection): void {
  connections.delete(conn);
  if (connections.size === 0 && heartbeat !== undefined) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

export function activeStreamCount(): number {
  return connections.size;
}

/** Menutup semua aliran (shutdown server). */
export function closeAllNotificationStreams(): void {
  for (const conn of [...connections]) conn.close();
}

export type OpenStreamResult = { ok: true; response: Response } | { ok: false; reason: 'full' };

/**
 * Membuka aliran untuk `email`. Tanpa `lastEventId` = tanpa tunggakan (hanya notifikasi baru sejak sekarang); dengan
 * `lastEventId` sah (sambung ulang) = notifikasi sejak itu yang belum basi (maks. `PUSH_MAX_AGE_MS`, 50 butir).
 */
export function openNotificationStream(
  env: Env,
  email: string,
  lastEventId: string | null | undefined,
  expiresAt: number,
  kind: StreamKind = 'desktop',
): OpenStreamResult {
  if (connections.size >= STREAM_MAX_TOTAL) return { ok: false, reason: 'full' };
  // Batas per pengguna DAN jenis klien: yang tertua ditutup (klien yang baru tersambung ulang menggantikan yang
  // menggantung). Jenis dipisah agar tab web dan aplikasi desktop tidak saling menggusur.
  const limit = kind === 'web' ? STREAM_MAX_WEB_PER_USER : STREAM_MAX_PER_USER;
  const mine = [...connections].filter((conn) => conn.email === email && conn.kind === kind);
  while (mine.length >= limit) mine.shift()?.close();

  const now = nowOf(env);
  const resume = parseLastEventId(lastEventId);
  const oldestBacklog = new Date(now - PUSH_MAX_AGE_MS).toISOString();
  const since =
    resume && resume.at > oldestBacklog
      ? resume.at
      : resume
        ? oldestBacklog
        : new Date(now).toISOString();
  const sent = new Set<string>();
  if (resume) sent.add(resume.id);

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const conn: Connection = {
    serial: ++serial,
    email,
    kind,
    since,
    floor: since,
    sent,
    validatedAt: now,
    expiresAt,
    write(text) {
      if (closed || controller === undefined) return;
      try {
        controller.enqueue(encoder.encode(text));
      } catch {
        conn.close();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      removeConnection(conn);
      try {
        controller?.close();
      } catch {
        // Sudah ditutup klien.
      }
    },
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      connections.add(conn);
      startHeartbeat();
      conn.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      // Sambung ulang: kirim tunggakan segera (tanpa menunggu putaran berikutnya).
      if (resume) void pumpConnection(env, conn, new Map(), BACKLOG_LIMIT);
    },
    cancel() {
      conn.close();
    },
  });
  return {
    ok: true,
    response: new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    }),
  };
}

type ContextCache = Map<string, Promise<UserContext | null>>;

/** Batas bawah `created_at` yang dibaca satu koneksi: mundur sedikit dari `since`, tak melewati titik awal koneksi. */
function fromIsoOf(conn: Connection): string {
  const overlapped = new Date(Date.parse(conn.since) - OVERLAP_MS).toISOString();
  return overlapped > conn.floor ? overlapped : conn.floor;
}

async function pumpConnection(
  env: Env,
  conn: Connection,
  contexts: ContextCache,
  limit: number,
  /** Pembaca baris bersama per pengguna (satu kueri untuk semua tab pengguna itu); bawaan: kueri sendiri. */
  rowsFor?: (fromIso: string) => Promise<NotificationDto[]>,
): Promise<void> {
  const loadContext = (): Promise<UserContext | null> => {
    let hit = contexts.get(conn.email);
    if (hit === undefined) {
      hit = loadUserContext(env, conn.email);
      contexts.set(conn.email, hit);
    }
    return hit;
  };
  try {
    const now = nowOf(env);
    if (now >= conn.expiresAt) {
      conn.close();
      return;
    }
    if (now - conn.validatedAt >= STREAM_REVALIDATE_MS) {
      conn.validatedAt = now;
      if ((await loadContext()) === null) {
        conn.close();
        return;
      }
    }
    // Mundur sedikit dari `since` (baris yang di-commit terlambat), tetapi tidak melewati titik awal koneksi: baris
    // sebelum koneksi dibuka (atau sebelum `Last-Event-ID`) tidak boleh dikirim ulang.
    const fromIso = fromIsoOf(conn);
    const rows = rowsFor
      ? await rowsFor(fromIso)
      : await listNotificationsSince(env, conn.email, {
          fromIso,
          limit: Math.max(limit, QUERY_LIMIT),
        });
    const fresh = rows.filter((row) => !conn.sent.has(row.id));
    if (fresh.length === 0) return;
    const user = await loadContext();
    if (user === null) {
      conn.close();
      return;
    }
    const sendable = fresh.slice(-limit);
    for (const row of fresh) {
      conn.sent.add(row.id);
      if (row.createdAt > conn.since) conn.since = row.createdAt;
    }
    while (conn.sent.size > SENT_MEMORY) {
      const oldest = conn.sent.values().next().value;
      if (oldest === undefined) break;
      conn.sent.delete(oldest);
    }
    for (const row of sendable) {
      if (now - Date.parse(row.createdAt) > PUSH_MAX_AGE_MS) continue;
      const readable = await canReadNotification(env, user, {
        kind: row.kind,
        location_id: row.locationId,
        serial_id: row.serialId,
        handover_id: row.handoverId,
      });
      if (!readable) continue;
      conn.write(streamEventText(row));
    }
  } catch (error) {
    // Galat sementara (basis data): putaran berikutnya mencoba lagi; baris belum ditandai terkirim.
    console.error(`notifikasi: pump aliran gagal: ${String(error)}`);
  }
}

/** Satu putaran: dorong notifikasi baru ke semua koneksi (dipanggil putaran notifikasi). */
export async function pumpNotificationStreams(env: Env): Promise<void> {
  if (connections.size === 0) return;
  const contexts: ContextCache = new Map();
  const queue = [...connections];
  // Satu kueri per PENGGUNA (bukan per koneksi): semua tab satu email membaca dari batas bawah terkecil di antara
  // mereka, lalu menyaring sendiri. Halaman yang penuh (mungkin terpotong LIMIT) dibaca ulang per koneksi supaya
  // hasilnya sama persis dengan kueri sendiri.
  const minFrom = new Map<string, string>();
  for (const conn of queue) {
    const from = fromIsoOf(conn);
    const known = minFrom.get(conn.email);
    if (known === undefined || from < known) minFrom.set(conn.email, from);
  }
  const shared = new Map<string, Promise<NotificationDto[]>>();
  const rowsOf =
    (conn: Connection) =>
    async (from: string): Promise<NotificationDto[]> => {
      const min = minFrom.get(conn.email) ?? from;
      let page = shared.get(conn.email);
      if (page === undefined) {
        page = listNotificationsSince(env, conn.email, { fromIso: min, limit: QUERY_LIMIT });
        shared.set(conn.email, page);
      }
      const rows = await page;
      if (from === min) return rows;
      if (from > min && rows.length < QUERY_LIMIT)
        return rows.filter((row) => row.createdAt >= from);
      return listNotificationsSince(env, conn.email, { fromIso: from, limit: QUERY_LIMIT });
    };
  const worker = async (): Promise<void> => {
    for (let conn = queue.shift(); conn !== undefined; conn = queue.shift()) {
      await pumpConnection(env, conn, contexts, QUERY_LIMIT, rowsOf(conn));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUMP_CONCURRENCY, queue.length) }, worker));
}
