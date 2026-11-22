import { listSerialsTooLong, SERIAL_LIMITS } from '@shared/serials';
import { describe, expect, test } from 'vitest';
import {
  commitSearchLine,
  filterOfSearch,
  mergeScanned,
  normalizeSearchText,
  SERIAL_SEARCH_MAX,
  serialSearchSchema,
} from './list-filter';

test('schema membuang nilai tak sah alih-alih menggagalkan URL', () => {
  const parsed = serialSearchSchema.parse({
    status: 'ngawur',
    from: '2026-13-45',
    to: '2026-11-30',
    item: 5,
  });
  expect(parsed).toEqual({ to: '2026-11-30' });
});

test('normalizeSearchText: normalisasi, buang ganda dan baris kosong, batas = SERIAL_LIMITS.listSerialsMax', () => {
  expect(normalizeSearchText(' abc \n \n4c:5e:0c:1a:2b:3d\nABC').text).toBe('ABC\n4C5E0C1A2B3D');
  expect(SERIAL_SEARCH_MAX).toBe(SERIAL_LIMITS.listSerialsMax);
  const lines = Array.from({ length: SERIAL_SEARCH_MAX + 7 }, (_, index) => `S${index}`);
  const result = normalizeSearchText(lines.join('\n'));
  expect(result.count).toBe(SERIAL_SEARCH_MAX);
  expect(result.capped).toBe(true);
  expect(result.dropped).toBe(7);
  const exact = normalizeSearchText(lines.slice(0, SERIAL_SEARCH_MAX).join('\n'));
  expect(exact.capped).toBe(false);
  expect(exact.dropped).toBe(0);
});

test('filterOfSearch: satu serial = query, banyak = serials, filter lain diteruskan', () => {
  expect(filterOfSearch({})).toEqual({});
  expect(filterOfSearch({ sn: 'abc' })).toEqual({ query: 'ABC' });
  expect(filterOfSearch({ sn: 'a1\nb2' })).toEqual({ serials: 'A1\nB2' });
  // Param tunggal lama (tautan View item/lokasi) dibaca sebagai daftar berisi satu nilai.
  expect(
    filterOfSearch({ item: 'i1', loc: 'l1', status: 'good', from: '2026-11-01', to: '2026-11-30' }),
  ).toEqual({
    itemIds: ['i1'],
    locationIds: ['l1'],
    statuses: ['good'],
    from: '2026-11-01',
    to: '2026-11-30',
  });
});

test('filterOfSearch: param jamak diteruskan sebagai daftar dan menang atas param tunggal lama', () => {
  expect(
    filterOfSearch({
      buIds: ['b1', 'b2'],
      itemIds: ['i1', 'i2'],
      locationIds: ['l1'],
      statuses: ['good', 'reported'],
      custodies: ['qc', 'transit'],
      bu: 'b9',
      item: 'i9',
      status: 'broken',
    }),
  ).toEqual({
    buIds: ['b1', 'b2'],
    itemIds: ['i1', 'i2'],
    locationIds: ['l1'],
    statuses: ['good', 'reported'],
    custodies: ['qc', 'transit'],
  });
});

test('serialSearchSchema: larik jamak sah dibaca, nilai enum tak sah membuang seluruh larik (bukan galat)', () => {
  expect(
    serialSearchSchema.parse({ statuses: ['good', 'reported'], buIds: ['b1'], custodies: ['qc'] }),
  ).toEqual({ statuses: ['good', 'reported'], buIds: ['b1'], custodies: ['qc'] });
  expect(
    serialSearchSchema.parse({ statuses: ['good', 'ngawur'], itemIds: 'bukan-larik' }),
  ).toEqual({});
});

test('filterOfSearch: deleted hanya berlaku bagi pemegang manage; daftar status ikut apa adanya', () => {
  expect(filterOfSearch({ deleted: true }, undefined, true)).toEqual({ deleted: true });
  expect(filterOfSearch({ deleted: true }, undefined, false)).toEqual({});
});

test('normalizeSearchText: serial panjang non-ASCII dipotong menurut listSerialsTooLong (fungsi bersama dengan server)', () => {
  const wide = Array.from(
    { length: 40 },
    (_, index) => `${String.fromCharCode(233).repeat(60)}${index}`,
  );
  const result = normalizeSearchText(wide.join(String.fromCharCode(10)));
  expect(result.tooLong).toBe(true);
  expect(result.capped).toBe(true);
  expect(result.count).toBeGreaterThan(0);
  expect(result.count).toBeLessThan(40);
  expect(result.dropped).toBe(40 - result.count);
  expect(listSerialsTooLong(result.text)).toBe(false);
  // Serial berikutnya akan melewati batas: awalan yang dipertahankan sudah maksimal.
  expect(listSerialsTooLong(`${result.text}${String.fromCharCode(10)}${wide[result.count]}`)).toBe(
    true,
  );
  // Serial ASCII biasa: batas jumlah (bukan panjang) yang berlaku.
  const plain = normalizeSearchText(
    Array.from({ length: 60 }, (_, index) => `S${String(index).padStart(60, '0')}`).join(
      String.fromCharCode(10),
    ),
  );
  expect(plain.tooLong).toBe(false);
  expect(plain.count).toBe(SERIAL_SEARCH_MAX);
});

describe('mergeScanned', () => {
  test('menambah serial baru tanpa duplikat dan menormalkannya', () => {
    expect(mergeScanned('AAA111', 'bbb222\nAAA111\n4c:5e:0c:1a:2b:3d')).toEqual({
      text: 'AAA111\nBBB222\n4C5E0C1A2B3D',
      feedback: 'added',
    });
  });

  test('semua sudah ada: duplicate; tak ada yang sah: rejected; teks tak berubah', () => {
    expect(mergeScanned('AAA111', 'aaa111')).toEqual({ text: 'AAA111', feedback: 'duplicate' });
    expect(mergeScanned('AAA111', 'X'.repeat(200))).toEqual({
      text: 'AAA111',
      feedback: 'rejected',
    });
  });

  test('daftar penuh: ditolak', () => {
    const full = Array.from({ length: SERIAL_SEARCH_MAX }, (_, i) => `S${i}`).join('\n');
    expect(mergeScanned(full, 'EXTRA').feedback).toBe('rejected');
  });

  // Dialog kamera menerapkan hasilnya saat "Simpan" satu serial per panggilan: hasil akhirnya harus sama dengan satu kali banyak baris.
  test('dipanggil per serial berturut-turut menghasilkan teks yang sama dengan satu panggilan banyak baris', () => {
    const rows = ['bbb222', 'AAA111', 'ccc333'];
    let text = 'AAA111';
    const feedbacks: string[] = [];
    for (const serial of rows) {
      const result = mergeScanned(text, serial);
      text = result.text;
      feedbacks.push(result.feedback);
    }
    expect(text).toBe(mergeScanned('AAA111', rows.join('\n')).text);
    expect(feedbacks).toEqual(['added', 'duplicate', 'added']);
  });
});

describe('mergeScanned (teks yang sudah ada dibiarkan mentah)', () => {
  test('hanya baris yang ditambahkan yang dinormalkan; sisa teks tak diubah', () => {
    expect(mergeScanned('ab\nbaris tak sah \u0001', 'xyz').text).toBe(
      'ab\nbaris tak sah \u0001\nXYZ',
    );
    expect(mergeScanned('ab\n\n', 'xyz').text).toBe('ab\nXYZ');
  });

  test('daftar mentah yang sudah melebihi batas tidak dipangkas dan tidak ditambah', () => {
    const raw = Array.from({ length: SERIAL_SEARCH_MAX + 30 }, (_, i) => `s${i}`).join('\n');
    expect(mergeScanned(raw, 'baru')).toEqual({ text: raw, feedback: 'rejected' });
  });

  test('sebagian muat: yang muat masuk, umpan balik rejected', () => {
    const almost = Array.from({ length: SERIAL_SEARCH_MAX - 1 }, (_, i) => `S${i}`).join('\n');
    const result = mergeScanned(almost, 'AAA\nBBB');
    expect(result.feedback).toBe('rejected');
    expect(result.text.endsWith('\nAAA')).toBe(true);
    expect(result.text).not.toContain('BBB');
  });
});

describe('commitSearchLine', () => {
  test('baris terakhir sah: dinormalkan, baris baru ditambahkan, kursor di sana', () => {
    expect(commitSearchLine('AAA\nbbb', 7)).toEqual({
      text: 'AAA\nBBB\n',
      caret: 8,
      feedback: 'added',
    });
  });

  test('baris tengah sah: dinormalkan di tempat, baris lain tak berubah, kursor ke awal baris berikutnya', () => {
    expect(commitSearchLine('aaa\nccc\nddd', 5)).toEqual({
      text: 'aaa\nCCC\nddd',
      caret: 8,
      feedback: 'added',
    });
  });

  test('duplikat atau tak sah: hanya baris itu dibuang; baris lain (mentah, di luar batas) tetap', () => {
    expect(commitSearchLine('AAA\naaa', 7)).toEqual({
      text: 'AAA\n',
      caret: 4,
      feedback: 'duplicate',
    });
    expect(commitSearchLine('sisa mentah\nA\u0001B', 15)).toEqual({
      text: 'sisa mentah\n',
      caret: 12,
      feedback: 'rejected',
    });
  });

  test('baris kosong tidak berbuat apa-apa', () => {
    expect(commitSearchLine('AAA\n', 4)).toBeNull();
    expect(commitSearchLine('', 0)).toBeNull();
  });

  test('melebihi batas: baris tetap, umpan balik rejected', () => {
    const full = `${Array.from({ length: SERIAL_SEARCH_MAX }, (_, i) => `S${i}`).join('\n')}\nEXTRA`;
    const result = commitSearchLine(full, full.length);
    expect(result?.feedback).toBe('rejected');
    expect(result?.text).toBe(`${full}\n`);
  });
});

test('filter BU, posisi, dan "Dicatat oleh saya" masuk masukan serials.list; schema membuang nilai tak sah', () => {
  expect(filterOfSearch({ bu: 'b1', custody: 'transit' })).toEqual({
    buIds: ['b1'],
    custodies: ['transit'],
  });
  // Sakelar mine hanya bermakna bersama email akun.
  expect(filterOfSearch({ mine: true }, 'a@x.com')).toEqual({ createdBy: 'a@x.com' });
  expect(filterOfSearch({ mine: true })).toEqual({});
  expect(filterOfSearch({}, 'a@x.com')).toEqual({});
  expect(serialSearchSchema.parse({ custody: 'ngawur', mine: false, bu: 'b1' })).toEqual({
    bu: 'b1',
  });
  expect(serialSearchSchema.parse({ custody: 'service', mine: true })).toEqual({
    custody: 'service',
    mine: true,
  });
});
