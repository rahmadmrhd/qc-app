// Pembaca dump mysqldump (MySQL 5.7) aplikasi QC lama: hanya pernyataan `INSERT INTO ... VALUES (...),(...);`.
// Murni (tanpa I/O kecuali `readDump`), dipakai perencana migrasi dan tesnya.

export type Cell = string | number | null;
export type Tables = Record<string, Cell[][]>;

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '0': '\0',
  Z: '\x1a',
  b: '\b',
};

/** Mengurai deretan tuple setelah `VALUES ` pada satu baris `INSERT`. */
function parseTuples(line: string, start: number, out: Cell[][]): void {
  let i = start;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === ',' || line[i] === ' ')) i++;
    if (i >= n || line[i] === ';') return;
    if (line[i] !== '(') throw new Error(`dump: "(" diharapkan pada posisi ${i}`);
    i++;
    const row: Cell[] = [];
    for (;;) {
      if (line[i] === "'") {
        i++;
        let text = '';
        for (;;) {
          const char = line[i];
          if (char === undefined) throw new Error('dump: string tidak tertutup');
          if (char === '\\') {
            const next = line[i + 1] ?? '';
            text += ESCAPES[next] ?? next;
            i += 2;
          } else if (char === "'") {
            if (line[i + 1] === "'") {
              text += "'";
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            text += char;
            i++;
          }
        }
        row.push(text);
      } else {
        let end = i;
        while (end < n && line[end] !== ',' && line[end] !== ')') end++;
        const raw = line.slice(i, end).trim();
        row.push(raw === 'NULL' ? null : Number(raw));
        i = end;
      }
      if (line[i] === ',') {
        i++;
        continue;
      }
      if (line[i] === ')') {
        i++;
        break;
      }
      throw new Error(`dump: karakter tak terduga "${line[i] ?? ''}" pada posisi ${i}`);
    }
    out.push(row);
  }
}

/** Seluruh baris `INSERT` per tabel, urutan sumber terjaga. Pernyataan lain (DDL, trigger) diabaikan. */
export function parseDump(text: string): Tables {
  const tables: Tables = {};
  for (const line of text.split('\n')) {
    const match = /^INSERT INTO `([^`]+)` VALUES /.exec(line);
    if (!match) continue;
    const name = match[1] as string;
    const rows = tables[name] ?? [];
    tables[name] = rows;
    parseTuples(line, match[0].length, rows);
  }
  return tables;
}

export async function readDump(path: string): Promise<Tables> {
  return parseDump(await Bun.file(path).text());
}
