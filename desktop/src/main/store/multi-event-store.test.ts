import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InjectedEvent } from '@countrylock/multi/types';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDraftStore } from './draft-store';
import { openMultiEventStore } from './multi-event-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-multi-ev-'));
  file = join(dir, 'draft.db');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const event = (id: string, serial = `SN-${id}`): InjectedEvent => ({
  eventId: id,
  mac: '58:D6:1F:0E:4E:FE',
  serial,
  model: 'NanoStation',
  injectedAt: '2026-11-19T03:00:00.000Z',
  target: {
    itemId: 'item-1',
    itemLabel: 'NS Loco',
    buId: 'bu-1',
    buLabel: 'Retail',
    locationId: 'loc-1',
    locationLabel: 'Gudang',
  },
});

describe('openMultiEventStore', () => {
  test('daftar awal kosong', () => {
    const store = openMultiEventStore(file);
    expect(store.list()).toEqual([]);
    store.close();
  });

  test('add lalu list mengembalikan peristiwa yang sama dengan urutan masuk', () => {
    const store = openMultiEventStore(file);
    store.add(event('b'));
    store.add(event('a'));
    store.add(event('c'));
    expect(store.list().map((e) => e.eventId)).toEqual(['b', 'a', 'c']);
    expect(store.list()[0]).toEqual(event('b'));
    store.close();
  });

  test('peristiwa belum di-ack bertahan setelah tutup dan buka ulang (muat ulang/keluar/crash)', () => {
    const first = openMultiEventStore(file);
    first.add(event('keep-1'));
    first.add(event('keep-2'));
    first.close();
    const second = openMultiEventStore(file);
    expect(second.list()).toEqual([event('keep-1'), event('keep-2')]);
    second.close();
  });

  test('add idempoten pada eventId yang sama (satu baris, isi pertama dipertahankan)', () => {
    const store = openMultiEventStore(file);
    store.add(event('dup', 'SN-ASLI'));
    store.add(event('dup', 'SN-LAIN'));
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.serial).toBe('SN-ASLI');
    store.close();
  });

  test('ack membuang hanya id yang disebut; id tak dikenal dan daftar kosong aman', () => {
    const store = openMultiEventStore(file);
    store.add(event('a'));
    store.add(event('b'));
    store.add(event('c'));
    store.ack(['b', 'tak-ada']);
    expect(store.list().map((e) => e.eventId)).toEqual(['a', 'c']);
    store.ack([]);
    expect(store.list().map((e) => e.eventId)).toEqual(['a', 'c']);
    store.close();
  });

  test('baris JSON rusak atau berbentuk salah dilewati dan dibuang, bukan melempar', () => {
    const store = openMultiEventStore(file);
    store.add(event('baik'));
    store.close();

    const raw = new DatabaseSync(file);
    const put = raw.prepare(
      'INSERT INTO multi_injected (event_id, json, created_at) VALUES (?, ?, ?)',
    );
    put.run('rusak', '{bukan json', '2026-11-19T03:00:00.000Z');
    put.run(
      'salah-bentuk',
      JSON.stringify({ eventId: 'salah-bentuk', mac: 1 }),
      '2026-11-19T03:00:00.000Z',
    );
    put.run('beda-id', JSON.stringify(event('lain')), '2026-11-19T03:00:00.000Z');
    put.run(
      'tanpa-target',
      JSON.stringify({ ...event('tanpa-target'), target: { itemId: 'x' } }),
      '2026-11-19T03:00:00.000Z',
    );
    raw.close();

    const reopened = openMultiEventStore(file);
    expect(reopened.list().map((e) => e.eventId)).toEqual(['baik']);
    // Baris rusak benar-benar dibuang (daftar kedua tetap sama, tak menumpuk).
    expect(reopened.list().map((e) => e.eventId)).toEqual(['baik']);
    reopened.close();

    const check = new DatabaseSync(file);
    const count = check.prepare('SELECT COUNT(*) AS n FROM multi_injected').get() as { n: number };
    expect(count.n).toBe(1);
    check.close();
  });

  test('berdampingan dengan draft store pada berkas yang sama tanpa saling mengunci', () => {
    const draft = openDraftStore(file);
    const events = openMultiEventStore(file);
    draft.save([{ clientId: 'c1', serial: 'AB12', source: 'countrylock' }]);
    events.add(event('x'));
    draft.save([{ clientId: 'c2', serial: 'CD34', source: 'countrylock' }]);
    events.add(event('y'));
    expect(draft.load()).toEqual([{ clientId: 'c2', serial: 'CD34', source: 'countrylock' }]);
    expect(events.list().map((e) => e.eventId)).toEqual(['x', 'y']);
    events.close();
    draft.close();
  });

  test('close idempoten', () => {
    const store = openMultiEventStore(file);
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
