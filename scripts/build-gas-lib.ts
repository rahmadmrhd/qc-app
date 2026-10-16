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
 * ReferenceError yang tertelan); karena itu build menolaknya lebih dulu. Nama yang lazim jadi variabel lokal
 * (module, process, performance, document) sengaja tidak diperiksa agar tidak salah menandai.
 */
const UNAVAILABLE_GLOBALS: Readonly<Record<string, string>> = {
  URL: 'pecah link secara manual (lihat splitDriveLink di shared/qrcode.ts)',
  URLSearchParams: 'urai/susun query string secara manual (lihat toQueryString_)',
  fetch: 'UrlFetchApp.fetch lewat platform_()',
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
  AbortController: 'tidak ada padanan di GAS',
  Blob: 'Utilities.newBlob',
  FormData: 'payload objek pada UrlFetchApp.fetch',
  FileReader: 'DriveApp / Utilities',
  XMLHttpRequest: 'UrlFetchApp.fetch lewat platform_()',
  WebSocket: 'tidak ada di GAS',
  window: 'API peramban tidak ada di server GAS',
  navigator: 'API peramban tidak ada di server GAS',
  localStorage: 'PropertiesService / CacheService lewat platform_()',
  sessionStorage: 'CacheService lewat platform_()',
  Buffer: 'API Node tidak ada di GAS (Utilities.newBlob)',
  require: 'API Node tidak ada di GAS (semua file berbagi satu global scope)',
  __dirname: 'API Node tidak ada di GAS',
};

/** Anggota yang belum tentu didukung V8 Apps Script (lihat CLAUDE.md). */
const UNAVAILABLE_MEMBERS: Readonly<Record<string, string>> = {
  'Object.hasOwn': 'Object.prototype.hasOwnProperty.call(obj, key)',
};

/**
 * Membuang komentar, isi string, dan literal regex dari JS hasil transpile (isi ekspresi dalam template literal
 * tetap dipertahankan) agar pemeriksaan API tidak salah menandai teks biasa.
 */
export function stripNonCode(source: string): string {
  let out = '';
  const length = source.length;
  // Karakter terakhir yang bermakna: menentukan apakah "/" membuka regex atau operator pembagian.
  const regexPrefix = new Set([
    '',
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '<',
    '>',
    '~',
    '^',
  ]);

  function skipRegex(start: number): number {
    let i = start + 1;
    let inClass = false;
    while (i < length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) return i + 1;
      else if (ch === '\n') return i; // bukan regex sungguhan: jangan menelan baris berikutnya
      i += 1;
    }
    return i;
  }

  function template(start: number): number {
    let i = start;
    while (i < length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') return i + 1;
      if (ch === '$' && source[i + 1] === '{') {
        out += ' ';
        i = code(i + 2, true);
        continue;
      }
      i += 1;
    }
    return i;
  }

  function code(start: number, inExpression: boolean): number {
    let i = start;
    let depth = 0;
    while (i < length) {
      const ch = source[i] as string;
      const next = source[i + 1];
      if (ch === '/' && next === '/') {
        const end = source.indexOf('\n', i);
        i = end < 0 ? length : end;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        i = end < 0 ? length : end + 2;
        out += ' ';
        continue;
      }
      if (ch === "'" || ch === '"') {
        i += 1;
        while (i < length && source[i] !== ch && source[i] !== '\n') {
          i += source[i] === '\\' ? 2 : 1;
        }
        i += 1;
        out += ' ';
        continue;
      }
      if (ch === '`') {
        i = template(i + 1);
        out += ' ';
        continue;
      }
      if (ch === '/') {
        const last = out.trimEnd().slice(-1);
        if (regexPrefix.has(last) || /(?:^|[^\w$])return\s*$/.test(out)) {
          i = skipRegex(i);
          out += ' ';
          continue;
        }
      }
      if (inExpression) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
      }
      out += ch;
      i += 1;
    }
    return i;
  }

  code(0, false);
  return out;
}

function assertNoUnavailableApis(js: string, file: string): void {
  const code = stripNonCode(js);
  for (const [name, hint] of Object.entries(UNAVAILABLE_GLOBALS)) {
    // Bukan properti (obj.name), bukan bagian identifier lain, dan bukan kunci objek ({ name: ... }).
    const pattern = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:)`);
    if (pattern.test(code)) {
      throw new GasBuildError(
        file,
        `API "${name}" tidak tersedia di runtime Apps Script (V8); gunakan ${hint}`,
      );
    }
  }
  for (const [name, hint] of Object.entries(UNAVAILABLE_MEMBERS)) {
    const pattern = new RegExp(`(?<![\\w$.])${name.replace('.', '\\.')}(?![\\w$])`);
    if (pattern.test(code)) {
      throw new GasBuildError(
        file,
        `API "${name}" belum tentu didukung runtime Apps Script (V8); gunakan ${hint}`,
      );
    }
  }
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
