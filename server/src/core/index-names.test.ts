// Nama indeks yang disebut kode (peta konflik `mapDuplicateError`, `RETRYABLE_UNIQUE_KEYS`, pembanding `error.key`)
// harus ada di skema, baik pada skema expand (indeks lama + `_live`) maupun setelah migrasi contract (hanya `_live`).
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createTestEnv } from '@server-test/test-env';
import { RETRYABLE_UNIQUE_KEYS } from './cas';
import { baseIndexName } from './index-names';

const SRC = join(import.meta.dir, '..');

/** Indeks yang tidak dibuat migrasi (dibuat server saat start oleh `ensureSerialUniqueIndex`; bersyarat). */
const CREATED_AT_BOOT = new Set(['serials_serial']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** Semua nama indeks yang disebut kode, dikumpulkan dari sumber non-tes. */
function referencedIndexNames(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(SRC.length + 1).replaceAll('\\', '/');
    for (const m of text.matchAll(/\.key\s*===\s*'([A-Za-z0-9_]+)'/g))
      found.set(m[1] as string, rel);
    for (const m of text.matchAll(/baseIndexName\([^)]*\)\s*===\s*'([A-Za-z0-9_]+)'/g)) {
      found.set(m[1] as string, rel);
    }
    // Kunci peta konflik: `nama_indeks: { field|message: ...`
    for (const m of text.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*):\s*\{\s*(?:field|message)\b/gm)) {
      found.set(m[1] as string, rel);
    }
    // Himpunan kunci yang dapat diulang di luar cas.ts (mis. CASE_RETRYABLE_KEYS).
    for (const m of text.matchAll(/RETRYABLE_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/g)) {
      for (const k of (m[1] as string).matchAll(/'([A-Za-z0-9_]+)'/g))
        found.set(k[1] as string, rel);
    }
  }
  for (const key of RETRYABLE_UNIQUE_KEYS) found.set(key, 'core/cas.ts');
  return found;
}

test('pemindai menemukan nama indeks yang sudah kita kenal', () => {
  const names = referencedIndexNames();
  for (const expected of ['brands_key', 'items_key', 'PRIMARY', 'stickers_type_name_unique']) {
    expect(names.has(expected), expected).toBe(true);
  }
});

test('setiap nama indeks yang disebut kode ada di skema, pada skema expand dan setelah contract', async () => {
  const env = await createTestEnv();
  const rows = await env.DB.prepare(
    'SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE()',
  ).all<{ name: string }>();
  const expand = new Set(rows.results.map((r) => r.name));
  // Skema contract: indeks lama yang punya padanan `_live` dibuang.
  const contract = new Set([...expand].filter((name) => !expand.has(`${name}_live`)));

  const missing: string[] = [];
  for (const [name, file] of referencedIndexNames()) {
    const base = baseIndexName(name);
    if (CREATED_AT_BOOT.has(base)) continue;
    const inExpand = expand.has(name) || expand.has(base) || expand.has(`${base}_live`);
    const inContract = contract.has(name) || contract.has(base) || contract.has(`${base}_live`);
    if (!inExpand || !inContract) missing.push(`${name} (${file})`);
  }
  expect(missing).toEqual([]);
});
