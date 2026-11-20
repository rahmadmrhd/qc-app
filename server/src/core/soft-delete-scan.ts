// Pemindai statis untuk tes penjaga soft delete (`soft-delete-guard.test.ts`): menemukan setiap `FROM`/`JOIN` ke tabel
// ber-soft-delete (atau anaknya) di dalam literal string/template dan menilai apakah literal itu menyaring record
// terhapus. Murni teks; tidak menyentuh basis data.
import { SOFT_DELETE_TABLES } from './soft-delete';

/** Tabel anak -> induk yang menentukan "hidup"-nya (rancangan soft delete §5 butir 15). */
export const CHILD_PARENTS: Readonly<Record<string, readonly string[]>> = {
  serial_cases: ['serials'],
  serial_events: ['serials'],
  serial_proof_photos: ['serials'],
  serial_stickers: ['serials'],
  item_business_units: ['items'],
  item_sticker_photos: ['items'],
  item_sticker_marks: ['items'],
  manual_book_versions: ['qr_designs'],
  handover_comments: ['handovers'],
  notifications: ['handovers', 'serials'],
};

export interface SqlLiteral {
  text: string;
  /** Nomor baris (1-based) awal literal. */
  line: number;
}

export interface TableRef {
  table: string;
  alias: string;
  line: number;
  /** Nomor urut kemunculan tabel ini di berkas (1-based; menghitung semua rujukan yang dipindai). */
  n: number;
  /** Kunci `"<tabel>@<n>"` untuk `SOFT_DELETE_PENDING`/`SOFT_DELETE_EXEMPT`. */
  key: string;
  /** Lolos pemindai: tersaring (tabel soft delete) atau disertai induk tersaring (tabel anak). */
  ok: boolean;
}

/** Ambil semua literal string/template dari sumber TypeScript; komentar dilewati, interpolasi `${}` tetap di teksnya. */
export function extractLiterals(source: string): SqlLiteral[] {
  const out: SqlLiteral[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const bump = (ch: string | undefined) => {
    if (ch === '\n') line += 1;
  };

  /** Lewati teks template mulai setelah backtick pembuka; kembalikan teks mentah. */
  function readTemplate(): string {
    const start = i;
    while (i < n) {
      const ch = source[i];
      if (ch === '\\') {
        bump(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '`') {
        const text = source.slice(start, i);
        i += 1;
        return text;
      }
      if (ch === '$' && source[i + 1] === '{') {
        i += 2;
        skipCode('}');
        continue;
      }
      bump(ch);
      i += 1;
    }
    return source.slice(start, i);
  }

  function readQuoted(quote: string): string {
    const start = i;
    while (i < n) {
      const ch = source[i];
      if (ch === '\\') {
        bump(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === quote) {
        const text = source.slice(start, i);
        i += 1;
        return text;
      }
      if (ch === '\n') break;
      i += 1;
    }
    return source.slice(start, i);
  }

  /** Lewati kode (di dalam `${}`) sampai kurung tutup `until` yang seimbang. */
  function skipCode(until: string): void {
    let depth = 0;
    while (i < n) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        if (depth === 0 && until === '}') {
          i += 1;
          return;
        }
        depth -= 1;
      } else if (ch === '`') {
        i += 1;
        readTemplate();
        continue;
      } else if (ch === "'" || ch === '"') {
        i += 1;
        readQuoted(ch);
        continue;
      } else if (ch === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i += 1;
        continue;
      } else if (ch === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        for (let k = i; k < stop; k += 1) bump(source[k]);
        i = stop;
        continue;
      }
      bump(ch);
      i += 1;
    }
  }

  /** Apakah `/` pada posisi `at` membuka literal regex (heuristik dari token sebelumnya). */
  function opensRegex(at: number): boolean {
    let k = at - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k -= 1;
    if (k < 0) return true;
    return (
      '(,=:[!&|?{};+-*%<>~^'.includes(source[k] as string) ||
      source.slice(k - 5, k + 1) === 'return'
    );
  }

  while (i < n) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k += 1) bump(source[k]);
      i = stop;
    } else if (ch === '/' && opensRegex(i)) {
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const c = source[i];
        if (c === '\\') i += 2;
        else if (c === '[') {
          inClass = true;
          i += 1;
        } else if (c === ']') {
          inClass = false;
          i += 1;
        } else if (c === '/' && !inClass) {
          i += 1;
          break;
        } else i += 1;
      }
    } else if (ch === '`' || ch === "'" || ch === '"') {
      const startLine = line;
      i += 1;
      const text = ch === '`' ? readTemplate() : readQuoted(ch);
      out.push({ text, line: startLine });
    } else {
      bump(ch);
      i += 1;
    }
  }
  return out;
}

const ALIAS_STOP = new Set([
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'cross',
  'natural',
  'on',
  'set',
  'group',
  'order',
  'limit',
  'using',
  'for',
  'union',
  'values',
  'having',
  'select',
  'and',
  'or',
  'when',
  'then',
  'else',
  'end',
  'into',
  'as',
  'force',
  'use',
  'ignore',
  'lock',
  'straight_join',
]);

const KNOWN_TABLES = new Set<string>([...SOFT_DELETE_TABLES, ...Object.keys(CHILD_PARENTS)]);
const TABLE_ALTERNATION = [...KNOWN_TABLES].sort((a, b) => b.length - a.length).join('|');

interface RawRef {
  table: string;
  alias: string;
  index: number;
}

/** Rentang `[mulai, akhir)` isi tanda kurung milik `EXISTS (`/`NOT EXISTS (` (di luar cakupan pemindai). */
function existsRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(/\bEXISTS\s*\(/gi)) {
    let depth = 1;
    let k = m.index + m[0].length;
    const start = k;
    while (k < text.length && depth > 0) {
      if (text[k] === '(') depth += 1;
      else if (text[k] === ')') depth -= 1;
      k += 1;
    }
    ranges.push([start, k]);
  }
  return ranges;
}

function findRefs(text: string): RawRef[] {
  const refs: RawRef[] = [];
  const aliasOf = (rest: string, table: string): string => {
    const a = /^\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(rest);
    const word = a?.[1];
    return word && !ALIAS_STOP.has(word.toLowerCase()) ? word : table;
  };
  const re = new RegExp(`\\b(FROM|JOIN)\\s+\`?(${TABLE_ALTERNATION})\`?(?![A-Za-z0-9_])`, 'gi');
  for (const m of text.matchAll(re)) {
    // `DELETE FROM x` adalah tulis, bukan baca.
    if (m[1]?.toUpperCase() === 'FROM' && /\bDELETE\s+$/i.test(text.slice(0, m.index))) continue;
    const table = (m[2] as string).toLowerCase();
    refs.push({
      table,
      alias: aliasOf(text.slice(m.index + m[0].length), table),
      index: m.index,
    });
  }
  // Fragmen FROM tersusun: literal diawali nama tabel diikuti alias dan/atau JOIN (mis. 'handovers h LEFT JOIN ...').
  const lead = new RegExp(
    `^\\s*(${TABLE_ALTERNATION})(?=\\s+(?:(?:AS\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s+)?(?:LEFT|RIGHT|INNER|CROSS|JOIN|ON)\\b|\\s+(?:AS\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s*$)`,
    'i',
  ).exec(text);
  if (lead) {
    const table = (lead[1] as string).toLowerCase();
    const start = lead[0].length;
    refs.push({
      table,
      alias: aliasOf(text.slice(start), table),
      index: lead[0].indexOf(lead[1] as string),
    });
  }
  return refs.sort((a, b) => a.index - b.index);
}

/** Alias/tabel yang disebut `deleted_at`-nya, plus penanda penyaring tak-berkualifikasi. */
function filterQualifiers(text: string): { qualified: Set<string>; bare: boolean } {
  const qualified = new Set<string>();
  let bare = false;
  for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.deleted_at\b/g))
    qualified.add(m[1] as string);
  for (const m of text.matchAll(
    /\$\{\s*(?:liveWhere|deletedWhere)\(\s*(?:(['"`])([A-Za-z_][A-Za-z0-9_]*)\1)?\s*\)/g,
  )) {
    if (m[2]) qualified.add(m[2]);
    else bare = true;
  }
  const withoutQualified = text.replace(/[A-Za-z_][A-Za-z0-9_]*\.deleted_at\b/g, '');
  if (/\bdeleted_at\b/.test(withoutQualified)) bare = true;
  return { qualified, bare };
}

/** Pindai satu berkas sumber; kembalikan semua rujukan tabel beserta penilaiannya. */
export function scanSource(source: string): TableRef[] {
  const counters = new Map<string, number>();
  const result: TableRef[] = [];
  for (const literal of extractLiterals(source)) {
    const text = literal.text;
    // Literal tulis (UPDATE/DELETE) di luar cakupan: dijaga tes perilaku tiap modul.
    if (/^\s*(UPDATE|DELETE)\b/i.test(text)) continue;
    const skip = existsRanges(text);
    const refs = findRefs(text).filter(
      (ref) => !skip.some(([from, to]) => ref.index >= from && ref.index < to),
    );
    if (refs.length === 0) continue;
    const { qualified, bare } = filterQualifiers(text);
    const lineAt = (index: number) =>
      literal.line + (text.slice(0, index).match(/\n/g)?.length ?? 0);
    const tableFiltered = (ref: RawRef): boolean =>
      qualified.has(ref.alias) || qualified.has(ref.table) || (bare && refs.length === 1);
    const filteredTables = new Set(
      refs
        .filter((ref) => !(ref.table in CHILD_PARENTS) && tableFiltered(ref))
        .map((ref) => ref.table),
    );
    for (const ref of refs) {
      const n = (counters.get(ref.table) ?? 0) + 1;
      counters.set(ref.table, n);
      const parents = CHILD_PARENTS[ref.table];
      const ok = parents
        ? parents.some((parent) => filteredTables.has(parent))
        : tableFiltered(ref);
      result.push({
        table: ref.table,
        alias: ref.alias,
        line: lineAt(ref.index),
        n,
        key: `${ref.table}@${n}`,
        ok,
      });
    }
  }
  return result;
}
