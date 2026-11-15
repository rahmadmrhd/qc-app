// Pembungkus IndexedDB mentah untuk data perangkat (papan dan detail task Serah Terima, Fase 3 Tahap B;
// antrean tulis offline, Tahap C).
// Basis data `qc-device` versi 2; toko `columns`, `tasks`, dan `outbox` berkunci `key`, berindeks `savedAt`
// (v1 hanya punya dua toko pertama; upgrade ke v2 menambah `outbox` tanpa menyentuh yang lama).
// Tak satu pun fungsi di sini menolak (reject): tanpa IndexedDB, galat buka, terblokir, atau transaksi
// gagal selalu berujung `[]`/`false`/diam, supaya aplikasi tetap boot normal tanpa data pulihan.
// Toko `outbox` memakai fungsi tersendiri (kunci `owner|id`, tanpa pemangkasan `savedAt`): antrean tidak
// boleh dipangkas diam-diam, dan tiap penulisan menyentuh SATU rekaman (bukan seluruh daftar pemilik).

export type DeviceStoreName = 'columns' | 'tasks' | 'outbox';

export interface DeviceRecord {
  key: string;
  owner: string;
  v: number;
  savedAt: number;
  [field: string]: unknown;
}

/** Nama dan versi basis data; `sync-sw.js` menyalin namanya dan membuka TANPA nomor versi (dijaga `outbox-parity.test.ts`). */
export const DEVICE_DB_NAME = 'qc-device';
export const DEVICE_DB_VERSION = 2;
const DB_NAME = DEVICE_DB_NAME;
const DB_VERSION = DEVICE_DB_VERSION;
const STORES: DeviceStoreName[] = ['columns', 'tasks', 'outbox'];
const BOARD_STORES: DeviceStoreName[] = ['columns', 'tasks'];

/** Batas menunggu `indexedDB.open`; lewat dari ini koneksi dianggap tidak ada (hasil terlambat ditutup). */
export const OPEN_TIMEOUT_MS = 3000;

let connection: Promise<IDBDatabase | null> | null = null;

/** `drop` melepas koneksi tersimpan HANYA bila masih milik percobaan buka ini (tak menimpa koneksi yang lebih baru). */
function openConnection(drop: () => void): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        // Jawaban terlambat (sesudah batas waktu atau galat): koneksinya tak dipakai siapa pun, jangan bocor.
        try {
          db?.close();
        } catch {
          // Diabaikan.
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!db) drop();
      resolve(db);
    };
    try {
      if (typeof indexedDB === 'undefined') {
        finish(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (!settled) {
          db.onversionchange = () => {
            db.close();
            drop();
          };
          db.onclose = drop;
        }
        finish(db);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function getDb(): Promise<IDBDatabase | null> {
  if (!connection) {
    // `drop` bisa terpanggil sinkron (tanpa IndexedDB) sebelum `attempt` terisi: tandai dan lepas sesudahnya.
    let dropped = false;
    let attempt: Promise<IDBDatabase | null> | undefined;
    attempt = openConnection(() => {
      dropped = true;
      if (connection === attempt) connection = null;
    });
    connection = dropped ? null : attempt;
    return attempt;
  }
  return connection;
}

export async function readAllRecords(store: DeviceStoreName): Promise<DeviceRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as DeviceRecord[]);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Menulis `records` (kunci sama menimpa) dan memangkas toko ke `keep` rekaman terbaru menurut
 * `savedAt`, dalam satu transaksi. `guard` dipanggil sinkron setelah koneksi didapat dan sebelum
 * transaksi dibuka; `false` = tidak menulis apa pun.
 */
export async function writeRecords(
  store: DeviceStoreName,
  records: DeviceRecord[],
  keep: number,
  guard?: () => boolean,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  if (guard && !guard()) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      for (const record of records) os.put(record);
      const counting = os.count();
      counting.onsuccess = () => {
        let excess = counting.result - keep;
        if (excess <= 0) return;
        const cursorRequest = os.index('savedAt').openKeyCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || excess <= 0) return;
          os.delete(cursor.primaryKey);
          excess -= 1;
          cursor.continue();
        };
      };
    } catch {
      resolve(false);
    }
  });
}

export async function deleteRecords(store: DeviceStoreName, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await getDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      for (const key of keys) os.delete(key);
    } catch {
      resolve();
    }
  });
}

async function clearStores(stores: DeviceStoreName[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      for (const name of stores) tx.objectStore(name).clear();
    } catch {
      resolve();
    }
  });
}

/** Mengosongkan hanya toko papan (`columns`, `tasks`); antrean `outbox` tak tersentuh. */
export function clearBoardStores(): Promise<void> {
  return clearStores(BOARD_STORES);
}

/** Mengosongkan ketiga toko (keluar eksplisit). */
export function clearAllDeviceStores(): Promise<void> {
  return clearStores(STORES);
}

/**
 * Semua rekaman antrean. `null` = tidak diketahui (tanpa IndexedDB, galat, atau transaksi gagal); `[]` = benar-benar
 * kosong. Pemanggil tak boleh menganggap `null` sebagai kosong yang sah (mis. untuk menghapus apa pun di toko).
 */
export async function readOutboxRecords(): Promise<DeviceRecord[] | null> {
  const db = await getDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result as DeviceRecord[]);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface OutboxPutRule {
  /** Rekaman milik owner yang sama yang digantikan rekaman baru (dihapus dalam transaksi yang sama). */
  replaceIf?: (existing: DeviceRecord) => boolean;
  /** Batas jumlah rekaman owner yang memenuhi `count` (sesudah penggantian); `>= max` = batal dan `'full'`. */
  cap?: { count: (existing: DeviceRecord) => boolean; max: number };
}

/**
 * Menulis SATU rekaman antrean dalam satu transaksi readwrite: memindai rekaman `owner|*`, menghapus yang
 * `replaceIf`, menghitung sisa yang memenuhi `cap.count` (rekaman berkunci sama yang akan ditimpa tak dihitung);
 * bila sisa `>= cap.max` transaksi dibatalkan (`'full'`, tak ada yang tertulis). `guard` dipanggil sinkron tepat
 * sebelum transaksi dibuka; `false` = `'failed'` tanpa menulis.
 */
export async function putOutboxRecord(
  owner: string,
  record: DeviceRecord,
  rule: OutboxPutRule,
  guard: () => boolean,
): Promise<'ok' | 'full' | 'failed'> {
  const db = await getDb();
  if (!db) return 'failed';
  if (!guard()) return 'failed';
  return new Promise((resolve) => {
    let full = false;
    try {
      const tx = db.transaction('outbox', 'readwrite');
      const os = tx.objectStore('outbox');
      tx.oncomplete = () => resolve('ok');
      tx.onerror = () => resolve(full ? 'full' : 'failed');
      tx.onabort = () => resolve(full ? 'full' : 'failed');
      const scan = os.getAll(IDBKeyRange.bound(`${owner}|`, `${owner}|￿`));
      scan.onsuccess = () => {
        let remaining = 0;
        const doomed: string[] = [];
        for (const existing of scan.result as DeviceRecord[]) {
          // Rentang awalan `owner|` juga memuat kunci pemilik lain yang namanya berawalan `owner|`: hanya milik `owner`.
          if (existing.owner !== owner) continue;
          if (rule.replaceIf?.(existing)) {
            doomed.push(existing.key);
          } else if (existing.key !== record.key && rule.cap?.count(existing)) {
            remaining += 1;
          }
        }
        if (rule.cap && remaining >= rule.cap.max) {
          full = true;
          tx.abort();
          return;
        }
        for (const key of doomed) os.delete(key);
        os.put(record);
      };
    } catch {
      resolve(full ? 'full' : 'failed');
    }
  });
}

export async function deleteOutboxRecords(keys: readonly string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const db = await getDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('outbox', 'readwrite');
      const os = tx.objectStore('outbox');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      for (const key of keys) os.delete(key);
    } catch {
      resolve(false);
    }
  });
}

/** Membuang antrean semua pemilik selain `owner` (sisa akun lain di perangkat yang sama). */
export async function deleteOutboxExceptOwner(owner: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('outbox', 'readwrite');
      const os = tx.objectStore('outbox');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      const all = os.getAll();
      all.onsuccess = () => {
        for (const existing of all.result as DeviceRecord[]) {
          if (existing.owner !== owner) os.delete(existing.key);
        }
      };
    } catch {
      resolve(false);
    }
  });
}

export function resetDeviceDbForTests(): void {
  const current = connection;
  connection = null;
  void current?.then((db) => db?.close());
}
