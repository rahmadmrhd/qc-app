import { expect, test } from 'bun:test';
import { stripComments } from './strip-comments';

test('komentar baris dan blok dibuang; kode dan nomor baris tetap', () => {
  const out = stripComments('a(); // <select>\n/* <select>\n lagi */ b();\n');
  expect(out).not.toContain('<select>');
  expect(out).toContain('a();');
  expect(out).toContain('b();');
  expect(out.split('\n')).toHaveLength(4);
});

test("literal 'image/*' tidak menelan kode sesudahnya sampai penutup komentar berikutnya (regresi penjaga web)", () => {
  const source = [
    "const accept = 'image/*';",
    'const el = <select />;',
    'const cls = "bg-red-500";',
    '/** JSDoc berikutnya */',
  ].join('\n');
  const out = stripComments(source);
  expect(out).toContain('<select />');
  expect(out).toContain('bg-red-500');
  expect(out).not.toContain('JSDoc');
});

test('// di dalam string dan template dipertahankan (URL, jalur)', () => {
  const out = stripComments('const u = "http://x.test/a"; const t = `//kelas`; // komentar');
  expect(out).toContain('http://x.test/a');
  expect(out).toContain('//kelas');
  expect(out).not.toContain('komentar');
});

test('regex dengan /* di dalamnya tidak dianggap komentar', () => {
  const out = stripComments('const re = /a/*b/; <select />');
  expect(out).toContain('<select />');
});
