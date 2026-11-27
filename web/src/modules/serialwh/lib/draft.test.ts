import { expect, test } from 'vitest';
import {
  addRow,
  isFrozen,
  makeExistingRow,
  makeNewRow,
  missingDefaults,
  missingMessage,
  removeRows,
  rowKey,
  summarizeRows,
  toSubmitRows,
} from './draft';
import { whSerial } from './test-support';

const newRow = (serial: string, testDate = '2026-11-20') =>
  makeNewRow({ serial, itemId: 'item1', buId: 'bu1', locationId: 'loc1', testDate });

test('baris ditambah di akhir (urutan scan) dan serial ganda diabaikan', () => {
  const a = makeExistingRow(whSerial({ id: 'a', serial: 'A' }));
  const b = newRow('B');
  let rows = addRow([], a);
  rows = addRow(rows, b);
  rows = addRow(rows, newRow('A'));
  expect(rows.map((row) => row.serial)).toEqual(['A', 'B']);
  expect(toSubmitRows(rows).map((row) => row.serial)).toEqual(['A', 'B']);
});

test('clientId baris baru dibuat sekali dan tidak berubah', () => {
  const row = newRow('B');
  const key = rowKey(row);
  expect(rowKey(row)).toBe(key);
  expect(key.startsWith('new:')).toBe(true);
  expect(toSubmitRows([row])).toEqual(toSubmitRows([row]));
});

test('hapus baris menurut kunci', () => {
  const rows = [makeExistingRow(whSerial({ id: 'a', serial: 'A' })), newRow('B')];
  const rest = removeRows(rows, new Set(['a']));
  expect(rest.map((row) => row.serial)).toEqual(['B']);
});

test('ringkasan: jumlah, baru, rentang tanggal uji', () => {
  const rows = [
    makeExistingRow(whSerial({ id: 'a', serial: 'A', testDate: '2026-11-18' })),
    newRow('B', '2026-11-22'),
  ];
  expect(summarizeRows(rows)).toEqual({
    total: 2,
    newCount: 1,
    existingCount: 1,
    testDateFrom: '2026-11-18',
    testDateTo: '2026-11-22',
  });
});

test('hanya Item yang menahan scan; BU, Lokasi, dan Tanggal uji adalah filter', () => {
  const empty = { buId: '', locationId: '', testDate: '', hideRecorded: true };
  expect(missingDefaults('i', empty)).toEqual([]);
  expect(missingDefaults('', empty)).toEqual(['item']);
  expect(missingMessage(['item'])).toBe('Pilih Item dulu');
  expect(missingMessage([])).toBe('');
});

test('kiriman beku saat submission ada', () => {
  expect(isFrozen({})).toBe(false);
  expect(
    isFrozen({
      submission: {
        clientId: 'c',
        chunkSize: 200,
        sentChunks: 0,
        header: {
          dispatchedOn: '',
          orderNumber: '',
          buId: '',
          customerName: '',
          itemId: '',
          note: '',
          handoverIds: [],
          total: 0,
          chunkSize: 200,
        },
      },
    }),
  ).toBe(true);
});
