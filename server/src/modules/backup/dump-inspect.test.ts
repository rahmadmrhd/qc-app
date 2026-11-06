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

  test('badan CREATE TABLE ditutup baris berakhiran ";" dan pernyataan sesudahnya tetap diperiksa', () => {
    expect(() => run('CREATE TABLE a (\n  id int);\nUSE mysql;\n-- Dump completed\n')).toThrow();
    expect(() =>
      run('CREATE TABLE a (\n  id int\n) ENGINE=InnoDB;\nUSE mysql;\n-- Dump completed\n'),
    ).toThrow();
    // Pernyataan di baris penutup yang sama setelah ";" juga ditolak.
    expect(() => run('CREATE TABLE a (\n  `id` int); USE mysql;\n-- Dump completed\n')).toThrow();
  });

  test('M1: perintah klien di DALAM badan CREATE TABLE ditolak (tanpa menolak kolom berbacktick bernama sama)', () => {
    const inBody = (line: string) => `CREATE TABLE a (\n  \`id\` int,\n${line}\n  \`x\` int\n);\n`;
    for (const line of [
      '\\! id',
      '\\. /etc/passwd',
      '  \\! id',
      'system id',
      'SYSTEM id',
      'source /tmp/x.sql',
      'connect other',
      'tee /tmp/out',
      'delimiter ;;',
    ]) {
      expect(() => run(inBody(line)), line).toThrow();
    }
    // Kolom berbacktick dengan nama yang sama tetap lolos (N3 tak hidup lagi).
    expect(() =>
      run(
        inBody(
          '  `source` varchar(64),\n  `system` int,\n  `use` int,\n  `grant` int,\n  `kill` int,',
        ),
      ),
    ).not.toThrow();
  });

  test('M2: sisa risiko yang DITERIMA: pernyataan tersembunyi di baris badan yang tak berakhiran ";" tak terlihat (pertahanan utama = pengguna qc_restore)', () => {
    // Bukti jujur batas pemeriksa berbasis baris: ini lolos; yang menahannya adalah hak terbatas `qc_restore`.
    expect(() =>
      run('CREATE TABLE a (\n  `id` int) ; USE mysql\n);\n-- Dump completed\n'),
    ).not.toThrow();
  });

  test('bentuk berbahaya ditolak (huruf besar/kecil dan backtick tak dibedakan)', () => {
    const bad = [
      'USE x;',
      'use `qc_production`;',
      'USE\tqc_production;',
      '\\u x',
      '\\! cat /etc/passwd',
      'system cat /etc/passwd',
      'SYSTEM id',
      'CREATE DATABASE qc_production;',
      'create schema `qc_production`;',
      'DROP DATABASE qc_production;',
      'drop database if exists qc_production;',
      'ALTER DATABASE qc_production CHARACTER SET latin1;',
      "GRANT ALL ON *.* TO 'x'@'%';",
      'revoke all on *.* from x;',
      "ALTER USER 'root'@'localhost' IDENTIFIED BY 'a';",
      "CREATE USER 'x'@'%';",
      "SET PASSWORD FOR 'root'@'localhost' = 'a';",
      'SET GLOBAL general_log_file = "/tmp/x";',
      'INSERT INTO mysql.user VALUES (1);',
      'INSERT INTO `mysql`.`user` VALUES (1);',
      'INSERT INTO`qc_production`.`users` VALUES (1);',
      'INSERT /* c */ INTO qc_production.users VALUES (1);',
      'INSERT LOW_PRIORITY INTO qc_production.users VALUES (1);',
      'INSERT qc_production.users VALUES (1);',
      'REPLACE qc_production.users VALUES (1);',
      'insert ignore into `information_schema`.`x` values (1);',
      'UPDATE `qc_production`.`users` SET a = 1;',
      'DELETE FROM qc_production.users;',
      'DROP TABLE IF EXISTS `qc_production`.`users`;',
      'TRUNCATE TABLE qc_production.users;',
      'LOCK TABLES `qc_production`.`users` WRITE;',
      "SELECT 1 INTO OUTFILE '/tmp/x';",
      '/*!40101 GRANT ALL ON *.* TO x */;',
      '/*M!100100 USE qc_production */;',
      'SOURCE /tmp/x.sql',
      'connect qc_production;',
      'tee /tmp/x',
      "EXECUTE IMMEDIATE 'DROP DATABASE qc_production';",
      "PREPARE s FROM 'DROP DATABASE qc_production';",
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
      inspector.feed('E qc_production;\n');
    }).toThrow();
  });

  test('baris terakhir tanpa baris baru ikut diperiksa saat end()', () => {
    const inspector = createDumpInspector(TARGET);
    inspector.feed('USE qc_production;');
    expect(() => inspector.end()).toThrow();
  });
});

describe('N3/M3: penjaga skema', () => {
  const dir = join(import.meta.dir, '../../../migrations');
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));

  test('SQL migrasi lolos pemeriksa pada tingkat pernyataan (badan CREATE TABLE dilewati, jadi ini BUKAN bukti dump penuh lolos)', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const inspector = createDumpInspector('qc_restore_check');
      expect(() => {
        inspector.feed(readFileSync(join(dir, file), 'utf8'));
        inspector.end();
      }, file).not.toThrow();
    }
  });

  test('M3: skema tak memuat trigger/rutin/event (dump-nya memakai DELIMITER yang ditolak CLI pemulihan; menambahkannya = putusan sadar melonggarkan aturan)', () => {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const routine =
        /create\s+(?:or\s+replace\s+)?(?:definer\s*=\s*\S+\s+)?(?:trigger|procedure|function|event)\b/i;
      expect(routine.test(sql), file).toBe(false);
    }
  });

  test('M3: dump berisi trigger/rutin (DELIMITER) ditolak', () => {
    const dump = [
      'CREATE TABLE `a` (',
      '  `id` int(11) NOT NULL',
      ') ENGINE=InnoDB;',
      '/*!50003 SET sql_mode = "" */ ;',
      'DELIMITER ;;',
      '/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `a_bi` BEFORE INSERT ON `a` FOR EACH ROW SET NEW.id = 1 */;;',
      'DELIMITER ;',
      '-- Dump completed',
      '',
    ].join('\n');
    expect(() => run(dump)).toThrow(/delimiter/i);
    expect(() => run('DELIMITER //\nCREATE PROCEDURE p() BEGIN END//\nDELIMITER ;\n')).toThrow(
      /delimiter/i,
    );
  });
});
