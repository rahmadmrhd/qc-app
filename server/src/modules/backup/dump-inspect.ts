/**
 * Pemeriksa isi dump sebelum diimpor (pemulihan, T31): menolak pernyataan yang bukan milik dump `mariadb-dump`
 * satu skema dan dapat menyentuh skema lain, hak akses, atau shell klien. MD5 dan SHA-256 hanya bukti keutuhan,
 * bukan bukti asal (siapa pun yang dapat menulis ke folder cadangan dapat menaruh berkas rekaan), jadi isinya
 * diperiksa juga.
 *
 * Pemeriksaan per BARIS (hanya awalan 300 karakter tiap baris, memori konstan): `mariadb-dump` meloloskan baris baru
 * di dalam data sebagai `\n`, jadi tiap baris fisik diawali di batas pernyataan dan data tidak dapat meniru awal
 * pernyataan. Huruf besar/kecil tak dibedakan dan tanda backtick diabaikan. Dump asli MariaDB 11 memuat baris
 * `/*M!999999\- enable the sandbox mode *\/` dan komentar bersyarat `/*!40101 ... *\/` yang tetap lolos.
 */
const PREFIX_LIMIT = 300;
/** Satu-satunya baris sah yang diawali komentar bersyarat berisi garis miring terbalik. */
const SANDBOX_LINE = /^\/\*M!\d+\\- enable the sandbox mode \*\/$/;
const CONDITIONAL_COMMENT = /^\/\*M?!\d*\s*/;

const FORBIDDEN_STATEMENTS = [
  /^use\s/,
  /^(create|alter|drop)\s+(or\s+replace\s+)?(database|schema)\b/,
  /^(grant|revoke)\s/,
  /^(create|alter|drop|rename)\s+user\b/,
  /^set\s+(default\s+)?(role|password)\b/,
  /^(install|uninstall)\s+(soname|plugin)\b/,
  /^(shutdown|kill)\b/,
  /^load\s+(data|xml)\b/,
  /^change\s+master\b/,
  /^system\s/,
  /^source\s/,
  /^select\b.*\binto\s+(outfile|dumpfile)\b/,
];

/** Pernyataan penulis yang diikuti nama berkualifikasi `skema.objek` (skema harus skema target). */
const QUALIFIED_WRITE =
  /^(?:insert\s+(?:ignore\s+)?into|replace\s+into|update|delete\s+from|drop\s+(?:temporary\s+)?(?:table|view|trigger|procedure|function)(?:\s+if\s+exists)?|create\s+(?:or\s+replace\s+)?(?:temporary\s+)?table(?:\s+if\s+not\s+exists)?|alter\s+(?:ignore\s+)?table|truncate(?:\s+table)?|lock\s+tables|rename\s+table)\s+([a-z0-9_$]+)\s*\./;

export interface DumpInspector {
  feed(text: string): void;
  /** Memeriksa baris terakhir (tanpa baris baru penutup). */
  end(): void;
}

/** Melempar `Error` berisi alasan penolakan; pemanggil membungkusnya menjadi galat pemulihan. */
export function inspectDumpLine(rawLine: string, targetSchema: string): void {
  const trimmed = rawLine.replace(/\r$/, '').trim();
  if (trimmed === '' || SANDBOX_LINE.test(trimmed)) return;
  if (trimmed.startsWith('\\')) {
    throw new Error('baris berawalan "\\" (perintah klien mariadb)');
  }
  const line = trimmed.replace(CONDITIONAL_COMMENT, '').replace(/`/g, '').toLowerCase();
  if (line.startsWith('\\')) throw new Error('baris berawalan "\\" (perintah klien mariadb)');
  for (const pattern of FORBIDDEN_STATEMENTS) {
    if (pattern.test(line)) {
      throw new Error(`pernyataan terlarang di dump: ${line.slice(0, 40)}`);
    }
  }
  const qualified = QUALIFIED_WRITE.exec(line);
  if (qualified !== null && qualified[1] !== targetSchema.toLowerCase()) {
    throw new Error(`pernyataan menulis ke skema lain (${qualified[1]})`);
  }
}

export function createDumpInspector(targetSchema: string): DumpInspector {
  let prefix = '';
  return {
    feed(text) {
      const parts = text.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) {
          inspectDumpLine(prefix, targetSchema);
          prefix = '';
        }
        const part = parts[index] as string;
        if (prefix.length < PREFIX_LIMIT) prefix += part.slice(0, PREFIX_LIMIT - prefix.length);
      }
    },
    end() {
      inspectDumpLine(prefix, targetSchema);
      prefix = '';
    },
  };
}
