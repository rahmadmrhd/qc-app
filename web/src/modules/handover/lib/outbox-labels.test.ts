import { expect, test } from 'vitest';
import type { OutboxEntry } from './outbox';
import { copyableText, describeEntry } from './outbox-labels';

const check: OutboxEntry = {
  kind: 'check',
  id: 'a',
  taskId: 't',
  locationId: 'l',
  index: 0,
  text: 'A = 1',
  checked: true,
  at: 1,
};
const comment: OutboxEntry = {
  kind: 'comment',
  id: 'b',
  clientId: 'c',
  taskId: 't',
  locationId: 'l',
  quote: '',
  before: '',
  after: '',
  body: 'tolong dicek',
  at: 1,
};
const create = (names: string[]): OutboxEntry => ({
  kind: 'create',
  id: 'c',
  locationId: 'l',
  tasks: names.map((customerName, i) => ({
    clientId: `id${i}`,
    customerName,
    note: `catatan ${i}`,
  })),
  at: 1,
});

test('describeEntry: jenis dan isi singkat per jenis', () => {
  expect(describeEntry(check)).toEqual({ kind: 'Centang', target: 'A = 1' });
  expect(describeEntry(comment)).toEqual({ kind: 'Komentar', target: 'tolong dicek' });
  expect(describeEntry(create(['PT A']))).toEqual({ kind: 'Task baru', target: 'PT A' });
  expect(describeEntry(create(['PT A', 'PT B']))).toEqual({
    kind: 'Task baru',
    target: 'PT A, PT B',
  });
  expect(describeEntry(create(['PT A', 'PT B', 'PT C', 'PT D']))).toEqual({
    kind: 'Task baru',
    target: 'PT A, PT B (+2)',
  });
  expect(describeEntry(create(['', '  ']))).toEqual({ kind: 'Task baru', target: '2 task' });
});

test('copyableText: komentar apa adanya; task baru memuat nama customer lalu catatan, antar task baris kosong; centang tidak ada', () => {
  expect(copyableText(comment)).toBe('tolong dicek');
  expect(copyableText(create(['PT A', 'PT B']))).toBe(
    'Customer: PT A\n\ncatatan 0\n\nCustomer: PT B\n\ncatatan 1',
  );
  expect(copyableText(check)).toBeNull();
});

test('copyableText task baru: nama customer kosong/spasi saja = hanya catatan (campuran dengan yang bernama)', () => {
  expect(copyableText(create(['', '  ']))).toBe('catatan 0\n\ncatatan 1');
  expect(copyableText(create(['PT A', '']))).toBe('Customer: PT A\n\ncatatan 0\n\ncatatan 1');
});

test('copyableText task baru: karakter khusus pada nama dan catatan tidak diubah', () => {
  const entry: OutboxEntry = {
    kind: 'create',
    id: 'c',
    locationId: 'l',
    tasks: [
      {
        clientId: 'id0',
        customerName: 'PT "Maju" & <Jaya> 100% Ünïcode 😀',
        note: '*tebal* `kode` <b>x</b>\nbaris 2',
      },
    ],
    at: 1,
  };
  expect(copyableText(entry)).toBe(
    'Customer: PT "Maju" & <Jaya> 100% Ünïcode 😀\n\n*tebal* `kode` <b>x</b>\nbaris 2',
  );
});
