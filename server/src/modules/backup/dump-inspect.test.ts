import { describe, expect, test } from 'bun:test';
import { createDumpInspector, inspectDumpLine } from './dump-inspect';

const TARGET = 'qc_restore_check';
const run = (text: string) => {
  const inspector = createDumpInspector(TARGET);
  inspector.feed(text);
  inspector.end();
};

describe('pemeriksa isi dump', () => {
  test('dump MariaDB 11 asli (baris sandbox, komentar bersyarat, DDL, INSERT, ekstensi) lolos', () => {
    const dump = [
      '/*M!999999\\- enable the sandbox mode */',
      '-- MariaDB dump 10.19  Distrib 11.8.2-MariaDB, for Linux (x86_64)',
      '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
      "/*!40103 SET TIME_ZONE='+00:00' */;",
      'DROP TABLE IF EXISTS `users`;',
      'CREATE TABLE `users` (',
      '  `id` int(11) NOT NULL,',
      "  `note` varchar(10) DEFAULT NULL COMMENT 'USE x; GRANT ALL'",
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;',
      '/*!40000 ALTER TABLE `users` DISABLE KEYS */;',
      'LOCK TABLES `users` WRITE;',
      "INSERT INTO `users` VALUES (1,'USE x; DROP DATABASE y; \\nGRANT ALL ON *.* TO z');",
      'UNLOCK TABLES;',
      'DELIMITER ;;',
      '-- Dump completed on 2026-01-15  2:00:01',
      '',
    ].join('\n');
    expect(() => run(dump)).not.toThrow();
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
      'INSERT INTO mysql.user VALUES (1);',
      'INSERT INTO `mysql`.`user` VALUES (1);',
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
      'LOAD DATA INFILE "/etc/passwd" INTO TABLE a;',
    ];
    for (const line of bad) {
      expect(() => run(`CREATE TABLE a (id int);\n${line}\n-- Dump completed\n`), line).toThrow();
    }
  });

  test('penulisan berkualifikasi ke skema TARGET sendiri diizinkan', () => {
    expect(() =>
      inspectDumpLine(`INSERT INTO \`${TARGET}\`.\`users\` VALUES (1);`, TARGET),
    ).not.toThrow();
  });

  test('baris sangat panjang diperiksa dari awalannya saja; bahaya tepat di baris berikutnya tetap tertangkap lintas potongan', () => {
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
