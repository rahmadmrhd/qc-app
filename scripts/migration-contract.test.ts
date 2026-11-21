import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasContractMarker, isDestructive, listContractMigrations } from './migration-contract';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'server', 'migrations');
const names = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const read = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

describe('isDestructive', () => {
  test('mengenali DROP COLUMN/TABLE/INDEX/CONSTRAINT/FOREIGN KEY, RENAME COLUMN/TABLE/TO, CHANGE COLUMN', () => {
    for (const sql of [
      'ALTER TABLE a DROP COLUMN b;',
      'ALTER TABLE a DROP INDEX i;',
      'ALTER TABLE a DROP CONSTRAINT c;',
      'ALTER TABLE a DROP FOREIGN KEY f;',
      'DROP TABLE a;',
      'DROP TABLE IF EXISTS a;',
      'ALTER TABLE a RENAME COLUMN x TO y;',
      'ALTER TABLE a RENAME TO b;',
      'RENAME TABLE a TO b;',
      'ALTER TABLE a CHANGE COLUMN x y INT;',
    ]) {
      expect(isDestructive(sql), sql).toBe(true);
    }
  });

  test('tanpa memperhatikan huruf besar/kecil dan spasi/baris baru di antara kata', () => {
    expect(isDestructive('alter table a drop column b')).toBe(true);
    expect(isDestructive('ALTER TABLE a\n  DROP\n  COLUMN b')).toBe(true);
    expect(isDestructive('drop   table\tif exists a')).toBe(true);
  });

  test('DDL tambahan (CREATE, ADD COLUMN, MODIFY, INSERT/UPDATE) tidak dihitung', () => {
    for (const sql of [
      'CREATE TABLE a (id INT);',
      'ALTER TABLE a ADD COLUMN b INT;',
      'ALTER TABLE a ADD INDEX i (b);',
      'ALTER TABLE a MODIFY COLUMN b INT NULL;',
      'UPDATE a SET b = 1;',
      'INSERT INTO a VALUES (1);',
    ]) {
      expect(isDestructive(sql), sql).toBe(false);
    }
  });

  test('baris komentar -- dan blok /* */ yang memuat kata DROP tidak dihitung', () => {
    expect(
      isDestructive('-- nanti DROP COLUMN b di rilis berikutnya\nALTER TABLE a ADD c INT;'),
    ).toBe(false);
    expect(isDestructive('/* DROP TABLE a */ SELECT 1;')).toBe(false);
    expect(isDestructive('-- komentar\nDROP TABLE a;')).toBe(true);
  });
});

describe('hasContractMarker', () => {
  test('baris PERTAMA persis -- qc:contract (boleh diikuti spasi) dikenali', () => {
    expect(hasContractMarker('-- qc:contract\nDROP TABLE a;')).toBe(true);
    expect(hasContractMarker('-- qc:contract   \nDROP TABLE a;')).toBe(true);
    expect(hasContractMarker('-- qc:contract\r\nDROP TABLE a;')).toBe(true);
    expect(hasContractMarker('-- qc:contract')).toBe(true);
  });

  test('bukan di baris pertama, ada spasi di depan, atau teks lain: tidak dikenali', () => {
    expect(hasContractMarker('-- komentar\n-- qc:contract\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker(' -- qc:contract\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker('\n-- qc:contract\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker('-- qc:contract-x\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker('--qc:contract\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker('-- QC:CONTRACT\nDROP TABLE a;')).toBe(false);
    expect(hasContractMarker('')).toBe(false);
  });
});

describe('listContractMigrations', () => {
  test('mengembalikan nama berpenanda contract saja, urut seperti masukan', () => {
    const files: Record<string, string> = {
      '0001_a.sql': 'CREATE TABLE a (id INT);',
      '0002_b.sql': '-- qc:contract\nDROP TABLE a;',
      '0003_c.sql': '-- qc:contract\nALTER TABLE x DROP COLUMN y;',
    };
    expect(listContractMigrations(Object.keys(files), (name) => files[name] ?? '')).toEqual([
      '0002_b.sql',
      '0003_c.sql',
    ]);
  });
});

describe('server/migrations: konvensi qc:contract', () => {
  test('ada migrasi yang dibaca (tes tidak kosong)', () => {
    expect(names.length).toBeGreaterThan(20);
  });

  test('setiap migrasi destruktif WAJIB berbaris pertama -- qc:contract (pagar downgrade deploy.sh membacanya dari image)', () => {
    const missing = names.filter(
      (name) => isDestructive(read(name)) && !hasContractMarker(read(name)),
    );
    expect(missing).toEqual([]);
  });

  test('penanda hanya dipasang pada migrasi yang memang destruktif', () => {
    const extra = names.filter(
      (name) => hasContractMarker(read(name)) && !isDestructive(read(name)),
    );
    expect(extra).toEqual([]);
  });

  test('migrasi destruktif yang ada kini: 0002, 0003, 0012, 0030', () => {
    expect(listContractMigrations(names, read)).toEqual([
      '0002_hapus_sync_rev.sql',
      '0003_hapus_external_id.sql',
      '0012_serial_number.sql',
      '0030_soft_delete_contract.sql',
    ]);
  });
});
