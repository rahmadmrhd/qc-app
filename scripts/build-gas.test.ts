import { describe, expect, test } from 'bun:test';
import { findDuplicateGlobals, transformForGas } from './build-gas-lib';

const GAS = { enforcePrivateNames: true };
const SHARED = { enforcePrivateNames: false };

describe('transformForGas', () => {
  test('menghapus import/export sehingga deklarasi menjadi global', () => {
    const source = [
      "import { hasLevel } from '@shared/permissions';",
      "import type { Level } from '@shared/permissions';",
      '',
      'export function check_(level: Level): boolean {',
      "  return hasLevel(level, 'view');",
      '}',
      'export const LIMIT = 3;',
    ].join('\n');
    const result = transformForGas(source, 'gas/src/a.ts', GAS);
    expect(result.code).not.toMatch(/^\s*(import|export)\b/m);
    expect(result.code).toContain('function check_(level)');
    expect(result.code).toContain('hasLevel(level, "view")');
    expect(result.globals).toEqual(['check_', 'LIMIT']);
  });

  test('import multi-baris ikut terhapus', () => {
    const source =
      "import {\n  a_,\n  b_,\n} from './x';\nexport function c_() {\n  return a_() + b_();\n}\n";
    const result = transformForGas(source, 'gas/src/c.ts', GAS);
    expect(result.code).not.toContain('import');
    expect(result.globals).toEqual(['c_']);
  });

  test('menolak export default', () => {
    expect(() => transformForGas('export default function x_() {}', 'f.ts', GAS)).toThrow(
      /export default/,
    );
  });

  test('menolak import alias, namespace, default import, dan dynamic import', () => {
    expect(() => transformForGas("import { a_ as b_ } from './x';\nb_();", 'f.ts', GAS)).toThrow(
      /alias/,
    );
    expect(() => transformForGas("import * as x from './x';\nx.a();", 'f.ts', GAS)).toThrow(
      /namespace/,
    );
    expect(() => transformForGas("import x from './x';\nx();", 'f.ts', GAS)).toThrow(
      /default import/,
    );
    expect(() =>
      transformForGas("export function a_() { return import('./x'); }", 'f.ts', GAS),
    ).toThrow(/dynamic import/);
  });

  test('menolak re-export dari modul lain', () => {
    expect(() => transformForGas("export { a_ } from './x';", 'f.ts', GAS)).toThrow(/re-export/);
  });

  test('fungsi global di gas/src wajib berakhiran _', () => {
    expect(() => transformForGas('export function listUsers() { return 1; }', 'f.ts', GAS)).toThrow(
      /listUsers/,
    );
    expect(() => transformForGas('export const handler = () => 1;', 'f.ts', GAS)).toThrow(
      /handler/,
    );
  });

  test('doGet, doPost, api, setup, dan cleanupQrPdfs boleh publik', () => {
    const source =
      'export function doGet() { return 1; }\nexport function api() { return 2; }\nexport function setup() { return 3; }\nexport function doPost() { return 4; }\nexport function cleanupQrPdfs() { return 5; }';
    expect(transformForGas(source, 'gas/src/main.ts', GAS).globals).toEqual([
      'doGet',
      'api',
      'setup',
      'doPost',
      'cleanupQrPdfs',
    ]);
  });

  test('aturan nama privat tidak berlaku untuk shared/', () => {
    const result = transformForGas(
      'export function hasLevel(a: string) { return a; }',
      'shared/p.ts',
      SHARED,
    );
    expect(result.globals).toEqual(['hasLevel']);
  });
});

describe('findDuplicateGlobals', () => {
  test('mendeteksi nama yang sama di dua file', () => {
    const problems = findDuplicateGlobals([
      { file: 'a.ts', globals: ['x_', 'y_'] },
      { file: 'b.ts', globals: ['y_'] },
    ]);
    expect(problems).toEqual(['"y_" dideklarasikan di a.ts, b.ts']);
  });
});

describe('pemeriksaan API yang tidak ada di runtime Apps Script (V8)', () => {
  const build = (body: string, options = GAS) =>
    transformForGas(`export function f_(): unknown {\n${body}\n}`, 'gas/src/x.ts', options);

  test('menolak API Web yang tidak tersedia, dengan petunjuk', () => {
    expect(() => build("return new URL('https://a.co');")).toThrow(/"URL".*Apps Script/);
    expect(() => build("return new URLSearchParams('a=1');")).toThrow(/"URLSearchParams"/);
    expect(() => build("return fetch('https://a.co');")).toThrow(/UrlFetchApp/);
    expect(() => build('return setTimeout(() => 1, 5);')).toThrow(/Utilities\.sleep/);
    expect(() => build("return atob('QQ==');")).toThrow(/Utilities\.base64Decode/);
    expect(() => build('return structuredClone({});')).toThrow(/"structuredClone"/);
    expect(() => build('return new TextEncoder();')).toThrow(/"TextEncoder"/);
    expect(() => build('return window.location;')).toThrow(/"window"/);
    expect(() => build('return Buffer.from("a");')).toThrow(/"Buffer"/);
  });

  test('menolak anggota yang belum tentu didukung V8 Apps Script', () => {
    expect(() => build("return Object.hasOwn({}, 'a');")).toThrow(/Object\.hasOwn/);
  });

  test('berlaku juga untuk kode shared (berjalan di GAS)', () => {
    expect(() => build("return new URL('https://a.co');", SHARED)).toThrow(/"URL"/);
  });

  test('tidak salah menandai: nama di string, komentar, properti, atau identifier serupa', () => {
    expect(() =>
      build(
        [
          "const text = 'gunakan URL atau fetch di sini';",
          '// window, document, URL hanya komentar',
          '/* setTimeout(...) */',
          'const obj = { window: 1 } as Record<string, number>;',
          'const urlText = `halaman ${obj.window} dan URLs`;',
          'const myURL = 1, fetchAll = 2, documentId = 3;',
          'return [text, urlText, myURL, fetchAll, documentId, obj.window];',
        ].join('\n'),
      ),
    ).not.toThrow();
  });

  test('tetap menandai pemakaian di dalam ekspresi template literal', () => {
    expect(() => build('return `x ${new URL("https://a.co")}`;')).toThrow(/"URL"/);
  });
});

describe('pemeriksaan API berbasis AST dan scope (tindak lanjut review)', () => {
  const build = (body: string) =>
    transformForGas(`export function f_(a: unknown): unknown {\n${body}\n}`, 'gas/src/x.ts', GAS);

  test('menolak referensi nyata walau lewat globalThis, kondisional, atau kunci komputasi', () => {
    expect(() => build("return globalThis.fetch('x');")).toThrow(/"fetch"/);
    expect(() => build("return globalThis['fetch']('x');")).toThrow(/"fetch"/);
    expect(() => build('return a ? fetch : () => 1;')).toThrow(/"fetch"/);
    expect(() => build('const o = { fetch }; return o;')).toThrow(/"fetch"/);
    expect(() => build('return typeof URL;')).toThrow(/"URL"/);
  });

  test('literal regex di konteks apa pun tidak dianggap pemakaian API', () => {
    expect(() => build('if (a) /URL/.test(String(a)); return 1;')).not.toThrow();
    expect(() => build('if (!a) throw /URL/; return 1;')).not.toThrow();
    expect(() => build('return [/fetch/, /window/g].length > 0 ? 1 : 2;')).not.toThrow();
    expect(() => build('return a ? /URL/ : /x/;')).not.toThrow();
  });

  test('nama yang terikat lokal, kunci objek, method, dan properti tidak ditandai', () => {
    expect(() =>
      transformForGas(
        'export function g_(fetch: () => number): number {\n  return fetch();\n}',
        'gas/src/x.ts',
        GAS,
      ),
    ).not.toThrow();
    expect(() =>
      build('const o = { fetch() { return 1; }, URL: 2 }; return o.fetch() + o.URL;'),
    ).not.toThrow();
    expect(() =>
      build(
        'const module = 1; const process = [1].map((performance) => performance); return [module, process];',
      ),
    ).not.toThrow();
    expect(() => build('const document = { URL: 1 }; return document.URL;')).not.toThrow();
    expect(() =>
      build('class File { fetch() { return 1; } } return new File().fetch();'),
    ).not.toThrow();
  });

  test('daftar mencakup global yang disebut tidak tersedia oleh Google', () => {
    for (const name of [
      'File',
      'ReadableStream',
      'WritableStream',
      'DOMException',
      'SubtleCrypto',
    ]) {
      expect(() => build(`return new ${name}();`)).toThrow(new RegExp(`"${name}"`));
    }
    expect(() => build('return performance.now();')).toThrow(/"performance"/);
    expect(() => build('return module.exports;')).toThrow(/"module"/);
  });
});
