import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { Node } from '@babel/types';

export const PUBLIC_GAS_FUNCTIONS: ReadonlySet<string> = new Set([
  'doGet',
  'doPost',
  'api',
  'setup',
  'cleanupQrPdfs',
]);

export class GasBuildError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'GasBuildError';
  }
}

export interface TransformOptions {
  /** true untuk gas/src: fungsi global wajib berakhiran `_` kecuali PUBLIC_GAS_FUNCTIONS. */
  enforcePrivateNames: boolean;
}

export interface TransformResult {
  code: string;
  globals: string[];
}

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' });

const IMPORT_STATEMENT = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"][ \t]*;?[ \t]*$/gm;
const LOCAL_EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}[ \t]*;?[ \t]*$/gm;
const EXPORT_KEYWORD =
  /^([ \t]*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;
const TOP_LEVEL_FUNCTION = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const TOP_LEVEL_BINDING = /^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_VALUE =
  /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

function assertSupportedSyntax(js: string, file: string): void {
  if (/^[ \t]*export\s+default\b/m.test(js)) {
    throw new GasBuildError(file, '`export default` tidak didukung di GAS');
  }
  if (/^[ \t]*export\s*(?:\*|\{[^}]*\})\s*from\b/m.test(js)) {
    throw new GasBuildError(file, 're-export dari modul lain tidak didukung di GAS');
  }
  if (/\bimport\s*\(/.test(js)) {
    throw new GasBuildError(file, 'dynamic import tidak didukung di GAS');
  }
  for (const statement of js.match(IMPORT_STATEMENT) ?? []) {
    const text = statement.trim();
    if (/\*\s*as\b/.test(text)) {
      throw new GasBuildError(file, `namespace import tidak didukung: ${text}`);
    }
    if (/\{[^}]*\bas\b[^}]*\}/.test(text)) {
      throw new GasBuildError(file, `import alias tidak didukung: ${text}`);
    }
    if (/^import\s+[A-Za-z_$][\w$]*\s*(?:,|from)/.test(text)) {
      throw new GasBuildError(file, `default import tidak didukung: ${text}`);
    }
  }
  for (const match of js.matchAll(LOCAL_EXPORT_LIST)) {
    if (/\bas\b/.test(match[1] ?? '')) {
      throw new GasBuildError(file, `export alias tidak didukung: ${match[0].trim()}`);
    }
  }
}

/**
 * API global yang TIDAK ada di runtime V8 Apps Script (server) beserta pengganti yang disarankan. Tes dan
 * peramban (Bun/Node/DOM) menyediakannya, sehingga kesalahan baru ketahuan di produksi (mis. `new URL` melempar
 * ReferenceError yang tertelan); karena itu build menolaknya lebih dulu. Pemeriksaan memakai parser dan analisis
 * scope: hanya REFERENSI ke global yang tidak terikat deklarasi lokal yang ditolak (parameter, variabel lokal,
 * kunci objek, nama method, dan properti `obj.fetch` aman).
 */
const UNAVAILABLE_GLOBALS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    URL: 'pecah link secara manual (lihat splitDriveLink di shared/qrcode.ts)',
    URLSearchParams: 'urai/susun query string secara manual (lihat toQueryString_)',
    fetch: 'UrlFetchApp.fetch lewat platform_()',
    Headers: 'UrlFetchApp.fetch lewat platform_()',
    Request: 'UrlFetchApp.fetch lewat platform_()',
    Response: 'UrlFetchApp.fetch lewat platform_()',
    setTimeout: 'Utilities.sleep lewat platform_(), atau trigger berbasis waktu',
    setInterval: 'trigger berbasis waktu Apps Script',
    clearTimeout: 'trigger berbasis waktu Apps Script',
    clearInterval: 'trigger berbasis waktu Apps Script',
    atob: 'Utilities.base64Decode',
    btoa: 'Utilities.base64Encode',
    structuredClone: 'salin manual atau JSON.parse(JSON.stringify(x))',
    TextEncoder: 'Utilities.newBlob(teks).getBytes()',
    TextDecoder: 'Utilities.newBlob(bytes).getDataAsString()',
    crypto: 'Utilities.computeDigest / computeHmacSignature',
    SubtleCrypto: 'Utilities.computeDigest / computeHmacSignature',
    AbortController: 'tidak ada padanan di GAS',
    DOMException: 'lempar Error biasa',
    Blob: 'Utilities.newBlob',
    File: 'DriveApp / Utilities.newBlob',
    FormData: 'payload objek pada UrlFetchApp.fetch',
    FileReader: 'DriveApp / Utilities',
    ReadableStream: 'tidak ada padanan di GAS',
    WritableStream: 'tidak ada padanan di GAS',
    TransformStream: 'tidak ada padanan di GAS',
    XMLHttpRequest: 'UrlFetchApp.fetch lewat platform_()',
    WebSocket: 'tidak ada di GAS',
    window: 'API peramban tidak ada di server GAS',
    document: 'API peramban tidak ada di server GAS',
    navigator: 'API peramban tidak ada di server GAS',
    localStorage: 'PropertiesService / CacheService lewat platform_()',
    sessionStorage: 'CacheService lewat platform_()',
    performance: 'Date.now()',
    Buffer: 'API Node tidak ada di GAS (Utilities.newBlob)',
    process: 'API Node tidak ada di GAS',
    require: 'API Node tidak ada di GAS (semua file berbagi satu global scope)',
    module: 'API Node tidak ada di GAS',
    __dirname: 'API Node tidak ada di GAS',
  }),
);

/** Anggota yang belum tentu didukung V8 Apps Script (lihat CLAUDE.md), ditulis "Objek.anggota". */
const UNAVAILABLE_MEMBERS: ReadonlyMap<string, string> = new Map([
  ['Object.hasOwn', 'Object.prototype.hasOwnProperty.call(obj, key)'],
]);

/** Objek global: `globalThis.fetch(...)` sama saja dengan memanggil `fetch`. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'self', 'global']);

function failUnavailable(file: string, name: string, hint: string, uncertain = false): never {
  const status = uncertain ? 'belum tentu didukung' : 'tidak tersedia di';
  throw new GasBuildError(
    file,
    `API "${name}" ${status} runtime Apps Script (V8); gunakan ${hint}`,
  );
}

/**
 * Menolak referensi ke API yang tidak ada di runtime GAS. Berbasis AST dan scope (bukan pencocokan teks):
 * literal regex, string, komentar, kunci objek, nama method, properti, dan nama yang terikat deklarasi lokal
 * tidak ditandai, sedangkan pemakaian nyata (termasuk di ekspresi kondisional dan lewat `globalThis`) ditolak.
 */
function assertNoUnavailableApis(js: string, file: string): void {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(js, { sourceType: 'module' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GasBuildError(file, `kode tidak dapat diurai untuk pemeriksaan API: ${reason}`);
  }
  traverse(ast, {
    Identifier(path) {
      const hint = UNAVAILABLE_GLOBALS.get(path.node.name);
      if (hint === undefined || !path.isReferencedIdentifier()) return;
      if (path.scope.hasBinding(path.node.name, true)) return;
      failUnavailable(file, path.node.name, hint);
    },
    // Akses anggota biasa (a.b) dan opsional (a?.b) diperiksa sama; rantai bersarang dinormalkan.
    'MemberExpression|OptionalMemberExpression'(path) {
      const chain = staticMemberChain(path.node);
      if (chain === null) return;
      const [root] = chain;
      if (root === undefined || path.scope.hasBinding(root, true)) return;
      // Buang awalan objek global: globalThis.globalThis.Object.hasOwn === Object.hasOwn.
      let start = 0;
      while (start < chain.length - 1 && GLOBAL_OBJECTS.has(chain[start] as string)) start += 1;
      const rest = chain.slice(start);
      const [first, second] = rest;
      if (first === undefined) return;
      if (start > 0 && rest.length === 1) {
        const globalHint = UNAVAILABLE_GLOBALS.get(first);
        if (globalHint !== undefined) failUnavailable(file, first, globalHint);
      }
      if (second !== undefined && rest.length === 2) {
        const memberName = `${first}.${second}`;
        const memberHint = UNAVAILABLE_MEMBERS.get(memberName);
        if (memberHint !== undefined) failUnavailable(file, memberName, memberHint, true);
      }
    },
  });
}

/**
 * Nama-nama pada rantai anggota statis (\`a.b['c']?.d\`) dari akar Identifier, atau null bila rantai mengandung
 * bagian dinamis (pemanggilan, kunci komputasi non-literal, dsb.).
 */
function staticMemberChain(node: Node): string[] | null {
  if (node.type === 'Identifier') return [node.name];
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  const parent = staticMemberChain(node.object);
  if (parent === null) return null;
  const { property, computed } = node;
  if (!computed && property.type === 'Identifier') return [...parent, property.name];
  if (computed && property.type === 'StringLiteral') return [...parent, property.value];
  return null;
}

export function transformForGas(
  source: string,
  file: string,
  options: TransformOptions,
): TransformResult {
  const js = transpiler.transformSync(source);
  assertSupportedSyntax(js, file);
  assertNoUnavailableApis(js, file);

  const code = `${js
    .replace(IMPORT_STATEMENT, '')
    .replace(LOCAL_EXPORT_LIST, '')
    .replace(EXPORT_KEYWORD, '$1')
    .trim()}\n`;

  const globals: string[] = [];
  for (const line of code.split('\n')) {
    const fn = TOP_LEVEL_FUNCTION.exec(line);
    const binding = fn ? null : TOP_LEVEL_BINDING.exec(line);
    const name = fn?.[1] ?? binding?.[1];
    if (!name) continue;
    globals.push(name);
    if (!options.enforcePrivateNames || name.endsWith('_') || PUBLIC_GAS_FUNCTIONS.has(name)) {
      continue;
    }
    const isCallable = Boolean(fn) || FUNCTION_VALUE.test(line) || line.startsWith('class ');
    if (isCallable) {
      throw new GasBuildError(
        file,
        `fungsi global "${name}" wajib berakhiran "_" agar tidak bisa dipanggil lewat google.script.run`,
      );
    }
  }
  return { code, globals };
}

export function findDuplicateGlobals(
  files: ReadonlyArray<{ file: string; globals: readonly string[] }>,
): string[] {
  const owners = new Map<string, string[]>();
  for (const { file, globals } of files) {
    for (const name of globals) owners.set(name, [...(owners.get(name) ?? []), file]);
  }
  return [...owners]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => `"${name}" dideklarasikan di ${list.join(', ')}`);
}
