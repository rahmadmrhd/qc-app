import type { PendingEntry } from '@countrylock/pending';
import { describe, expect, test } from 'vitest';
import {
  chunkRows,
  isUploadable,
  newClientId,
  outcomesBySerial,
  summarize,
  toSerialRow,
  uploadBlocker,
} from './upload';

const ready: PendingEntry = {
  serial: 'AB12',
  brand: 'mikrotik',
  tipe: 'RB-750',
  date: '2026-11-18',
  timestamp: '2026-11-18T08:00:00.000Z',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
  itemId: 'item-1',
  clientId: '3f2b8c1e-5a4d-4e6f-9a1b-0c2d3e4f5a6b',
};

describe('uploadBlocker / isUploadable', () => {
  test('entri lengkap siap diunggah', () => {
    expect(uploadBlocker(ready)).toBeNull();
    expect(isUploadable(ready)).toBe(true);
  });
  test('tanpa Tipe katalog (itemId) atau kunci idempoten: alasan "tanpa Tipe katalog"', () => {
    const { itemId: _item, ...noItem } = ready;
    const { clientId: _client, ...noClient } = ready;
    expect(uploadBlocker(noItem)).toMatch(/tanpa Tipe katalog/);
    expect(uploadBlocker(noClient)).toMatch(/tanpa Tipe katalog/);
    expect(isUploadable(noItem)).toBe(false);
  });
  test('tanpa BU atau lokasi: alasan "BU atau Lokasi belum tercatat"', () => {
    const { buId: _bu, ...noBu } = ready;
    const { locationId: _location, ...noLocation } = ready;
    expect(uploadBlocker(noBu)).toMatch(/BU atau Lokasi belum tercatat/);
    expect(uploadBlocker(noLocation)).toMatch(/BU atau Lokasi belum tercatat/);
  });
});

describe('toSerialRow', () => {
  test('memetakan entri ke baris serials.saveBatch (sumber countrylock, stiker tak dikirim = bawaan server)', () => {
    const row = toSerialRow(ready);
    expect(row).toEqual({
      clientId: ready.clientId,
      serial: 'AB12',
      itemId: 'item-1',
      buId: 'bu-1',
      testDate: '2026-11-18',
      locationId: 'loc-1',
      sample: false,
      note: '',
      source: 'countrylock',
    });
    expect(row).not.toHaveProperty('stickers');
  });
});

describe('chunkRows', () => {
  test('memecah menurut ukuran; kosong = tanpa potongan', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 2)).toEqual([]);
    expect(chunkRows(Array.from({ length: 250 }, (_, i) => i)).map((part) => part.length)).toEqual([
      100, 100, 50,
    ]);
  });
});

describe('outcomesBySerial dan summarize', () => {
  const second: PendingEntry = {
    ...ready,
    serial: 'CD34',
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };
  const results = [
    { clientId: ready.clientId ?? '', result: 'created' as const, message: '' },
    { clientId: second.clientId ?? '', result: 'duplicate' as const, message: 'Serial sudah ada' },
    { clientId: 'tidak-dikenal', result: 'error' as const, message: 'x' },
  ];
  test('hasil dipetakan ke serial lewat clientId; pesan kosong diganti bawaan; yang tak dikenal dilewati', () => {
    const map = outcomesBySerial([ready, second], results);
    expect(map.get('AB12')).toEqual({ state: 'created', message: 'Terunggah' });
    expect(map.get('CD34')).toEqual({ state: 'duplicate', message: 'Serial sudah ada' });
    expect(map.size).toBe(2);
  });
  test('ringkasan menghitung terunggah, duplikat, dan gagal (invalid + error)', () => {
    const map = outcomesBySerial(
      [ready, second],
      [...results.slice(0, 2), { clientId: 'x', result: 'invalid' as const, message: '' }],
    );
    expect(summarize(map, null)).toEqual({ created: 1, duplicate: 1, failed: 0, stopped: null });
    const failing = new Map([
      ['A', { state: 'invalid' as const, message: '' }],
      ['B', { state: 'error' as const, message: '' }],
    ]);
    expect(summarize(failing, 'putus')).toEqual({
      created: 0,
      duplicate: 0,
      failed: 2,
      stopped: 'putus',
    });
  });
});

describe('newClientId', () => {
  test('menghasilkan id yang lolos pola server dan berbeda tiap panggilan', () => {
    const a = newClientId();
    const b = newClientId();
    expect(a).toMatch(/^[A-Za-z0-9-]{8,100}$/);
    expect(a).not.toBe(b);
  });
});
