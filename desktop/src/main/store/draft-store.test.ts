import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDraftStore } from './draft-store';
import { openPendingStore } from './pending-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-draft-'));
  file = join(dir, 'draft.db');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const row = (serial: string) => ({ clientId: `cid-${serial}`, serial, source: 'countrylock' });

describe('openDraftStore', () => {
  test('muat awal kosong', () => {
    const store = openDraftStore(file);
    expect(store.load()).toEqual([]);
    store.close();
  });

  test('simpan lalu muat mengembalikan baris yang sama dan urutannya; simpan ulang menimpa', () => {
    const store = openDraftStore(file);
    store.save([row('AB12'), row('CD34')]);
    expect(store.load()).toEqual([row('AB12'), row('CD34')]);
    store.save([row('EF56')]);
    expect(store.load()).toEqual([row('EF56')]);
    store.close();
  });

  test('simpan daftar kosong menghapus draft', () => {
    const store = openDraftStore(file);
    store.save([row('AB12')]);
    store.save([]);
    expect(store.load()).toEqual([]);
    store.close();
  });

  test('draft bertahan setelah ditutup dan dibuka lagi', () => {
    const first = openDraftStore(file);
    first.save([row('AB12')]);
    first.close();
    const second = openDraftStore(file);
    expect(second.load()).toEqual([row('AB12')]);
    second.close();
  });

  test('isi tersimpan yang rusak membuat load melempar (tidak diganti diam-diam)', () => {
    const first = openDraftStore(file);
    first.save([row('AB12')]);
    first.close();
    const raw = new DatabaseSync(file);
    raw.exec("UPDATE serial_draft SET json = '{bukan json'");
    raw.close();
    const store = openDraftStore(file);
    expect(() => store.load()).toThrow(/Draft tersimpan rusak/);
    // Bentuk bukan array juga ditolak.
    const other = new DatabaseSync(file);
    other.exec(`UPDATE serial_draft SET json = '{"a":1}'`);
    other.close();
    expect(() => store.load()).toThrow(/Draft tersimpan rusak/);
    store.close();
  });

  test('berkas yang bukan SQLite gagal dibuka tanpa menghapusnya', async () => {
    const { writeFileSync, existsSync } = await import('node:fs');
    writeFileSync(file, 'bukan sqlite, hanya teks biasa yang cukup panjang untuk diperiksa');
    expect(() => openDraftStore(file)).toThrow(/Berkas draft rusak/);
    expect(existsSync(file)).toBe(true);
  });

  test('berbagi berkas dengan tabel pending tanpa saling mengganggu', () => {
    const pending = openPendingStore(file);
    pending.add({
      serial: 'AB12',
      brand: 'mikrotik',
      tipe: 'hAP',
      date: '2026-11-18',
      timestamp: '2026-11-18T08:00:00.000Z',
    });
    const store = openDraftStore(file);
    store.save([row('CD34')]);
    expect(store.load()).toEqual([row('CD34')]);
    expect(pending.list().map((entry) => entry.serial)).toEqual(['AB12']);
    store.close();
    pending.close();
  });
});
