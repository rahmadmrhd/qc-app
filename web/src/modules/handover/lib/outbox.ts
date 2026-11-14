import {
  clearAllDeviceStores,
  type DeviceRecord,
  deleteOutboxExceptOwner,
  deleteOutboxRecords,
  putOutboxRecord,
  readOutboxRecords,
} from '@/lib/device-db';
import { onOutboxMessage, postOutboxMessage } from './outbox-channel';

/**
 * Antrean tulis offline di perangkat (Fase 2 untuk centang, Fase 3 Tahap C untuk komentar dan task baru). Sumber
 * kebenarannya toko `outbox` di IndexedDB `qc-device`; tampilan membaca SALINAN dalam memori (`readOutbox` tetap
 * sinkron untuk `useSyncExternalStore`) yang diisi saat boot (`hydrateOutbox`), diperbarui oleh penulisan yang
 * terkonfirmasi, dan disegarkan dari toko lewat siaran `BroadcastChannel('qc-outbox')` antar tab.
 *
 * Aturan keselamatan data: tiap penulisan menyentuh SATU rekaman (`putOutboxRecord`/`deleteOutboxRecords`); salinan
 * memori TIDAK PERNAH ditulis ulang ke toko. Jadi salinan yang kosong karena baca gagal/terlambat tak dapat menghapus
 * entri nyata di toko.
 */

/** Centang satu butir checklist (Fase 2): `handovers.setCheck`. */
export interface CheckEntry {
  kind: 'check';
  /** Unik per entri: penghapusan selalu per `id`, jadi entri pengganti yang lebih baru tak ikut terhapus. */
  id: string;
  taskId: string;
  locationId: string;
  index: number;
  /** Teks satu butir checklist (dibutuhkan kontrak `SetCheckInput` untuk penjaga "catatan berubah"). */
  text: string;
  checked: boolean;
  at: number;
}

/** Komentar task: `handovers.comment`; `clientId` dibuat SEBELUM percobaan kirim pertama dan dipakai ulang. */
export interface CommentEntry {
  kind: 'comment';
  id: string;
  clientId: string;
  taskId: string;
  locationId: string;
  quote: string;
  before: string;
  after: string;
  body: string;
  at: number;
}

/** Task baru (satu permintaan `handovers.saveBatch`, maks. 30 task); `clientId` per task. */
export interface CreateEntry {
  kind: 'create';
  id: string;
  locationId: string;
  tasks: Array<{ clientId: string; customerName: string; note: string }>;
  at: number;
}

export type OutboxEntry = CheckEntry | CommentEntry | CreateEntry;

/** Distribusi `Omit` pada gabungan tipe (agar `Omit<OutboxEntry, 'id'>` tak meruntuhkan anggota gabungan). */
export type NewOutboxEntry =
  | (Omit<CheckEntry, 'id'> & { id?: string })
  | (Omit<CommentEntry, 'id'> & { id?: string })
  | (Omit<CreateEntry, 'id'> & { id?: string });

export const OUTBOX_MAX_CHECKS = 200;
/** Komentar + task baru, gabungan. */
export const OUTBOX_MAX_WRITES = 50;
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Entri bertanggal lebih dari ini di masa depan (jam perangkat salah) dianggap kedaluwarsa agar tak menetap selamanya. */
export const OUTBOX_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Batas menunggu baca toko saat boot dan pembersihan saat keluar. */
export const OUTBOX_IO_BUDGET_MS = 1500;

/** Kunci `localStorage` antrean centang Fase 2 (dimigrasi ke toko IndexedDB). */
export const LEGACY_OUTBOX_KEY_PREFIX = 'qc.outbox:';
const LEGACY_VERSION = 1;
const RECORD_VERSION = 1;

/** Entri kedaluwarsa (24 jam, atau terlalu jauh di masa depan): tak akan dikirim. Berlaku untuk semua jenis. */
export function isExpiredEntry(entry: OutboxEntry, now: number): boolean {
  return now - entry.at > OUTBOX_MAX_AGE_MS || entry.at - now > OUTBOX_MAX_FUTURE_SKEW_MS;
}

let idCounter = 0;
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Konteks tak aman: pakai cadangan.
  }
  idCounter += 1;
  return `o${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Kunci idempoten untuk komentar dan task baru: UUID v4 huruf kecil 36 karakter (validasi server `isHandoverClientId`).
 * `randomUUID` bila ada (konteks aman), selain itu dari `getRandomValues`/`Math.random`.
 */
export function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().toLowerCase();
    }
  } catch {
    // Konteks tak aman: pakai cadangan.
  }
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isOutboxEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  if (!isString(e.id) || !isFiniteNumber(e.at) || !isString(e.locationId)) return false;
  switch (e.kind) {
    case 'check':
      return (
        isString(e.taskId) &&
        typeof e.index === 'number' &&
        Number.isInteger(e.index) &&
        isString(e.text) &&
        typeof e.checked === 'boolean'
      );
    case 'comment':
      return (
        isString(e.clientId) &&
        isString(e.taskId) &&
        isString(e.quote) &&
        isString(e.before) &&
        isString(e.after) &&
        isString(e.body)
      );
    case 'create':
      return (
        Array.isArray(e.tasks) &&
        e.tasks.length > 0 &&
        e.tasks.every((task) => {
          if (typeof task !== 'object' || task === null) return false;
          const t = task as Record<string, unknown>;
          return isString(t.clientId) && isString(t.customerName) && isString(t.note);
        })
      );
    default:
      return false;
  }
}

const recordKey = (owner: string, id: string): string => `${owner}|${id}`;

/** Urutan masuk (pemecah seri bila dua entri `at` sama): naik per penulisan di tab ini; bukan kunci keamanan. */
let seqCounter = 0;
const nextSeq = (): number => Date.now() * 1000 + (seqCounter++ % 1000);

function toRecord(owner: string, entry: OutboxEntry, seq: number = nextSeq()): DeviceRecord {
  return {
    key: recordKey(owner, entry.id),
    owner,
    v: RECORD_VERSION,
    savedAt: entry.at,
    seq,
    entry,
  };
}

const entryOf = (record: DeviceRecord): unknown => record.entry;

// --- Salinan memori ---------------------------------------------------------------------------------------------
/** Per pemilik, urut `at` (stabil menurut urutan masuk). */
let copy = new Map<string, OutboxEntry[]>();
/** Naik tiap salinan berubah oleh penulisan lokal: `refreshOutboxFromStore` mengulang bila ada perubahan di tengah baca. */
let mutations = 0;
/** Naik tiap pembersihan total: hasil penulisan/baca yang selesai SESUDAH keluar tak boleh menghidupkan salinan lagi. */
let epoch = 0;
/**
 * Salinan memori sudah pernah selaras dengan toko pada sesi ini (hidrasi boot atau penyegaran yang berhasil). Selama
 * `false`, salinan kosong/sedikit tak bisa dipercaya sebagai "tak ada antrean" (hidrasi gagal atau lewat batas waktu).
 */
let storeSynced = false;

/** Sudah pernah selaras dengan toko? (lihat `storeSynced`). */
export function outboxSynced(): boolean {
  return storeSynced;
}

function sortByTime(entries: OutboxEntry[]): OutboxEntry[] {
  return entries
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.at - b.entry.at || a.order - b.order)
    .map(({ entry }) => entry);
}

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function readOutbox(owner: string): OutboxEntry[] {
  return copy.get(owner) ?? [];
}

/** Jumlah entri VALID dan belum kedaluwarsa dari SEMUA pemilik di salinan memori: yang akan terbuang bila keluar. */
export function countAllOutboxEntries(): number {
  const now = Date.now();
  let total = 0;
  for (const entries of copy.values()) {
    total += entries.filter((entry) => !isExpiredEntry(entry, now)).length;
  }
  return total;
}

export function subscribeOutbox(listener: () => void): () => void {
  ensureChannelListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function outboxVersion(): number {
  return version;
}

/**
 * Setelah keluar eksplisit, penulisan antrean ditahan sampai `resumeOutboxWrites`: permintaan yang masih terbang saat
 * keluar bisa gagal `UNAVAILABLE` dan, tanpa ini, menulis antrean pemilik lama kembali (pola yang sama dengan draf
 * Serial Number).
 */
let writesSuspended = false;

export function suspendOutboxWrites(): void {
  writesSuspended = true;
}

/** Sesi kerja baru (penyinkron dimulai untuk pemilik yang sah): penulisan diizinkan lagi. */
export function resumeOutboxWrites(): void {
  writesSuspended = false;
}

export function outboxWritesSuspended(): boolean {
  return writesSuspended;
}

function setCopy(next: Map<string, OutboxEntry[]>): void {
  copy = next;
  mutations += 1;
}

/**
 * Pemilik sesi yang sah di tab ini (diisi `purgeForeignOutboxes` saat penyinkron dimulai). Sesudahnya salinan memori
 * hanya memuat antrean pemilik ini: entri pemilik lain yang belum selesai dibersihkan dari toko tak hidup lagi di
 * memori (dan tak terhitung di peringatan keluar). `null` = belum ditentukan (boot, sebelum penyinkron berjalan).
 */
let activeOwner: string | null = null;

/**
 * Entri yang sedang/baru saja dihapus (kunci rekaman). Penyegaran yang membaca toko sebelum penghapusan commit tak
 * boleh memasangnya kembali ke salinan memori. Tersisa sampai penghapusan selesai DAN tak ada lagi penyegaran yang
 * dimulai sebelum penghapusan itu selesai (hasil bacanya mungkin masih basi).
 */
const tombstones = new Map<string, { settledAt: number | null }>();
/**
 * Nomor urut penyegaran dimulai; `activeRefreshes` = yang belum selesai. Batas yang diketahui: bila baca IndexedDB
 * menggantung selamanya, penyegaran itu tak pernah keluar dari `activeRefreshes` dan tombstone yang selesai sesudahnya
 * tak tersapu. Diterima: dampaknya hanya sedikit memori (id unik; tak ada entri sah yang tertahan) dan IndexedDB macet
 * sudah menjadi gejala yang jauh lebih besar; tombstone hilang bersama muat ulang halaman.
 */
let refreshSeq = 0;
const activeRefreshes = new Set<number>();

function sweepTombstones(): void {
  for (const [key, mark] of tombstones) {
    if (mark.settledAt === null) continue;
    const settledAt = mark.settledAt;
    if (![...activeRefreshes].some((seq) => seq <= settledAt)) tombstones.delete(key);
  }
}

const KNOWN_KINDS: readonly string[] = ['check', 'comment', 'create'];

/**
 * Nasib rekaman toko: `ok` dipakai; `newer` = kemungkinan ditulis rilis/tab lebih baru (versi > yang dikenal, atau
 * versi sama dengan `kind` yang belum dikenal bundel ini): diabaikan dan DIBIARKAN; `broken` = jelas rusak (bukan objek,
 * `v` tak valid atau lebih lama, atau jenis dikenal tetapi field wajibnya hilang): dibuang.
 * Aturan ke depan: jenis entri baru boleh ditambah tanpa menaikkan `RECORD_VERSION` (tab berbundel lama tak akan
 * menghapusnya), tetapi mengubah bentuk jenis yang sudah ada WAJIB menaikkan versi.
 */
function classifyRecord(record: DeviceRecord): 'ok' | 'newer' | 'broken' {
  if (typeof record.v !== 'number' || !Number.isInteger(record.v)) return 'broken';
  if (record.v > RECORD_VERSION) return 'newer';
  if (record.v < RECORD_VERSION) return 'broken';
  const entry = entryOf(record);
  if (typeof entry !== 'object' || entry === null) return 'broken';
  const kind = (entry as { kind?: unknown }).kind;
  if (typeof kind === 'string' && !KNOWN_KINDS.includes(kind)) return 'newer';
  return isOutboxEntry(entry) && typeof record.owner === 'string' ? 'ok' : 'broken';
}

/**
 * Salinan dari daftar rekaman toko (rekaman tak dikenal, rusak, atau milik pemilik lain/yang sedang dihapus dibuang dari
 * tampilan; fungsi ini tak pernah menghapus apa pun dari toko).
 */
function copyFromRecords(records: readonly DeviceRecord[]): Map<string, OutboxEntry[]> {
  // Urut `at`, lalu urutan masuk (`seq`), lalu kunci: deterministik walau `at` kembar (getAll mengurut menurut kunci acak).
  const ordered = [...records].sort(
    (a, b) =>
      (a.savedAt as number) - (b.savedAt as number) ||
      ((a.seq as number | undefined) ?? 0) - ((b.seq as number | undefined) ?? 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const grouped = new Map<string, OutboxEntry[]>();
  for (const record of ordered) {
    if (classifyRecord(record) !== 'ok') continue;
    if (tombstones.has(record.key)) continue;
    if (activeOwner !== null && record.owner !== activeOwner) continue;
    const entry = entryOf(record) as OutboxEntry;
    const list = grouped.get(record.owner);
    if (list) list.push(entry);
    else grouped.set(record.owner, [entry]);
  }
  return grouped;
}

const sameContent = (a: Map<string, OutboxEntry[]>, b: Map<string, OutboxEntry[]>): boolean =>
  JSON.stringify([...a.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) ===
  JSON.stringify([...b.entries()].sort(([x], [y]) => (x < y ? -1 : 1)));

// --- Segarkan dari toko ---------------------------------------------------------------------------------------------
/**
 * Membaca toko IndexedDB dan memperbarui salinan memori (sumber kebenaran = toko). `null` = tidak diketahui (baca gagal,
 * atau penulisan ditahan karena keluar): salinan tidak disentuh. Mengembalikan entri `owner` bila diberikan, selain itu
 * semua. Dipakai penguras di bawah kunci tiap iterasi dan penerima siaran `changed`.
 */
export async function refreshOutboxFromStore(owner?: string): Promise<OutboxEntry[] | null> {
  if (writesSuspended) return null;
  const seq = ++refreshSeq;
  activeRefreshes.add(seq);
  try {
    return await refreshFromStore(owner);
  } finally {
    activeRefreshes.delete(seq);
    sweepTombstones();
  }
}

async function refreshFromStore(owner?: string): Promise<OutboxEntry[] | null> {
  const born = epoch;
  let records: DeviceRecord[] | null = null;
  let seen = -1;
  // Penulisan lokal di tengah baca membuat hasil baca basi: ulangi (terbatas) agar entri baru tak hilang dari tampilan.
  for (let attempt = 0; attempt < 3 && seen !== mutations; attempt++) {
    seen = mutations;
    records = await readOutboxRecords();
    if (records === null) return null;
  }
  if (records === null || born !== epoch || writesSuspended) return null;
  // Rekaman milik pemilik yang sedang membaca dengan versi lama/tak dikenal atau bentuk rusak tak akan pernah terkirim
  // maupun terlihat: dibuang dari toko. Versi LEBIH BARU (milik rilis/tab lain) dan milik pemilik lain tak disentuh.
  if (owner !== undefined) {
    const broken = records
      .filter((record) => record.owner === owner && classifyRecord(record) === 'broken')
      .map((record) => record.key);
    if (broken.length > 0) void deleteOutboxRecords(broken);
  }
  const next = copyFromRecords(records);
  storeSynced = true;
  if (!sameContent(copy, next)) {
    setCopy(next);
    notify();
  }
  const mine = owner === undefined ? [...next.values()].flat() : (next.get(owner) ?? []);
  return owner === undefined ? sortByTime(mine) : [...mine];
}

let refreshRunning = false;
let refreshAgain = false;

/** Tab lain mengubah toko: muat ulang (digabung: hanya satu pembacaan pada satu waktu, satu ulangan bila ada pesan baru). */
function scheduleRefresh(): void {
  if (refreshRunning) {
    refreshAgain = true;
    return;
  }
  refreshRunning = true;
  void (async () => {
    try {
      do {
        refreshAgain = false;
        await refreshOutboxFromStore();
      } while (refreshAgain);
    } catch {
      // Tak pernah menolak.
    } finally {
      refreshRunning = false;
    }
  })();
}

let stopChannelListener: (() => void) | null = null;
function ensureChannelListener(): void {
  if (stopChannelListener) return;
  stopChannelListener = onOutboxMessage((message) => {
    if (message.type === 'changed') scheduleRefresh();
  });
}

function broadcastChanged(): void {
  postOutboxMessage({ type: 'changed' });
}

// --- Hidrasi saat boot + migrasi localStorage -------------------------------------------------------------------------
function legacyKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_OUTBOX_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    // Penyimpanan tak tersedia.
  }
  return keys;
}

/**
 * Entri centang Fase 2 dari satu kunci lama. `null` = amplop rusak atau berversi lain: kunci dibiarkan apa adanya
 * (tak dihapus, tak dimigrasi); entri tak valid di dalam amplop yang sah dibuang.
 */
function readLegacyKey(key: string): CheckEntry[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const envelope = parsed as { v?: unknown; entries?: unknown };
    if (envelope.v !== LEGACY_VERSION || !Array.isArray(envelope.entries)) return null;
    const entries: CheckEntry[] = [];
    for (const item of envelope.entries) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = { ...item, kind: 'check' };
      if (isOutboxEntry(candidate) && candidate.kind === 'check') entries.push(candidate);
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * Memindahkan antrean centang `localStorage` ke toko: tulis, KONFIRMASI, baru hapus kunci lama. Gagal menulis = kunci
 * dipertahankan (dicoba lagi pada boot berikutnya; kunci entri sama sehingga tak ganda). Mengembalikan entri yang
 * terkonfirmasi tertulis.
 */
async function migrateLegacy(): Promise<Array<{ owner: string; entry: CheckEntry }>> {
  const moved: Array<{ owner: string; entry: CheckEntry }> = [];
  for (const key of legacyKeys()) {
    const owner = key.slice(LEGACY_OUTBOX_KEY_PREFIX.length);
    const entries = readLegacyKey(key);
    if (entries === null) continue;
    let allWritten = true;
    for (const entry of entries) {
      const result = await putOutboxRecord(owner, toRecord(owner, entry), {}, () => true);
      if (result === 'ok') moved.push({ owner, entry });
      else allWritten = false;
    }
    if (!allWritten) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      // Dibiarkan: boot berikutnya mencoba lagi (idempoten).
    }
  }
  return moved;
}

let hydration: Promise<void> | null = null;

/**
 * Memuat antrean dari toko dan memigrasi kunci `localStorage` lama; satu kali per proses. Dibatasi `budgetMs` (bawaan
 * 1,5 dtk): hasil yang datang terlambat TIDAK diterapkan, dan baca yang gagal atau terlambat berarti salinan kosong
 * tanpa menghapus apa pun di toko (penulisan selalu per entri). Tak pernah menolak.
 */
export function hydrateOutbox(budgetMs: number = OUTBOX_IO_BUDGET_MS): Promise<void> {
  ensureChannelListener();
  if (!hydration) hydration = runHydration(budgetMs);
  return hydration;
}

async function runHydration(budgetMs: number): Promise<void> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const [records, moved] = await Promise.all([readOutboxRecords(), migrateLegacy()]);
    if (timedOut) return;
    if (records !== null) storeSynced = true;
    const merged = new Map(copyFromRecords(records ?? []));
    for (const { owner, entry } of moved) {
      const list = merged.get(owner) ?? [];
      if (!list.some((existing) => existing.id === entry.id)) {
        merged.set(owner, sortByTime([...list, entry]));
      }
    }
    // Entri yang sudah masuk lewat penulisan lokal selagi menunggu tak boleh hilang dari tampilan.
    for (const [owner, list] of copy) {
      const base = merged.get(owner) ?? [];
      const extra = list.filter((entry) => !base.some((existing) => existing.id === entry.id));
      if (extra.length > 0) merged.set(owner, sortByTime([...base, ...extra]));
    }
    setCopy(merged);
    notify();
  })().catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, budgetMs);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// --- Penulisan ---------------------------------------------------------------------------------------------------
const isCheckRecord = (record: DeviceRecord): boolean =>
  (record.entry as { kind?: unknown } | undefined)?.kind === 'check';
const isWriteRecord = (record: DeviceRecord): boolean => {
  const kind = (record.entry as { kind?: unknown } | undefined)?.kind;
  return kind === 'comment' || kind === 'create';
};

/**
 * Mengantrekan satu entri (satu transaksi IndexedDB, satu rekaman). Centang dengan task+indeks sama menggantikan yang
 * lama (nilai terakhir menang). `'full'` = batas jenis tercapai (centang 200; komentar + task baru 50), `'failed'` =
 * penulisan ditahan (keluar) atau toko tak dapat ditulis: pemanggil menampilkan galat biasa dan tidak membuang isi.
 * Salinan memori dan `notify()` hanya SESUDAH penulisan terkonfirmasi.
 */
export async function enqueueOutbox(
  owner: string,
  input: NewOutboxEntry,
): Promise<'ok' | 'full' | 'failed'> {
  ensureChannelListener();
  const entry = { ...input, id: input.id ?? newId() } as OutboxEntry;
  const born = epoch;
  const rule =
    entry.kind === 'check'
      ? {
          replaceIf: (existing: DeviceRecord) => {
            const e = existing.entry as Partial<CheckEntry> | undefined;
            return e?.kind === 'check' && e.taskId === entry.taskId && e.index === entry.index;
          },
          cap: { count: isCheckRecord, max: OUTBOX_MAX_CHECKS },
        }
      : { cap: { count: isWriteRecord, max: OUTBOX_MAX_WRITES } };
  const result = await putOutboxRecord(owner, toRecord(owner, entry), rule, () => !writesSuspended);
  if (result !== 'ok') return result;
  // Keluar terjadi selagi menulis: toko dikosongkan sesudah penulisan ini, jadi jangan menghidupkan salinan lagi.
  if (born !== epoch) return 'failed';
  const current = (copy.get(owner) ?? []).filter(
    (existing) =>
      existing.id !== entry.id &&
      !(
        entry.kind === 'check' &&
        existing.kind === 'check' &&
        existing.taskId === entry.taskId &&
        existing.index === entry.index
      ),
  );
  const next = new Map(copy);
  next.set(owner, sortByTime([...current, entry]));
  setCopy(next);
  notify();
  broadcastChanged();
  return 'ok';
}

/**
 * Membuang entri per `id` (salinan memori lebih dulu supaya tampilan langsung bersih, lalu toko, lalu siaran). `true`
 * bila toko terkonfirmasi; `false` = entri mungkin kembali pada penyegaran berikutnya (terkirim ulang, aman: kunci
 * idempoten).
 */
export async function removeOutboxEntries(owner: string, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const drop = new Set(ids);
  const keys = ids.map((id) => recordKey(owner, id));
  for (const key of keys) tombstones.set(key, { settledAt: null });
  const current = copy.get(owner) ?? [];
  const kept = current.filter((entry) => !drop.has(entry.id));
  if (kept.length !== current.length) {
    const next = new Map(copy);
    if (kept.length === 0) next.delete(owner);
    else next.set(owner, kept);
    setCopy(next);
    notify();
  }
  let ok = false;
  try {
    ok = await deleteOutboxRecords(keys);
  } finally {
    // Selesai (berhasil atau tidak): tanda dilepas begitu tak ada penyegaran lama yang masih berjalan.
    for (const key of keys) tombstones.set(key, { settledAt: refreshSeq });
    sweepTombstones();
  }
  broadcastChanged();
  return ok;
}

/** Membuang entri milik `owner` yang kedaluwarsa dan mengembalikannya (untuk toast "kedaluwarsa"). */
export async function purgeExpired(owner: string, now: number): Promise<OutboxEntry[]> {
  const expired = readOutbox(owner).filter((entry) => isExpiredEntry(entry, now));
  if (expired.length === 0) return [];
  const ok = await removeOutboxEntries(
    owner,
    expired.map((entry) => entry.id),
  );
  return ok ? expired : [];
}

/**
 * Pemilik lain login di perangkat yang sama: antrean pemilik lama dibuang diam-diam, tak pernah dikirim. Bagian memori
 * berjalan sinkron (pemanggil sinkron seperti `startOutboxSync` tidak menunggu); pembersihan toko menyusul.
 */
export async function purgeForeignOutboxes(owner: string): Promise<void> {
  activeOwner = owner;
  const foreign = [...copy.keys()].filter((key) => key !== owner);
  if (foreign.length > 0) {
    const next = new Map(copy);
    for (const key of foreign) next.delete(key);
    setCopy(next);
    notify();
  }
  const legacy = legacyKeys().filter((key) => key !== `${LEGACY_OUTBOX_KEY_PREFIX}${owner}`);
  try {
    for (const key of legacy) localStorage.removeItem(key);
  } catch {
    // Dibiarkan.
  }
  await deleteOutboxExceptOwner(owner);
}

/**
 * Keluar eksplisit: salinan memori dikosongkan seketika, kunci `localStorage` lama dibuang, dan toko dikosongkan dalam
 * batas waktu (IndexedDB yang macet tak boleh menggantung keluar; timeout bukan galat). Penulisan lama yang selesai
 * sesudahnya dibuang oleh `epoch`. Sesi kedaluwarsa (401) tidak memanggil ini.
 */
export async function clearAllOutboxesWithin(
  budgetMs: number = OUTBOX_IO_BUDGET_MS,
): Promise<void> {
  epoch += 1;
  activeOwner = null;
  storeSynced = false;
  const hadEntries = copy.size > 0;
  setCopy(new Map());
  if (hadEntries) notify();
  try {
    for (const key of legacyKeys()) localStorage.removeItem(key);
  } catch {
    // Dibiarkan.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  try {
    // Seluruh toko perangkat dikosongkan (outbox + papan): keluar membuang semuanya.
    await Promise.race([clearAllDeviceStores().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
  broadcastChanged();
}

/**
 * Tab lain keluar (siaran `qc-session`): salinan memori tab ini dikosongkan tanpa menyentuh toko (tab yang keluar yang
 * membersihkannya). `epoch` naik sehingga penulisan/baca yang masih terbang tak menghidupkan salinan lagi.
 */
export function discardOutboxCopy(): void {
  epoch += 1;
  storeSynced = false;
  if (copy.size === 0) return;
  setCopy(new Map());
  notify();
}

export function resetOutboxForTests(): void {
  copy = new Map();
  mutations = 0;
  epoch = 0;
  version = 0;
  writesSuspended = false;
  hydration = null;
  storeSynced = false;
  activeOwner = null;
  tombstones.clear();
  activeRefreshes.clear();
  refreshSeq = 0;
  refreshRunning = false;
  refreshAgain = false;
  stopChannelListener?.();
  stopChannelListener = null;
  listeners.clear();
}
