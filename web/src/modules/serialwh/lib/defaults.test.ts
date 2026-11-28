import { expect, test } from 'vitest';
import { defaultBuId, defaultLocationId } from './defaults';
import { makeExistingRow, makeNewRow } from './draft';
import { whSerial } from './test-support';

const existing = (id: string, buId: string, locationId: string) =>
  makeExistingRow(whSerial({ id, serial: `S-${id}`, buId, locationId }));
const fresh = (serial: string) =>
  makeNewRow({ serial, itemId: 'item1', buId: '', locationId: '', testDate: '' });

test('BU: data serial seragam menang atas chip form', () => {
  expect(
    defaultBuId({
      rows: [existing('a', 'bu2', 'l1')],
      chipBuId: 'bu1',
      itemBuIds: ['bu3'],
      buOptionIds: ['bu1', 'bu2'],
    }),
  ).toBe('bu2');
  expect(
    defaultBuId({
      rows: [existing('a', 'bu2', 'l1'), existing('b', 'bu1', 'l1')],
      chipBuId: 'bu1',
      itemBuIds: ['bu3'],
      buOptionIds: ['bu1', 'bu2'],
    }),
  ).toBe('bu1');
});

test('BU: sama pada semua serial yang ada dan boleh ditulis', () => {
  const rows = [existing('a', 'bu2', 'l1'), existing('b', 'bu2', 'l2'), fresh('N1')];
  expect(defaultBuId({ rows, chipBuId: '', itemBuIds: [], buOptionIds: ['bu1', 'bu2'] })).toBe(
    'bu2',
  );
});

test('BU: serial berbeda BU atau BU tak boleh ditulis jatuh ke cadangan satu BU Item', () => {
  const mixed = [existing('a', 'bu1', 'l1'), existing('b', 'bu2', 'l1')];
  expect(
    defaultBuId({
      rows: mixed,
      chipBuId: '',
      itemBuIds: ['bu1', 'bu9'],
      buOptionIds: ['bu1', 'bu2'],
    }),
  ).toBe('bu1');
  expect(
    defaultBuId({
      rows: [existing('a', 'bu9', 'l1')],
      chipBuId: '',
      itemBuIds: ['bu1'],
      buOptionIds: ['bu1'],
    }),
  ).toBe('bu1');
});

test('BU: semua serial baru dan lebih dari satu BU Item = kosong', () => {
  expect(
    defaultBuId({
      rows: [fresh('N1')],
      chipBuId: '',
      itemBuIds: ['bu1', 'bu2'],
      buOptionIds: ['bu1', 'bu2'],
    }),
  ).toBe('');
});

test('Lokasi: serial yang sama menang, lalu chip, lalu lokasi aktif tunggal', () => {
  const opts = ['l1', 'l2', 'l3'];
  expect(
    defaultLocationId({
      rows: [existing('a', 'bu1', 'l2')],
      chipLocationId: 'l1',
      activeLocationIds: [],
      locationOptionIds: opts,
    }),
  ).toBe('l2');
  expect(
    defaultLocationId({
      rows: [existing('a', 'bu1', 'l2'), existing('b', 'bu1', 'l3')],
      chipLocationId: 'l1',
      activeLocationIds: [],
      locationOptionIds: opts,
    }),
  ).toBe('l1');
  expect(
    defaultLocationId({
      rows: [existing('a', 'bu1', 'l2'), existing('b', 'bu1', 'l2')],
      chipLocationId: '',
      activeLocationIds: ['l3'],
      locationOptionIds: opts,
    }),
  ).toBe('l2');
  expect(
    defaultLocationId({
      rows: [existing('a', 'bu1', 'l2'), existing('b', 'bu1', 'l1')],
      chipLocationId: '',
      activeLocationIds: ['l3'],
      locationOptionIds: opts,
    }),
  ).toBe('l3');
});

test('Lokasi: lokasi aktif lebih dari satu atau di luar pilihan = kosong', () => {
  expect(
    defaultLocationId({
      rows: [fresh('N1')],
      chipLocationId: '',
      activeLocationIds: ['l1', 'l2'],
      locationOptionIds: ['l1', 'l2'],
    }),
  ).toBe('');
  expect(
    defaultLocationId({
      rows: [],
      chipLocationId: '',
      activeLocationIds: ['x'],
      locationOptionIds: ['l1'],
    }),
  ).toBe('');
});
