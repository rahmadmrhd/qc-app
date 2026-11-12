import { expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { addSerials, type StagingRow } from './draft';
import {
  ITEM_IDS_PER_REQUEST,
  type ItemLookup,
  isQueryableItemId,
  mapLimit,
  VERIFY_CONCURRENCY,
  verifyImported,
} from './import-verify';

function rowsFor(items: { id: string; label?: string }[]): StagingRow[] {
  let n = 0;
  return items.flatMap(
    (item, index) =>
      addSerials(
        [],
        `S${index}`,
        {
          itemId: item.id,
          itemLabel: item.label ?? '',
          buId: 'b1',
          buLabel: 'BU1',
          testDate: '2026-11-12',
          locationId: 'l1',
          locationLabel: 'Jakarta',
          sample: false,
          note: '',
        },
        () => `row-${String(++n).padStart(8, '0')}`,
        () => '2026-11-12T10:00:00.000Z',
      ).rows,
  );
}

const lookup = (id: string, label = `Item ${id}`): ItemLookup => ({
  id,
  label,
  buOptions: [{ id: 'b1', code: 'BU1' }],
});

const locations = [{ id: 'l1', label: 'Jakarta (JKT)' }];

test('mapLimit: tidak melebihi batas serentak dan mempertahankan urutan hasil', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (value) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    return value * 2;
  });
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  expect(peak).toBeLessThanOrEqual(3);
});

test('item dicocokkan menurut id (label berkas tidak dipakai), dipotong 50 id per permintaan, label disegarkan', async () => {
  const ids = Array.from({ length: 120 }, (_, index) => `i${index}`);
  const requests: string[][] = [];
  const report = await verifyImported(
    rowsFor(ids.map((id) => ({ id, label: 'label lama dari berkas' }))),
    {
      findItems: async (chunk) => {
        requests.push([...chunk]);
        return chunk.map((id) => lookup(id));
      },
      stickersOf: async () => [],
      locations,
    },
  );
  expect(requests.map((chunk) => chunk.length)).toEqual([50, 50, 20]);
  expect(Math.max(...requests.map((chunk) => chunk.length))).toBeLessThanOrEqual(
    ITEM_IDS_PER_REQUEST,
  );
  expect(report.unresolved).toBe(0);
  expect(report.unverified).toBe(0);
  expect(report.rows[0]?.itemLabel).toBe('Item i0');
});

test('berkas tanpa itemLabel tidak bermasalah; id yang tak kembali ditandai tidak ditemukan', async () => {
  const report = await verifyImported(rowsFor([{ id: 'i1' }, { id: 'iGone' }]), {
    findItems: async (chunk) => chunk.filter((id) => id !== 'iGone').map((id) => lookup(id)),
    stickersOf: async () => [],
    locations,
  });
  expect(report.rows[0]?.unresolved).toBeUndefined();
  expect(report.rows[0]?.itemLabel).toBe('Item i1');
  expect(report.rows[1]?.unresolved).toEqual(['item']);
  expect(report.unresolved).toBe(1);
});

test('galat jaringan pada satu potongan: hanya baris potongan itu belum terverifikasi', async () => {
  const ids = Array.from({ length: 60 }, (_, index) => `i${index}`);
  const report = await verifyImported(rowsFor(ids.map((id) => ({ id }))), {
    findItems: async (chunk) => {
      if (chunk.includes('i0')) throw new Error('putus');
      return chunk.map((id) => lookup(id));
    },
    stickersOf: async () => [],
    locations,
  });
  expect(report.unverified).toBe(50);
  expect(report.unresolved).toBe(0);
  expect(report.rows[0]?.result).toBe('error');
  expect(report.rows[59]?.result).toBeUndefined();
});

test('stikerOptions dibatasi serentak dan NOT_FOUND pasangan menandai item', async () => {
  let inFlight = 0;
  let peak = 0;
  const ids = Array.from({ length: 12 }, (_, index) => `i${index}`);
  const report = await verifyImported(rowsFor(ids.map((id) => ({ id }))), {
    findItems: async (chunk) => chunk.map((id) => lookup(id)),
    stickersOf: async (itemId) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      if (itemId === 'i3') throw new ApiError('NOT_FOUND', 'tidak ada', '-');
      return [];
    },
    locations,
  });
  expect(peak).toBeLessThanOrEqual(VERIFY_CONCURRENCY);
  expect(report.rows[3]?.unresolved).toEqual(['item']);
  expect(report.unresolved).toBe(1);
});

test('id item beracun disaring sebelum dipotong: tidak menjatuhkan id sah dalam potongan yang sama', async () => {
  const poison = [`x${String.fromCharCode(44)}`, String.fromCharCode(44), 'a'.repeat(101), '   '];
  const ids = [...Array.from({ length: 10 }, (_, index) => `i${index}`), ...poison];
  const requested: string[][] = [];
  const report = await verifyImported(rowsFor(ids.map((id) => ({ id }))), {
    findItems: async (chunk) => {
      requested.push([...chunk]);
      return chunk.map((id) => lookup(id));
    },
    stickersOf: async () => [],
    locations,
  });
  expect(requested).toHaveLength(1);
  expect(requested[0]).toEqual(Array.from({ length: 10 }, (_, index) => `i${index}`));
  expect(report.unverified).toBe(0);
  expect(report.unresolved).toBe(poison.length);
  expect(report.rows.slice(0, 10).every((row) => row.unresolved === undefined)).toBe(true);
  for (const row of report.rows.slice(10)) expect(row.unresolved).toEqual(['item']);
});

test('isQueryableItemId: kosong, koma, dan lebih dari 100 unit UTF-16 ditolak', () => {
  expect(isQueryableItemId('abc-123')).toBe(true);
  expect(isQueryableItemId('a'.repeat(100))).toBe(true);
  expect(isQueryableItemId('a'.repeat(101))).toBe(false);
  expect(isQueryableItemId('')).toBe(false);
  expect(isQueryableItemId('  ')).toBe(false);
  expect(isQueryableItemId('a,b')).toBe(false);
});
