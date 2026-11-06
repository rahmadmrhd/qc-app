import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDumpInspector, inspectDumpLine } from './dump-inspect';

const TARGET = 'qc_restore_check';
const run = (text: string) => {
  const inspector = createDumpInspector(TARGET);
  inspector.feed(text);
  inspector.end();
};

describe('pemeriksa isi dump', () => {
  test('dump MariaDB 11 asli (baris sandbox, komentar bersyarat, DDL, INSERT) lolos', () => {
    const dump = [
      '/*M!999999\\- enable the sandbox mode */',
      '-- MariaDB dump 10.19  Distrib 11.8.2-MariaDB, for Linux (x86_64)',
      '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
      "/*!40103 SET TIME_ZONE='+00:00' */;",
      'DROP TABLE IF EXISTS `users`;',
      'CREATE TABLE `users` (',
      '  `id` int(11) NOT NULL,',
      "  `note` varchar(10) DEFAULT NULL COMMENT 'USE x; GRANT ALL',",
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;',
      '/*!40000 ALTER TABLE `users` DISABLE KEYS */;',
      'LOCK TABLES `users` WRITE;',
      "INSERT INTO `users` VALUES (1,'USE x; DROP DATABASE y; \\nGRANT ALL ON *.* TO z');",
      'UNLOCK TABLES;',
      '-- Dump completed on 2026-01-15  2:00:01',
      '',
    ].join('\n');
    expect(() => run(dump)).not.toThrow();
  });

  test('dump tanpa baris sandbox tetap lolos (tidak diwajibkan: tak terverifikasi pada klien image)', () => {
    expect(() => run('CREATE TABLE a (id int);\n-- Dump completed\n')).not.toThrow();
  });

  test('N3: kolom bernama seperti kata kunci terlarang di badan CREATE TABLE tidak ditolak', () => {
    const columns = [
      'source',
      'use',
      'system',
      'grant',
      'revoke',
      'kill',
      'shutdown',
      'connect',
      'tee',
      'delimiter',
      'set',
      'prepare',
    ];
    const dump = [
      'CREATE TABLE `jejak` (',
      ...columns.map((name) => `  \`${name}\` varchar(64) DEFAULT NULL,`),
      '  `kind` int(11) NOT NULL,',
      '  KEY `source` (`source`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
      "INSERT INTO `jejak` VALUES ('a','b','c','d','e','f','g','h','i','j','k','l',1);",
      '-- Dump completed',
      '',
    ].join('\n');
    expect(() => run(dump)).not.toThrow();
  });

  test('N3: badan CREATE TABLE tidak bisa dipakai menyembunyikan pernyataan (baris berakhiran ; menutup badan)', () => {
    expect(() => run('CREATE TABLE a (\n  id int);\nUSE mysql;\n-- Dump completed\n')).toThrow();
    expect(() =>
      run('CREATE TABLE a (\n  id int\n) ENGINE=InnoDB;\nUSE mysql;\n-- Dump completed\n'),
    ).toThrow();
  });

  test('bentuk berbahaya ditolak (huruf besar/kecil dan backtick tak dibedakan)', () => {
    const bad = [
      'USE x;',
      'use `qc_exec`;',
      'USE\tqc_exec;',
      '\\u x',
      '\\! cat /etc/passwd',
      'system cat /etc/passwd',
      'SYSTEM id',
      'CREATE DATABASE qc_exec;',
      'create schema `qc_exec`;',
      'DROP DATABASE qc_exec;',
      'drop database if exists qc_exec;',
      'ALTER DATABASE qc_exec CHARACTER SET latin1;',
      "GRANT ALL ON *.* TO 'x'@'%';",
      'revoke all on *.* from x;',
      "ALTER USER 'root'@'localhost' IDENTIFIED BY 'a';",
      "CREATE USER 'x'@'%';",
      "SET PASSWORD FOR 'root'@'localhost' = 'a';",
      'SET GLOBAL general_log_file = "/tmp/x";',
      'INSERT INTO mysql.user VALUES (1);',
      'INSERT INTO `mysql`.`user` VALUES (1);',
      'INSERT INTO`qc_exec`.`users` VALUES (1);',
      'INSERT /* c */ INTO qc_exec.users VALUES (1);',
      'INSERT LOW_PRIORITY INTO qc_exec.users VALUES (1);',
      'INSERT qc_exec.users VALUES (1);',
      'REPLACE qc_exec.users VALUES (1);',
      'insert ignore into `information_schema`.`x` values (1);',
      'UPDATE `qc_exec`.`users` SET a = 1;',
      'DELETE FROM qc_exec.users;',
      'DROP TABLE IF EXISTS `qc_exec`.`users`;',
      'TRUNCATE TABLE qc_exec.users;',
      'LOCK TABLES `qc_exec`.`users` WRITE;',
      "SELECT 1 INTO OUTFILE '/tmp/x';",
      '/*!40101 GRANT ALL ON *.* TO x */;',
      '/*M!100100 USE qc_exec */;',
      'SOURCE /tmp/x.sql',
      'connect qc_exec;',
      'tee /tmp/x',
      "EXECUTE IMMEDIATE 'DROP DATABASE qc_exec';",
      "PREPARE s FROM 'DROP DATABASE qc_exec';",
      'DELIMITER ;;',
      'delimiter //',
      'LOAD DATA INFILE "/etc/passwd" INTO TABLE a;',
      // di tengah baris (non-data)
      '/*!40101 SET NAMES utf8mb4 */; \\! id',
      'DROP TABLE IF EXISTS a; USE mysql;',
      'UNLOCK TABLES; GRANT ALL ON *.* TO x;',
      'SELECT 1; \\! id',
    ];
    for (const line of bad) {
      expect(() => run(`CREATE TABLE a (id int);\n${line}\n-- Dump completed\n`), line).toThrow();
    }
  });

  test('baris data INSERT tidak ditelusuri isinya (data sah dengan kata kunci/; di dalamnya lolos)', () => {
    expect(() =>
      run(
        "INSERT INTO `n` VALUES (1,'catatan; USE x; \\\\! id; DROP DATABASE y',2);\n-- Dump completed\n",
      ),
    ).not.toThrow();
  });

  test('penulisan berkualifikasi ke skema TARGET sendiri diizinkan', () => {
    expect(() =>
      inspectDumpLine(`INSERT INTO \`${TARGET}\`.\`users\` VALUES (1);`, TARGET),
    ).not.toThrow();
  });

  test('baris sangat panjang diperiksa dari awalannya saja; bahaya di baris berikutnya tetap tertangkap lintas potongan', () => {
    const inspector = createDumpInspector(TARGET);
    inspector.feed(`INSERT INTO \`a\` VALUES ('${'x'.repeat(5000)}`);
    inspector.feed(`${'y'.repeat(5000)}');\nUS`);
    expect(() => {
      inspector.feed('E qc_exec;\n');
    }).toThrow();
  });

  test('baris terakhir tanpa baris baru ikut diperiksa saat end()', () => {
    const inspector = createDumpInspector(TARGET);
    inspector.feed('USE qc_exec;');
    expect(() => inspector.end()).toThrow();
  });
});

describe('N3: penjaga skema', () => {
  test('seluruh SQL migrasi lolos pemeriksa: kolom/objek baru yang bentrok dengan aturan ketahuan di CI, bukan saat pemulihan bencana', () => {
    const dir = join(import.meta.dir, '../../../migrations');
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const inspector = createDumpInspector('qc_restore_check');
      expect(() => {
        inspector.feed(readFileSync(join(dir, file), 'utf8'));
        inspector.end();
      }, file).not.toThrow();
    }
  });
});
