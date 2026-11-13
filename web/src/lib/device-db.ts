// Pembungkus IndexedDB mentah untuk data perangkat (papan dan detail task Serah Terima, Fase 3 Tahap B).
// Basis data `qc-device` versi 1; toko `columns` dan `tasks` berkunci `key`, berindeks `savedAt`.
// Tak satu pun fungsi di sini menolak (reject): tanpa IndexedDB, galat buka, terblokir, atau transaksi
// gagal selalu berujung `[]`/`false`/diam, supaya aplikasi tetap boot normal tanpa data pulihan.

export type DeviceStoreName = 'columns' | 'tasks';

export interface DeviceRecord {
  key: string;
  owner: string;
  v: number;
  savedAt: number;
  [field: string]: unknown;
}

const DB_NAME = 'qc-device';
const DB_VERSION = 1;
const STORES: DeviceStoreName[] = ['columns', 'tasks'];

let connection: Promise<IDBDatabase | null> | null = null;

function openConnection(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      const fail = () => {
        connection = null;
        resolve(null);
      };
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
        const drop = () => {
          connection = null;
        };
        db.onversionchange = () => {
          db.close();
          drop();
        };
        db.onclose = drop;
        resolve(db);
      };
      request.onerror = fail;
      request.onblocked = fail;
    } catch {
      connection = null;
      resolve(null);
    }
  });
}

function getDb(): Promise<IDBDatabase | null> {
  connection ??= openConnection();
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

export async function clearDeviceDb(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORES, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      for (const name of STORES) tx.objectStore(name).clear();
    } catch {
      resolve();
    }
  });
}

export function resetDeviceDbForTests(): void {
  const current = connection;
  connection = null;
  void current?.then((db) => db?.close());
}
