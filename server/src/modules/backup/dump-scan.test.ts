import { describe, expect, test } from 'bun:test';
import { createDumpScanner } from './dump-scan';

function scan(text: string, chunkSize = Number.POSITIVE_INFINITY) {
  const scanner = createDumpScanner();
  if (chunkSize === Number.POSITIVE_INFINITY) scanner.feed(text);
  else
    for (let index = 0; index < text.length; index += chunkSize)
      scanner.feed(text.slice(index, index + chunkSize));
  const result = scanner.end();
  return { tables: result.tables, rows: Object.fromEntries(result.rows) };
}

const DUMP = [
  '/*M!999999\\- enable the sandbox mode */',
  'DROP TABLE IF EXISTS `users`;',
  'CREATE TABLE `users` (',
  '  `id` int(11) NOT NULL,',
  "  `name` varchar(50) DEFAULT 'a(b'",
  ') ENGINE=InnoDB;',
  'LOCK TABLES `users` WRITE;',
  '/*!40000 ALTER TABLE `users` DISABLE KEYS */;',
  "INSERT INTO `users` VALUES (1,'ani'),(2,'budi'),(3,NULL);",
  "INSERT INTO `users` VALUES (4,'cici');",
  'CREATE TABLE `empty_one` (`id` int);',
  'CREATE TABLE `blobs` (`id` int, `b` blob);',
  'INSERT INTO `blobs` VALUES (1,0x28292728),(2,NULL);',
  '-- Dump completed on 2026-01-15',
  '',
].join('\n');

describe('createDumpScanner', () => {
  test('menghitung tuple per tabel dan mencatat nama tabel dari CREATE TABLE', () => {
    const result = scan(DUMP);
    expect(result.tables).toEqual(['users', 'empty_one', 'blobs']);
    expect(result.rows).toEqual({ users: 4, blobs: 2 });
  });

  test('tahan terhadap string berisi kurung, koma, titik koma, kutip, dan garis miring terbalik', () => {
    const sql = [
      'CREATE TABLE `t` (`a` text);',
      "INSERT INTO `t` VALUES ('),('),('x;y'),('it\\'s'),('back\\\\'),('dua''kutip'),('(');",
      "INSERT INTO `t` VALUES ('akhir\\\\\\'');",
    ].join('\n');
    // Tuple: '),(' | 'x;y' | 'it\'s' | 'back\\' | 'dua''kutip' | '(' = 6, lalu satu lagi pada pernyataan kedua.
    expect(scan(sql).rows).toEqual({ t: 7 });
  });

  test('hasil sama untuk potongan sekecil satu karakter (potongan jatuh di mana saja)', () => {
    const whole = scan(DUMP);
    for (const size of [1, 2, 3, 7, 16]) {
      expect(scan(DUMP, size)).toEqual(whole);
    }
  });

  test('baris tanpa baris baru penutup tetap dihitung', () => {
    expect(scan('CREATE TABLE `t` (`a` int);\nINSERT INTO `t` VALUES (1),(2)').rows).toEqual({
      t: 2,
    });
  });

  test('nama tabel berbacktick ganda dan INSERT dengan daftar kolom dikenali', () => {
    const result = scan(
      'CREATE TABLE `a``b` (`x` int);\nINSERT INTO `a``b` (`x`) VALUES (1),(2),(3);\n',
    );
    expect(result.tables).toEqual(['a`b']);
    expect(result.rows).toEqual({ 'a`b': 3 });
  });

  test('baris data tanpa titik koma di akhir dan dump kosong tidak membuat hitungan palsu', () => {
    expect(scan('').rows).toEqual({});
    expect(scan('-- hanya komentar\n/*!40101 SET NAMES utf8 */;\n').tables).toEqual([]);
  });

  test('pernyataan lain setelah titik koma pada baris yang sama tidak dihitung sebagai data', () => {
    const result = scan(
      'CREATE TABLE `t` (`a` int);\nINSERT INTO `t` VALUES (1); SELECT (2),(3);\n',
    );
    expect(result.rows).toEqual({ t: 1 });
  });
});
