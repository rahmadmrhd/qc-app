/**
 * Pemeriksa isi dump sebelum diimpor (pemulihan, T31): lapisan TAMBAHAN yang menolak bentuk berbahaya yang umum
 * (USE, CREATE/DROP DATABASE, GRANT, perintah klien `\!`/`system`/`source`/`tee`/`connect`, SQL dinamis, tulisan ke skema
 * lain). MD5 dan SHA-256 hanya bukti keutuhan, bukan bukti asal (siapa pun yang dapat menulis ke folder cadangan
 * dapat menaruh berkas rekaan).
 *
 * BUKAN batas keamanan yang lengkap: pemeriksa berbasis baris tidak dapat menutup semua bentuk SQL/perintah klien.
 * PERTAHANAN UTAMA = pengguna pemulihan berhak terbatas (`qc_restore`: hanya skema `qc\_restore\_%`, SELECT pada skema
 * aplikasi; docs/setup-google.md S8) dan skema target baru. Sisa risiko (perintah klien `\!` yang tak dikenali, bentuk
 * SQL yang tak terdaftar) diterima: prasyaratnya hak tulis ke folder cadangan Drive. Baris sandbox MariaDB 11
 * (`/*M!999999\- enable the sandbox mode *\/`) sengaja TIDAK diwajibkan (tak terverifikasi pada klien image; bisa
 * menolak cadangan asli saat pemulihan bencana).
 *
 * Aturan pemeriksaan (hanya awalan 300 karakter tiap baris, memori konstan):
 * - Hanya AWAL PERNYATAAN diperiksa. Baris di dalam badan `CREATE TABLE (...)` (definisi kolom/kunci, mis. kolom bernama
 *   `source`/`use`/`system`) dilewati; badan ditutup oleh baris yang diakhiri `;` (pembatas klien), jadi baris sesudahnya
 *   kembali diperiksa sebagai pernyataan. Baris data `INSERT`/`REPLACE` hanya diperiksa sebagai awal pernyataan
 *   (`mariadb-dump` meloloskan baris baru dalam data sebagai `\n`, jadi data tak dapat meniru awal pernyataan), tidak
 *   ditelusuri isinya.
 * - Huruf besar/kecil tak dibedakan; backtick diperlakukan sebagai pemisah; komentar bersyarat `/*!NNN ..*\/` dibuka.
 * - Baris non-data juga diperiksa untuk pernyataan/perintah klien yang menyusul di baris yang sama setelah `;`.
 */
const PREFIX_LIMIT = 300;
/** Satu-satunya baris sah yang diawali komentar bersyarat berisi garis miring terbalik. */
const SANDBOX_LINE = /^\/\*M!\d+\\- enable the sandbox mode \*\/$/;
const CONDITIONAL_COMMENT = /^\/\*M?!\d*\s*/;
const INLINE_COMMENT = /\/\*(?!M?!)[\s\S]*?\*\//g;

const FORBIDDEN_STATEMENTS = [
  /^use\s/,
  /^(create|alter|drop)\s+(or\s+replace\s+)?(database|schema)\b/,
  /^(grant|revoke)\s/,
  /^(create|alter|drop|rename)\s+user\b/,
  /^set\s+(default\s+)?(role|password)\b/,
  /^set\s+(global|@@global)\b/,
  /^(install|uninstall)\s+(soname|plugin)\b/,
  /^(shutdown|kill)\b/,
  /^load\s+(data|xml)\b/,
  /^change\s+master\b/,
  /^(system|source|connect|tee|notee|delimiter|prepare)\s/,
  /^delimiter$/,
  /^execute\s+immediate\b/,
  /^select\b.*\binto\s+(outfile|dumpfile)\b/,
];

/** Pernyataan lain yang menyusul di baris yang sama setelah `;` (baris non-data). */
const TRAILING_STATEMENT =
  /;\s*(?:\\|use\s|connect\s|tee\s|system\s|source\s|delimiter\b|(?:create|alter|drop)\s+(?:database|schema|user)\b|grant\s|revoke\s|execute\s+immediate\b|set\s+global\b)/;

/** Pernyataan penulis yang diikuti nama berkualifikasi `skema.objek` (skema harus skema target). */
const QUALIFIED_WRITE =
  /^(?:(?:insert|replace)\s+(?:(?:low_priority|delayed|high_priority|ignore)\s+)*(?:into\s+)?|update\s+(?:(?:low_priority|ignore)\s+)*|delete\s+(?:(?:low_priority|quick|ignore)\s+)*from\s+|drop\s+(?:temporary\s+)?(?:table|view|trigger|procedure|function)(?:\s+if\s+exists)?\s+|create\s+(?:or\s+replace\s+)?(?:temporary\s+)?table(?:\s+if\s+not\s+exists)?\s+|alter\s+(?:ignore\s+)?table\s+|truncate(?:\s+table)?\s+|lock\s+tables\s+|rename\s+table\s+)([a-z0-9_$]+)\s*\./;

const DATA_STATEMENT = /^(?:insert|replace)\b/;
const OPENS_TABLE_BODY = /^create\s+(?:or\s+replace\s+)?(?:temporary\s+)?table\b/;

/** Keadaan antar baris (badan CREATE TABLE yang sedang dilewati). */
export interface InspectState {
  inTableBody: boolean;
}

export interface DumpInspector {
  feed(text: string): void;
  /** Memeriksa baris terakhir (tanpa baris baru penutup). */
  end(): void;
}

/** Melempar `Error` berisi alasan penolakan; pemanggil membungkusnya menjadi galat pemulihan. */
export function inspectDumpLine(
  rawLine: string,
  targetSchema: string,
  state: InspectState = { inTableBody: false },
): void {
  const trimmed = rawLine.replace(/\r$/, '').trim();
  if (trimmed === '' || SANDBOX_LINE.test(trimmed)) return;
  if (state.inTableBody) {
    // Definisi kolom/kunci: bukan pernyataan. Pembatas klien (`;` di akhir baris) menutup badan.
    if (trimmed.endsWith(';')) state.inTableBody = false;
    return;
  }
  if (trimmed.startsWith('\\')) {
    throw new Error('baris berawalan "\\" (perintah klien mariadb)');
  }
  if (trimmed.startsWith('--')) return; // komentar (baris penutup dump, dll.)

  const line = trimmed
    .replace(CONDITIONAL_COMMENT, '')
    .replace(INLINE_COMMENT, ' ')
    .replace(/`/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (line.startsWith('\\')) throw new Error('baris berawalan "\\" (perintah klien mariadb)');
  for (const pattern of FORBIDDEN_STATEMENTS) {
    if (pattern.test(line)) {
      throw new Error(`pernyataan terlarang di dump: ${line.slice(0, 40)}`);
    }
  }
  if (!DATA_STATEMENT.test(line) && (TRAILING_STATEMENT.test(line) || /\\[!.#a-z]/.test(line))) {
    throw new Error('perintah/pernyataan terlarang di tengah baris');
  }
  const qualified = QUALIFIED_WRITE.exec(line);
  if (qualified !== null && qualified[1] !== targetSchema.toLowerCase()) {
    throw new Error(`pernyataan menulis ke skema lain (${qualified[1]})`);
  }
  if (OPENS_TABLE_BODY.test(line) && trimmed.endsWith('(')) state.inTableBody = true;
}

export function createDumpInspector(targetSchema: string): DumpInspector {
  let prefix = '';
  const state: InspectState = { inTableBody: false };
  return {
    feed(text) {
      const parts = text.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) {
          inspectDumpLine(prefix, targetSchema, state);
          prefix = '';
        }
        const part = parts[index] as string;
        if (prefix.length < PREFIX_LIMIT) prefix += part.slice(0, PREFIX_LIMIT - prefix.length);
      }
    },
    end() {
      inspectDumpLine(prefix, targetSchema, state);
      prefix = '';
    },
  };
}
