import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Setelah T23 kabel web hanya REST (`/api/v1`): tidak boleh ada sisa kabel RPC lama di web/, server/, dan shared/.
// `gas/` (aplikasi Apps Script lama) tetap memakai amplop RPC sampai dipensiunkan di T35; DTO amplop untuk GAS
// hidup di `shared/gas-legacy.ts` (berkas itu dikecualikan di bawah).

const ROOT = join(import.meta.dir, '..');
const SCAN_DIRS = ['web/src', 'server/src', 'server/test-support', 'server/scripts', 'shared'];
const EXTENSIONS = ['.ts', '.tsx'];
const IGNORED_DIRS = new Set(['node_modules', 'dist']);

/** Berkas yang sah menyebut istilah lama: DTO GAS dan tes yang membuktikan jalur lama sudah hilang. */
const ALLOWED: Record<string, readonly string[]> = {
  'shared/gas-legacy.ts': ['RpcResult', 'RpcErrorBody'],
  'server/src/routes.test.ts': ['/api/rpc', '/api/boot'],
  'server/src/server.test.ts': ['/api/boot'],
  'server/src/http/rest.test.ts': ['/api/rpc'],
  'server/src/modules/auth/rest.test.ts': ['/api/boot'],
};

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: '/api/rpc', pattern: /\/api\/rpc/ },
  { name: '/api/boot', pattern: /\/api\/boot/ },
  { name: 'RpcResult', pattern: /\bRpcResult\b/ },
  { name: 'RpcErrorBody', pattern: /\bRpcErrorBody\b/ },
  { name: 'REST_MIGRATED_IDS', pattern: /REST_MIGRATED_IDS/ },
  { name: 'handleRpc', pattern: /\bhandleRpc\b/ },
  { name: 'createRpc', pattern: /\bcreateRpc(Client)?\b/ },
  { name: '@/lib/rpc', pattern: /@\/lib\/rpc/ },
  { name: 'rpc(', pattern: /(^|[^A-Za-z0-9_.])rpc\(/ },
  { name: 'RpcError', pattern: /\bRpcError\b/ },
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (EXTENSIONS.some((extension) => path.endsWith(extension))) found.push(path);
  }
  return found;
}

test('tak ada sisa kabel RPC lama (rpc(), /api/rpc, RpcResult, REST_MIGRATED_IDS, ...) di web/, server/, shared/', () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const path of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, path).split('\\').join('/');
      if (rel === 'scripts/no-legacy-rpc.test.ts') continue;
      const allowed = ALLOWED[rel] ?? [];
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(line) && !allowed.includes(name)) {
            offenders.push(`${rel}:${index + 1} [${name}] ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
  }
  expect(offenders).toEqual([]);
});

test('direktori web/src/lib/rpc sudah dihapus', () => {
  expect(() => statSync(join(ROOT, 'web/src/lib/rpc'))).toThrow();
});

test('shared/rpc.ts tidak lagi memuat amplop RpcResult/RpcErrorBody (hanya ErrorCode dan DTO)', () => {
  const text = readFileSync(join(ROOT, 'shared/rpc.ts'), 'utf8');
  expect(text).not.toMatch(/\bRpcResult\b|\bRpcErrorBody\b/);
  expect(text).toContain('ERROR_CODES');
});
