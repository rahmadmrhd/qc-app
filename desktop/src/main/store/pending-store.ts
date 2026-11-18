// Antrean pending di SQLite (`node:sqlite`, bawaan Electron 45/Node 24; tanpa modul native).
// Mode WAL + `busy_timeout` agar dua sambungan ke berkas yang sama (mis. dua jendela) menunggu,
// bukan gagal dengan SQLITE_BUSY. Aturan duplikat/normalisasi memakai `addPending` yang murni,
// sehingga perilakunya identik dengan aturan di `countrylock/`.

import { DatabaseSync } from 'node:sqlite';
import {
  type AddResult,
  addPending,
  normalizeSerial,
  type PendingEntry,
} from '@countrylock/pending';

export interface PendingStore {
  list(): PendingEntry[];
  add(entry: PendingEntry): AddResult;
  remove(serial: string): void;
  close(): void;
}

interface Row {
  serial: string;
  brand: string;
  tipe: string;
  date: string;
  timestamp: string;
  reinjected_at: string | null;
  bu_id: string | null;
  bu_label: string | null;
  location_id: string | null;
  location_label: string | null;
}

const BUSY_TIMEOUT_MS = 5000;

function toEntry(row: Row): PendingEntry {
  const entry: PendingEntry = {
    serial: row.serial,
    brand: row.brand as PendingEntry['brand'],
    tipe: row.tipe,
    date: row.date,
    timestamp: row.timestamp,
  };
  if (row.reinjected_at !== null) entry.reinjectedAt = row.reinjected_at;
  if (row.bu_id !== null) entry.buId = row.bu_id;
  if (row.bu_label !== null) entry.buLabel = row.bu_label;
  if (row.location_id !== null) entry.locationId = row.location_id;
  if (row.location_label !== null) entry.locationLabel = row.location_label;
  return entry;
}

export function openPendingStore(file: string): PendingStore {
  let db: DatabaseSync;
  let opened: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    opened = db;
    // Pragma pertama yang menyentuh berkas: berkas yang bukan SQLite gagal di sini.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec(`CREATE TABLE IF NOT EXISTS pending (
      serial TEXT PRIMARY KEY NOT NULL,
      brand TEXT NOT NULL,
      tipe TEXT NOT NULL,
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      reinjected_at TEXT
    )`);
    // Kolom BU/lokasi (jembatan v6) ditambahkan ke berkas pending lama; baris lama tetap valid (NULL = tak dipilih).
    const have = new Set(
      (db.prepare('PRAGMA table_info(pending)').all() as unknown as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    for (const column of ['bu_id', 'bu_label', 'location_id', 'location_label']) {
      if (!have.has(column)) db.exec(`ALTER TABLE pending ADD COLUMN ${column} TEXT`);
    }
  } catch (error) {
    // Lepas pegangan berkas (di Windows pegangan yang bocor mengunci berkas), tetapi berkas
    // dibiarkan apa adanya: jangan hapus data pengguna, pemanggil yang memutuskan.
    try {
      opened?.close();
    } catch {
      // Sudah tertutup.
    }
    throw new Error(
      `Berkas pending rusak atau tidak dapat dibuka: ${(error as Error).message ?? 'galat tak dikenal'}`,
    );
  }

  let closed = false;
  const selectAll = db.prepare('SELECT * FROM pending ORDER BY rowid');
  const selectOne = db.prepare('SELECT * FROM pending WHERE serial = ?');
  const insert = db.prepare(
    'INSERT INTO pending (serial, brand, tipe, date, timestamp, reinjected_at, bu_id, bu_label, location_id, location_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const markReinjected = db.prepare('UPDATE pending SET reinjected_at = ? WHERE serial = ?');
  const del = db.prepare('DELETE FROM pending WHERE serial = ?');

  return {
    list() {
      return (selectAll.all() as unknown as Row[]).map(toEntry);
    },
    add(entry) {
      const serial = normalizeSerial(entry.serial);
      // BEGIN IMMEDIATE: kunci tulis diambil sebelum membaca, jadi baca-lalu-tulis tak disela
      // sambungan lain (busy_timeout menunggu bila ada).
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = selectOne.get(serial) as unknown as Row | undefined;
        // Keputusan duplikat/normalisasi diserahkan ke aturan murni agar tak ada dua versi aturan.
        const { list, result } = addPending(existing ? [toEntry(existing)] : [], entry);
        const stored = list[0];
        if (stored) {
          if (result === 'success') {
            insert.run(
              serial,
              stored.brand,
              stored.tipe,
              stored.date,
              stored.timestamp,
              stored.reinjectedAt ?? null,
              stored.buId ?? null,
              stored.buLabel ?? null,
              stored.locationId ?? null,
              stored.locationLabel ?? null,
            );
          } else {
            markReinjected.run(stored.reinjectedAt ?? entry.timestamp, serial);
          }
        }
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Transaksi sudah dibatalkan otomatis.
        }
        throw error;
      }
    },
    remove(serial) {
      del.run(normalizeSerial(serial));
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
