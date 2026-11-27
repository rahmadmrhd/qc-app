/**
 * Pemindai isi dump untuk verifikasi cadangan: menghitung jumlah baris (tuple) per tabel yang dikandung pernyataan
 * `INSERT INTO \`t\` VALUES (...),(...);` dan mencatat nama tabel dari `CREATE TABLE`. Hitungan ini adalah "sumber
 * kebenaran" jumlah baris pemulihan: jumlah baris skema hidup tak dapat dijadikan pembanding karena dump adalah
 * snapshot dan basis data terus berubah sesudahnya.
 *
 * Mengandalkan format `mariadb-dump` (insert diperluas): satu pernyataan per baris fisik (baris baru dalam data
 * diloloskan menjadi `\n`), nilai string diapit `'` dengan `\` sebagai pelolos, blob berupa heksa polos (`--hex-blob`).
 * Dibaca per potongan (memori konstan); potongan boleh jatuh di mana saja, termasuk di tengah string atau tuple.
 * Teks diberikan sebagai `latin1` (satu karakter = satu byte): `'` dan `\` tak pernah muncul sebagai byte lanjutan UTF-8.
 */
const HEAD_LIMIT = 200;
const CHAR_QUOTE = 0x27;
const CHAR_BACKSLASH = 0x5c;
const CHAR_OPEN = 0x28;
const CHAR_CLOSE = 0x29;
const CHAR_SEMICOLON = 0x3b;

const INSERT_HEAD =
  /^(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+`((?:[^`]|``)+)`\s*(?:\([^)]*\)\s*)?VALUES\s*/i;
const CREATE_TABLE =
  /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`((?:[^`]|``)+)`/i;

export interface DumpScanResult {
  /** Nama tabel dari `CREATE TABLE` (urut kemunculan, tanpa ganda). */
  tables: string[];
  /** Jumlah baris per tabel menurut pernyataan INSERT/REPLACE (tabel tanpa baris = tak ada entri). */
  rows: Map<string, number>;
}

export interface DumpScanner {
  feed(text: string): void;
  /** Menutup baris terakhir (tanpa baris baru penutup) dan mengembalikan hasil. */
  end(): DumpScanResult;
}

type Mode = 'head' | 'insert';

function unquote(name: string): string {
  return name.replaceAll('``', '`');
}

export function createDumpScanner(): DumpScanner {
  const tables: string[] = [];
  const rows = new Map<string, number>();
  let mode: Mode = 'head';
  let head = '';
  let table = '';
  let inString = false;
  let escaped = false;
  let depth = 0;

  const finishLine = () => {
    if (mode === 'head') {
      const create = CREATE_TABLE.exec(head);
      if (create !== null) {
        const name = unquote(create[1] as string);
        if (!tables.includes(name)) tables.push(name);
      }
    }
    mode = 'head';
    head = '';
    table = '';
    inString = false;
    escaped = false;
    depth = 0;
  };

  /** Menghitung tuple pada `segment` (bagian satu baris yang sedang dalam mode `insert`). */
  const scanValues = (segment: string, from: number) => {
    let count = 0;
    for (let index = from; index < segment.length; index++) {
      const code = segment.charCodeAt(index);
      if (inString) {
        if (escaped) escaped = false;
        else if (code === CHAR_BACKSLASH) escaped = true;
        else if (code === CHAR_QUOTE) inString = false;
        continue;
      }
      if (code === CHAR_QUOTE) inString = true;
      else if (code === CHAR_OPEN) {
        if (depth === 0) count += 1;
        depth += 1;
      } else if (code === CHAR_CLOSE) {
        if (depth > 0) depth -= 1;
      } else if (code === CHAR_SEMICOLON && depth === 0) {
        // Akhir pernyataan: sisa baris (komentar/perintah lain) bukan data.
        mode = 'head';
        head = ' '.repeat(HEAD_LIMIT); // sisa baris tak dianggap awal pernyataan baru
        break;
      }
    }
    if (count > 0) rows.set(table, (rows.get(table) ?? 0) + count);
  };

  const feedSegment = (segment: string) => {
    if (mode === 'insert') {
      scanValues(segment, 0);
      return;
    }
    const before = head.length;
    if (before < HEAD_LIMIT) head += segment.slice(0, HEAD_LIMIT - before);
    if (head.includes('VALUES') || head.includes('values')) {
      const insert = INSERT_HEAD.exec(head);
      if (insert !== null) {
        mode = 'insert';
        table = unquote(insert[1] as string);
        inString = false;
        escaped = false;
        depth = 0;
        const consumed = insert[0].length - before;
        scanValues(segment, Math.max(0, consumed));
      }
    }
  };

  return {
    feed(text) {
      const parts = text.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) finishLine();
        feedSegment(parts[index] as string);
      }
    },
    end() {
      finishLine();
      return { tables, rows };
    },
  };
}
