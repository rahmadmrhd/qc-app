// Peristiwa `injected` mode Multi di SQLite (`node:sqlite`), pada berkas yang sama dengan draft (`draft.db`) tetapi lewat
// sambungan sendiri. Peristiwa ditulis engine SEBELUM perangkat tampil "Selesai" dan dibuang hanya setelah renderer
// mencatatnya ke draft lalu memanggil `ack`, jadi selamat dari muat ulang, keluar aplikasi, dan crash (spek 2026-11-19 §4).
// Pragma mengikuti `draft-store.ts` (busy_timeout dulu, lalu WAL): dua sambungan ke berkas yang sama menunggu, bukan gagal.

import { DatabaseSync } from 'node:sqlite';
import type { InjectedEvent } from '@countrylock/multi/types';

export interface MultiEventStore {
  /** Idempoten pada `eventId`: peristiwa yang sama tidak menjadi dua baris (isi pertama dipertahankan). Melempar bila gagal. */
  add(event: InjectedEvent): void;
  /** Peristiwa yang belum di-ack, urut masuk. Baris rusak dibuang, bukan melempar. */
  list(): InjectedEvent[];
  /** Membuang peristiwa yang disebut; id tak dikenal aman. */
  ack(eventIds: readonly string[]): void;
  close(): void;
}

const BUSY_TIMEOUT_MS = 5000;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET_FIELDS = [
  'itemId',
  'itemLabel',
  'buId',
  'buLabel',
  'locationId',
  'locationLabel',
] as const;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Bentuk peristiwa tersimpan sah? (sumbernya berkas yang dapat rusak atau diubah di luar aplikasi). */
function parseEvent(json: string, expectedId: string): InjectedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (!isString(e.eventId) || e.eventId !== expectedId || !EVENT_ID.test(e.eventId)) return null;
  if (!isString(e.mac) || !isString(e.serial) || !isString(e.model) || !isString(e.injectedAt)) {
    return null;
  }
  const target = e.target;
  if (typeof target !== 'object' || target === null) return null;
  const t = target as Record<string, unknown>;
  if (!TARGET_FIELDS.every((field) => isString(t[field]))) return null;
  return {
    eventId: e.eventId,
    mac: e.mac,
    serial: e.serial,
    model: e.model,
    injectedAt: e.injectedAt,
    target: {
      itemId: t.itemId as string,
      itemLabel: t.itemLabel as string,
      buId: t.buId as string,
      buLabel: t.buLabel as string,
      locationId: t.locationId as string,
      locationLabel: t.locationLabel as string,
    },
  };
}

export function openMultiEventStore(file: string): MultiEventStore {
  let db: DatabaseSync;
  let opened: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    opened = db;
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec(`CREATE TABLE IF NOT EXISTS multi_injected (
      event_id TEXT PRIMARY KEY NOT NULL,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  } catch (error) {
    try {
      opened?.close();
    } catch {
      // Sudah tertutup.
    }
    throw new Error(
      `Berkas peristiwa Multi rusak atau tidak dapat dibuka: ${(error as Error).message ?? 'galat tak dikenal'}`,
    );
  }

  let closed = false;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO multi_injected (event_id, json, created_at) VALUES (?, ?, ?)',
  );
  // `rowid` (bukan `created_at`) menentukan urutan: cap waktu dapat sama dalam satu milidetik.
  const selectAll = db.prepare('SELECT event_id, json FROM multi_injected ORDER BY rowid');
  const remove = db.prepare('DELETE FROM multi_injected WHERE event_id = ?');

  /** Menjalankan `body` dalam satu transaksi tulis (BEGIN IMMEDIATE: dua penulis tak saling menyela). */
  const inTransaction = (body: () => void): void => {
    db.exec('BEGIN IMMEDIATE');
    try {
      body();
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Transaksi sudah dibatalkan otomatis.
      }
      throw error;
    }
  };

  return {
    add(event) {
      inTransaction(() => {
        insert.run(event.eventId, JSON.stringify(event), new Date().toISOString());
      });
    },
    list() {
      const rows = selectAll.all() as unknown as Array<{ event_id: string; json: string }>;
      const events: InjectedEvent[] = [];
      const broken: string[] = [];
      for (const row of rows) {
        const parsed = parseEvent(row.json, row.event_id);
        if (parsed) events.push(parsed);
        else broken.push(row.event_id);
      }
      if (broken.length > 0) {
        try {
          inTransaction(() => {
            for (const id of broken) remove.run(id);
          });
        } catch {
          // Pembersihan best-effort; baris rusak tetap tak pernah dikembalikan.
        }
      }
      return events;
    },
    ack(eventIds) {
      if (eventIds.length === 0) return;
      inTransaction(() => {
        for (const id of eventIds) remove.run(id);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
