import { describe, expect, test } from 'bun:test';
import { parseDump } from './dump';
import { uuidV5 } from './uuid';

describe('parseDump', () => {
  test('tuple banyak baris: angka, NULL, string dengan escape dan kutip ganda', () => {
    const text = [
      '-- komentar',
      'CREATE TABLE `t` (id int);',
      "INSERT INTO `t` VALUES (1,'a\\'b',NULL),(2,'x''y\\n',-3),(3,'a,b)(c',0);",
      "INSERT INTO `u` VALUES (7,'Re-added to Database');",
    ].join('\n');
    const tables = parseDump(text);
    expect(tables.t).toEqual([
      [1, "a'b", null],
      [2, "x'y\n", -3],
      [3, 'a,b)(c', 0],
    ]);
    expect(tables.u).toEqual([[7, 'Re-added to Database']]);
  });

  test('beberapa INSERT untuk satu tabel digabung berurutan', () => {
    const tables = parseDump("INSERT INTO `t` VALUES (1,'a');\nINSERT INTO `t` VALUES (2,'b');");
    expect(tables.t).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  test('string tak tertutup melempar galat yang jelas', () => {
    expect(() => parseDump("INSERT INTO `t` VALUES (1,'abc);")).toThrow('tidak tertutup');
  });
});

describe('uuidV5', () => {
  test('cocok dengan vektor baku RFC 4122 (DNS, python.org)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  test('deterministik dan berbentuk UUID huruf kecil', () => {
    expect(uuidV5('serial:1')).toBe(uuidV5('serial:1'));
    expect(uuidV5('serial:1')).not.toBe(uuidV5('serial:2'));
    expect(uuidV5('serial:1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
