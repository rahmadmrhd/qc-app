// Draft Catat Serial Number di SQLite (`node:sqlite`): satu snapshot JSON per perangkat (jembatan v8). Proses utama
// hanya MENYIMPAN isinya; bentuk baris disaring renderer saat dibaca (sama dengan draft `localStorage` di web). Pragma
// mengikuti `pending-store.ts` (WAL + `busy_timeout`), supaya dua sambungan ke berkas yang sama menunggu, bukan gagal.

import { DatabaseSync } from 'node:sqlite';

export interface DraftStore {
  /** Baris draft tersimpan; `[]` bila belum ada. Melempar galat bila isi tersimpan rusak (jangan ditimpa diam-diam). */
  load(): unknown[];
  /** Mengganti seluruh snapshot (atomik). Daftar kosong menghapus draft. */
  save(rows: readonly unknown[]): void;
  close(): void;
}

const BUSY_TIMEOUT_MS = 5000;

export function openDraftStore(file: string): DraftStore {
  let db: DatabaseSync;
  let opened: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    opened = db;
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec(`CREATE TABLE IF NOT EXISTS serial_draft (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch (error) {
    try {
      opened?.close();
    } catch {
      // Sudah tertutup.
    }
    throw new Error(
      `Berkas draft rusak atau tidak dapat dibuka: ${(error as Error).message ?? 'galat tak dikenal'}`,
    );
  }

  let closed = false;
  const select = db.prepare('SELECT json FROM serial_draft WHERE id = 1');
  const upsert = db.prepare(
    `INSERT INTO serial_draft (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  );
  const del = db.prepare('DELETE FROM serial_draft WHERE id = 1');

  return {
    load() {
      const row = select.get() as unknown as { json: string } | undefined;
      if (!row) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.json);
      } catch {
        throw new Error('Draft tersimpan rusak: isinya tidak terbaca.');
      }
      if (!Array.isArray(parsed))
        throw new Error('Draft tersimpan rusak: bentuknya tidak dikenal.');
      return parsed;
    },
    save(rows) {
      // BEGIN IMMEDIATE: kunci tulis lebih dulu, jadi dua penulis tak saling menyela.
      db.exec('BEGIN IMMEDIATE');
      try {
        if (rows.length === 0) del.run();
        else upsert.run(JSON.stringify(rows), new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Transaksi sudah dibatalkan otomatis.
        }
        throw error;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
