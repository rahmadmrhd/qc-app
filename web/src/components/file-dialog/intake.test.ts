import { expect, test } from 'vitest';
import { intakeFiles } from './intake';

const accept = ['image/png', 'application/pdf'];
const make = (name: string, type: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

test('berkas sah masuk antrean dengan nama awal tanpa ekstensi', () => {
  const { queued, rejected } = intakeFiles([make('foto kardus.png', 'image/png')], {
    accept,
    maxBytes: 10_485_760,
    room: 5,
  });
  expect(rejected).toEqual([]);
  expect(queued).toHaveLength(1);
  expect(queued[0]?.name).toBe('foto kardus');
});

test('nama awal dipotong nameMax', () => {
  const { queued } = intakeFiles([make(`${'a'.repeat(200)}.png`, 'image/png')], {
    accept,
    maxBytes: 10_485_760,
    nameMax: 120,
    room: 5,
  });
  expect(queued[0]?.name).toHaveLength(120);
});

test('format salah dan terlalu besar ditolak dengan alasan', () => {
  const { queued, rejected } = intakeFiles(
    [make('a.gif', 'image/gif'), make('b.png', 'image/png', 11), make('c.png', 'image/png', 0)],
    { accept, maxBytes: 10, room: 5 },
  );
  expect(queued).toHaveLength(0);
  expect(rejected.map((r) => r.name)).toEqual(['a.gif', 'b.png', 'c.png']);
  expect(rejected[0]?.reason).toMatch(/GIF/);
  expect(rejected[1]?.reason).toBe('Ukuran melebihi 10 B');
  expect(rejected[2]?.reason).toBe('Berkas kosong');
});

test('melebihi room: sisanya ditolak dengan alasan Maksimal N berkas', () => {
  const files = [1, 2, 3, 4].map((i) => make(`f${i}.png`, 'image/png'));
  const { queued, rejected } = intakeFiles(files, { accept, maxBytes: 10_485_760, room: 2 });
  expect(queued.map((q) => q.name)).toEqual(['f1', 'f2']);
  expect(rejected).toEqual([
    { name: 'f3.png', reason: 'Maksimal 2 berkas' },
    { name: 'f4.png', reason: 'Maksimal 2 berkas' },
  ]);
});

test('max eksplisit dipakai pada pesan bila room tinggal sisa', () => {
  const { rejected } = intakeFiles([make('a.png', 'image/png')], {
    accept,
    maxBytes: 10_485_760,
    room: 0,
    max: 10,
  });
  expect(rejected[0]?.reason).toBe('Maksimal 10 berkas');
});

test('kunci unik walau nama berkas sama, juga antar panggilan', () => {
  const rule = { accept, maxBytes: 10_485_760, room: 5 };
  const a = intakeFiles([make('x.png', 'image/png'), make('x.png', 'image/png')], rule);
  const b = intakeFiles([make('x.png', 'image/png')], rule);
  const keys = [...a.queued, ...b.queued].map((q) => q.key);
  expect(new Set(keys).size).toBe(3);
});
