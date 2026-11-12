import { QCSN_MAX_ROWS } from '@shared/serial-file';
import { expect, test } from 'vitest';
import { addSerials, type Defaults, type StagingRow } from './draft';
import { exportableRows, exportQcsn, importQcsn } from './qcsn';

const defaults: Defaults = {
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  buId: 'b1',
  buLabel: 'BU1',
  testDate: '2026-11-12',
  locationId: 'l1',
  locationLabel: 'Jakarta',
  sample: true,
  note: 'catatan',
};

function rows(texts: string[], over: Partial<Defaults> = {}): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    texts.join('\n'),
    { ...defaults, ...over },
    () => `row-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
}

const APP = { name: 'qc-web', version: '1.0.0' };
const NOW = new Date('2026-11-12T10:05:00.000Z');

test('ekspor lalu impor mengembalikan baris yang sama (termasuk stiker bila sudah dipilih)', async () => {
  const data = rows(['4c:5e:0c:1a:2b:3d', 'SN-1']).map((row, index) =>
    index === 0 ? { ...row, stickers: [{ stickerId: 's1', name: 'Stiker', qty: 2 }] } : row,
  );
  const text = await exportQcsn(data, APP, NOW);
  const file = JSON.parse(text);
  expect(file).toMatchObject({ format: 'qc-sn-batch', version: 1, app: APP });
  expect(file.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  const result = await importQcsn(text);
  expect(result.fatal).toBeNull();
  expect(result.problems).toEqual([]);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({
    clientId: 'row-00000001',
    serial: '4C5E0C1A2B3D',
    itemId: 'i1',
    buId: 'b1',
    locationId: 'l1',
    sample: true,
    note: 'catatan',
    stickers: [{ stickerId: 's1', stickerLabel: 'Stiker', qty: 2 }],
  });
  expect(result.rows[1]?.stickers).toBeUndefined();
});

test('checksum diubah atau isi diubah: fatal', async () => {
  const text = await exportQcsn(rows(['A1']), APP, NOW);
  const file = JSON.parse(text);
  file.checksum = `sha256:${'0'.repeat(64)}`;
  const result = await importQcsn(JSON.stringify(file));
  expect(result.fatal).toMatch(/checksum/i);
  expect(result.rows).toEqual([]);
  const edited = await importQcsn(text.replace('"A1"', '"A2"'));
  expect(edited.fatal).toMatch(/checksum/i);
});

test('baris belum lengkap (tanpa item) tidak diekspor', async () => {
  const incomplete = rows(['B2'], { itemId: '', itemLabel: '' }).map((row) => ({
    ...row,
    clientId: 'row-incomplete1',
  }));
  const data = [...rows(['A1']), ...incomplete];
  expect(exportableRows(data).map((row) => row.serial)).toEqual(['A1']);
  const result = await importQcsn(await exportQcsn(data, APP, NOW));
  expect(result.fatal).toBeNull();
  expect(result.rows.map((row) => row.serial)).toEqual(['A1']);
});

test('kunci __proto__ tidak mencemari prototipe', async () => {
  const text = await exportQcsn(rows(['A1']), APP, NOW);
  const evil = text
    .replace('"rows":[{', '"__proto__":{"polluted":true},"rows":[{"__proto__":{"polluted":true},')
    .replace('"checksum"', '"__proto__":{"polluted":true},"checksum"');
  const result = await importQcsn(evil);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(result.fatal).toBeNull();
  expect(Object.hasOwn(result.rows[0] ?? {}, 'polluted')).toBe(false);
  expect((result.rows[0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
});

test('1.001 baris, versi lebih baru, bukan berkas QC, dan bukan JSON: fatal', async () => {
  const base = JSON.parse(await exportQcsn(rows(['A1']), APP, NOW));
  const row = base.rows[0];
  const tooMany = JSON.stringify({
    ...base,
    rows: Array.from({ length: QCSN_MAX_ROWS + 1 }, (_, index) => ({
      ...row,
      clientId: `row-${String(index).padStart(8, '0')}`,
      serial: `S${index}`,
    })),
  });
  expect((await importQcsn(tooMany)).fatal).toMatch(/1000/);
  expect((await importQcsn(JSON.stringify({ ...base, version: 2 }))).fatal).toMatch(/versi/i);
  expect((await importQcsn('{"format":"lain"}')).fatal).not.toBeNull();
  expect((await importQcsn('bukan json')).fatal).not.toBeNull();
});

test('baris bermasalah dilaporkan tanpa menggagalkan berkas', async () => {
  const base = JSON.parse(await exportQcsn(rows(['A1', 'B2']), APP, NOW));
  base.rows[1].testDate = 'kemarin';
  const result = await importQcsn(JSON.stringify(base));
  expect(result.fatal).toBeNull();
  expect(result.rows.map((row) => row.serial)).toEqual(['A1']);
  expect(result.problems).toEqual([{ row: 2, message: expect.stringContaining('testDate') }]);
});
