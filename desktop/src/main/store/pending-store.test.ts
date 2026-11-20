import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PendingEntry } from '@countrylock/pending';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { removeTempDirSync } from '../../../test-support/safe-rm';
import { openPendingStore } from './pending-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-pending-'));
  file = join(dir, 'pending.db');
});
afterEach(() => {
  removeTempDirSync(dir);
});

const entry = (serial: string, extra: Partial<PendingEntry> = {}): PendingEntry => ({
  serial,
  brand: 'mikrotik',
  tipe: 'hAP ac2',
  date: '2026-11-12',
  timestamp: '2026-11-12T08:00:00.000Z',
  ...extra,
});

describe('openPendingStore', () => {
  test('entri bertahan setelah ditutup dan dibuka lagi', () => {
    const first = openPendingStore(file);
    expect(first.add(entry('AB12'))).toBe('success');
    first.add(entry('CD34', { brand: 'ubiquiti', tipe: 'XW' }));
    first.close();

    const second = openPendingStore(file);
    expect(second.list()).toEqual([
      entry('AB12'),
      entry('CD34', { brand: 'ubiquiti', tipe: 'XW' }),
    ]);
    second.close();
  });

  test('BU dan lokasi bertahan setelah ditutup dan dibuka lagi; tanpa keduanya tetap tak berisi field itu', () => {
    const target = {
      buId: 'bu-1',
      buLabel: 'DEF - BU Bawaan',
      locationId: 'loc-1',
      locationLabel: 'QC-A - QC A',
    };
    const first = openPendingStore(file);
    first.add(entry('AB12', target));
    first.add(entry('CD34'));
    first.close();

    const second = openPendingStore(file);
    expect(second.list()).toEqual([entry('AB12', target), entry('CD34')]);
    second.close();
  });

  test('itemId dan clientId (bahan unggah) bertahan setelah ditutup dan dibuka lagi', () => {
    const upload = { itemId: 'item-1', clientId: '3f2b8c1e-5a4d-4e6f-9a1b-0c2d3e4f5a6b' };
    const first = openPendingStore(file);
    first.add(entry('AB12', upload));
    first.close();
    const second = openPendingStore(file);
    expect(second.list()).toEqual([entry('AB12', upload)]);
    second.close();
  });

  test('berkas pending lama (tanpa kolom BU/lokasi) dimigrasikan: baris lama tetap terbaca, entri baru memuat BU/lokasi', () => {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE pending (
      serial TEXT PRIMARY KEY NOT NULL, brand TEXT NOT NULL, tipe TEXT NOT NULL,
      date TEXT NOT NULL, timestamp TEXT NOT NULL, reinjected_at TEXT
    )`);
    legacy
      .prepare('INSERT INTO pending (serial, brand, tipe, date, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run('OLD1', 'mikrotik', 'hAP', '2026-11-10', '2026-11-10T08:00:00.000Z');
    legacy.close();

    const store = openPendingStore(file);
    expect(store.list()).toEqual([
      entry('OLD1', { tipe: 'hAP', date: '2026-11-10', timestamp: '2026-11-10T08:00:00.000Z' }),
    ]);
    store.add(
      entry('NEW1', { buId: 'bu-1', buLabel: 'DEF', locationId: 'l1', locationLabel: 'A' }),
    );
    expect(store.list()[1]).toMatchObject({ serial: 'NEW1', buId: 'bu-1', locationId: 'l1' });
    store.close();
    // Membuka lagi tidak menambah kolom dua kali (idempoten).
    openPendingStore(file).close();
  });

  test('serial ganda tidak menimpa, reinjectedAt terisi, result duplicated', () => {
    const store = openPendingStore(file);
    store.add(entry('AB12', { tipe: 'pertama' }));
    const result = store.add(
      entry('AB12', { tipe: 'kedua', timestamp: '2026-11-12T09:30:00.000Z' }),
    );
    expect(result).toBe('duplicated');
    const [only, ...rest] = store.list();
    expect(rest).toEqual([]);
    expect(only).toEqual(
      entry('AB12', { tipe: 'pertama', reinjectedAt: '2026-11-12T09:30:00.000Z' }),
    );
    // reinjectedAt ikut tersimpan setelah dibuka ulang
    store.close();
    const again = openPendingStore(file);
    expect(again.list()[0]?.reinjectedAt).toBe('2026-11-12T09:30:00.000Z');
    again.close();
  });

  test('serial dinormalisasi: " ab12 " dan "AB12" satu entri', () => {
    const store = openPendingStore(file);
    expect(store.add(entry(' ab12 '))).toBe('success');
    expect(store.add(entry('AB12'))).toBe('duplicated');
    expect(store.list().map((e) => e.serial)).toEqual(['AB12']);
    store.remove(' ab12');
    expect(store.list()).toEqual([]);
    store.close();
  });

  test('dua puluh add serentak (Promise.all) menghasilkan 20 entri berbeda tanpa galat', async () => {
    const store = openPendingStore(file);
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => store.add(entry(`SN${i}`))),
    );
    expect(results.every((r) => r === 'success')).toBe(true);
    expect(new Set(store.list().map((e) => e.serial)).size).toBe(20);
    store.close();
  });

  test('dua sambungan ke berkas yang sama (dua jendela/proses) tidak saling merusak', async () => {
    const a = openPendingStore(file);
    const b = openPendingStore(file);
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => (i % 2 === 0 ? a : b).add(entry(`SN${i % 12}`))),
    );
    // 12 serial berbeda; 8 sisanya duplikat dari serial yang sama
    expect(results.filter((r) => r === 'success')).toHaveLength(12);
    expect(results.filter((r) => r === 'duplicated')).toHaveLength(8);
    expect(a.list()).toHaveLength(12);
    expect(b.list()).toHaveLength(12);
    a.close();
    b.close();
  });

  test('remove menghapus entri; remove serial tak ada tidak melempar', () => {
    const store = openPendingStore(file);
    store.add(entry('AB12'));
    store.add(entry('CD34'));
    store.remove('AB12');
    expect(store.list().map((e) => e.serial)).toEqual(['CD34']);
    expect(() => store.remove('TIDAK-ADA')).not.toThrow();
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  test('berkas rusak melempar galat jelas dan tidak menghapus berkas', () => {
    const garbage = 'ini bukan basis data sqlite, hanya teks '.repeat(20);
    writeFileSync(file, garbage);
    expect(() => openPendingStore(file)).toThrow(/rusak|tidak dapat dibuka/i);
    expect(readFileSync(file, 'utf8')).toBe(garbage);
  });

  test('daftar kosong dan close dua kali tidak melempar', () => {
    const store = openPendingStore(file);
    expect(store.list()).toEqual([]);
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
