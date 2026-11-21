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
  /** Offset karakter pertama isi literal (setelah tanda kutip pembuka) di sumber. */
  start: number;
}

export interface TableRef {
  table: string;
  alias: string;
  line: number;
  /** Nomor urut kemunculan tabel ini di berkas (1-based; menghitung semua rujukan yang dipindai). */
  n: number;
  /**
   * Kunci `"<tabel>@<n>#<sidik>"` untuk `SOFT_DELETE_PENDING`/`SOFT_DELETE_EXEMPT`; sidik = 8 heksa dari isi literal
   * (spasi dinormalkan), sehingga mengubah kueri yang tercantum, atau menyisipkan kueri lain pada urutan itu, membuat
   * entri tak cocok. Rujukan tabel dinamis (`FROM ${...}`) bertabel `*dinamis`.
   */
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
      const start = i;
      const text = ch === '`' ? readTemplate() : readQuoted(ch);
      out.push({ text, line: startLine, start });
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

/**
 * Alias/tabel yang `deleted_at`-nya DIBANDINGKAN (`x.deleted_at = ''`, `<>`, `!=`) atau disaring lewat
 * `${liveWhere('x')}`/`${deletedWhere('x')}`, plus penanda penyaring tak-berkualifikasi. Sekadar menyebut kolom
 * (`SELECT i.deleted_at`, `ORDER BY ...`) bukan penyaring (M3).
 */
function filterQualifiers(text: string): { qualified: Set<string>; bare: boolean } {
  const qualified = new Set<string>();
  let bare = false;
  for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.deleted_at\s*(?:=|<>|!=)/g)) {
    qualified.add(m[1] as string);
  }
  for (const m of text.matchAll(
    /\$\{\s*(?:liveWhere|deletedWhere)\(\s*(?:(['"`])([A-Za-z_][A-Za-z0-9_]*)\1)?\s*\)/g,
  )) {
    if (m[2]) qualified.add(m[2]);
    else bare = true;
  }
  if (/(?<![.\w])deleted_at\s*(?:=|<>|!=)/.test(text)) bare = true;
  return { qualified, bare };
}

/** Konteks pemindaian lintas berkas: konstanta literal tingkat-modul per berkas dan konstanta yang diekspor. */
export interface ScanContext {
  /** Konstanta tingkat-modul tiap sumber (kunci = teks sumber), hanya nama yang tak ambigu dalam berkasnya. */
  own: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Konstanta `export const` (nama -> teks) yang tak ambigu antar berkas: satu-satunya yang dapat diimpor. */
  exported: ReadonlyMap<string, string>;
  /** Nama konstanta yang dirujuk lewat `${NAME}` di suatu literal (dinilai di tempat pemakainya, bukan sendiri). */
  referenced: ReadonlySet<string>;
  /** Nama konstanta yang JUGA dipakai langsung (mis. `db.prepare(NAME)`): literal deklarasinya tetap dinilai (N2). */
  direct: ReadonlySet<string>;
}

/** Hanya deklarasi tingkat-modul (tanpa indentasi): `const` lokal fungsi tak ikut (N3). */
const CONST_DECL = /^(export\s+)?const\s+([A-Za-z_$][\w$]*)(?:\s*:[^=\n]+)?\s*=\s*(?=['"`])/gm;

interface TopConst {
  name: string;
  text: string;
  exported: boolean;
  /** Offset karakter pertama isi literal. */
  start: number;
}

function topLevelConstants(source: string): TopConst[] {
  const literals = new Map(extractLiterals(source).map((literal) => [literal.start, literal.text]));
  const found: TopConst[] = [];
  for (const m of source.matchAll(CONST_DECL)) {
    const start = m.index + m[0].length + 1;
    const text = literals.get(start);
    if (text !== undefined)
      found.push({ name: m[2] as string, text, exported: m[1] !== undefined, start });
  }
  return found;
}

/** Konstanta tingkat-modul sebuah sumber; nama ganda dalam satu berkas dianggap ambigu dan dibuang. */
function constantsOf(source: string): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const { name, text } of topLevelConstants(source))
    seen.set(name, seen.has(name) ? null : text);
  const out = new Map<string, string>();
  for (const [name, text] of seen) if (text !== null) out.set(name, text);
  return out;
}

/** Nama lokal -> nama yang diimpor, dari pernyataan `import { A, B as C } from '...'`. */
function importedNames(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"]/gm)) {
    for (const part of (m[1] as string).split(',')) {
      const bits = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/);
      const imported = bits[0]?.trim();
      const local = (bits[1] ?? bits[0])?.trim();
      if (imported && local) out.set(local, imported);
    }
  }
  return out;
}

const escapeRegExp = (text: string) => text.replace(/[$\\^.*+?()[\]{}|]/g, '\\$&');

/**
 * Membangun konteks dari seluruh sumber yang dipindai. `${NAME}` hanya diperluas dengan konstanta berkas itu sendiri
 * atau yang benar-benar diimpor (pernyataan `import { NAME }` dan ada `export const NAME` yang tak ambigu); nama
 * lokal, nama ganda, atau nama dari berkas yang tak diimpor tidak diperluas (N3).
 */
export function buildScanContext(sources: readonly string[]): ScanContext {
  const own = new Map<string, Map<string, string>>();
  const exported = new Map<string, string>();
  const ambiguous = new Set<string>();
  const referenced = new Set<string>();
  const declared = new Map<string, number>();
  for (const source of sources) {
    own.set(source, constantsOf(source));
    for (const { name, text, exported: isExported } of topLevelConstants(source)) {
      declared.set(name, (declared.get(name) ?? 0) + 1);
      if (!isExported) continue;
      const prior = exported.get(name);
      if (prior !== undefined && prior !== text) ambiguous.add(name);
      exported.set(name, text);
    }
    for (const literal of extractLiterals(source)) {
      for (const m of literal.text.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
        referenced.add(m[1] as string);
      }
    }
  }
  for (const name of ambiguous) exported.delete(name);
  // Pemakaian langsung: kemunculan pengenal di luar `${}`, pernyataan import, dan deklarasinya (N2).
  const uses = new Map<string, number>();
  for (const source of sources) {
    // Komentar (baris penuh dan blok) dan pernyataan import bukan pemakaian.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^import\s[^;]*;/gm, '');
    for (const name of referenced) {
      if (!declared.has(name)) continue;
      const id = escapeRegExp(name);
      const total = code.match(new RegExp(`(?<![\\w$.])${id}(?![\\w$])`, 'g'));
      const interp = code.match(new RegExp(`\\$\\{\\s*${id}\\s*\\}`, 'g'));
      uses.set(name, (uses.get(name) ?? 0) + (total?.length ?? 0) - (interp?.length ?? 0));
    }
  }
  const direct = new Set<string>();
  for (const name of referenced) {
    if ((uses.get(name) ?? 0) - (declared.get(name) ?? 0) > 0) direct.add(name);
  }
  return { own, exported, referenced, direct };
}

/** Konstanta yang boleh diperluas di `source`: miliknya sendiri, lalu yang diimpor. */
function availableConstants(source: string, ctx: ScanContext): Map<string, string> {
  const available = new Map(ctx.own.get(source) ?? constantsOf(source));
  for (const [local, imported] of importedNames(source)) {
    const text = ctx.exported.get(imported);
    if (text !== undefined && !available.has(local)) available.set(local, text);
  }
  return available;
}

/** Mengganti `${NAME}` dengan teks konstanta (bersarang sampai 4 tingkat); interpolasi lain dibiarkan. */
function expand(text: string, constants: ReadonlyMap<string, string>): string {
  let out = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(
      /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
      (whole, name: string) => constants.get(name) ?? whole,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Sidik FNV-1a 32-bit (8 heksa) atas teks dengan spasi dinormalkan. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const DYNAMIC = '*dinamis';

/** Posisi `FROM|JOIN ${...}` yang tak dapat diperluas: nama tabel tak diketahui, wajib dicatat di PENDING/EXEMPT. */
function dynamicRefs(text: string): RawRef[] {
  const refs: RawRef[] = [];
  for (const m of text.matchAll(/\b(FROM|JOIN)\s+\$\{/gi)) {
    if (m[1]?.toUpperCase() === 'FROM' && /\bDELETE\s+$/i.test(text.slice(0, m.index))) continue;
    refs.push({ table: DYNAMIC, alias: DYNAMIC, index: m.index });
  }
  return refs;
}

/**
 * Pindai satu berkas sumber; kembalikan semua rujukan tabel beserta penilaiannya. Interpolasi `${NAME}` ke konstanta
 * literal (fragmen FROM tersusun seperti `HANDOVER_FROM`) diperluas lebih dulu, sehingga SETIAP kueri pemakainya dinilai
 * dan fragmennya sendiri tidak dihitung. Rujukan dinamis yang tak dapat diperluas dilaporkan (tak pernah `ok`).
 */
export function scanSource(source: string, context?: ScanContext): TableRef[] {
  const ctx = context ?? buildScanContext([source]);
  const fragmentStarts = new Set<number>();
  for (const { name, start } of topLevelConstants(source)) {
    if (ctx.referenced.has(name) && !ctx.direct.has(name)) fragmentStarts.add(start);
  }
  const constants = availableConstants(source, ctx);
  const counters = new Map<string, number>();
  const result: TableRef[] = [];
  for (const literal of extractLiterals(source)) {
    if (fragmentStarts.has(literal.start)) continue;
    const text = expand(literal.text, constants);
    // Literal tulis (UPDATE/DELETE) di luar cakupan: dijaga tes perilaku tiap modul.
    if (/^\s*(UPDATE|DELETE)\b/i.test(text)) continue;
    const skip = existsRanges(text);
    const refs = [...findRefs(text), ...dynamicRefs(text)]
      .filter((ref) => !skip.some(([from, to]) => ref.index >= from && ref.index < to))
      .sort((a, b) => a.index - b.index);
    if (refs.length === 0) continue;
    const print = fingerprint(literal.text);
    const { qualified, bare } = filterQualifiers(text);
    const lineAt = (index: number) =>
      literal.line + (text.slice(0, index).match(/\n/g)?.length ?? 0);
    const tableFiltered = (ref: RawRef): boolean =>
      ref.table !== DYNAMIC &&
      (qualified.has(ref.alias) || qualified.has(ref.table) || (bare && refs.length === 1));
    const plain = refs.filter((ref) => !(ref.table in CHILD_PARENTS) && ref.table !== DYNAMIC);
    const filteredTables = new Set(plain.filter(tableFiltered).map((ref) => ref.table));
    const presentTables = new Set(plain.map((ref) => ref.table));
    for (const ref of refs) {
      const n = (counters.get(ref.table) ?? 0) + 1;
      counters.set(ref.table, n);
      const parents = CHILD_PARENTS[ref.table];
      let ok: boolean;
      if (parents) {
        // Setiap induk yang ikut di-JOIN harus tersaring, dan minimal satu induk harus ada (M4).
        const present = parents.filter((parent) => presentTables.has(parent));
        ok = present.length > 0 && present.every((parent) => filteredTables.has(parent));
      } else ok = tableFiltered(ref);
      result.push({
        table: ref.table,
        alias: ref.alias,
        line: lineAt(ref.index),
        n,
        key: `${ref.table}@${n}#${print}`,
        ok,
      });
    }
  }
  return result;
}
