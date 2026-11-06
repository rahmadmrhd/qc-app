import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildBridgeFiles, loadBridgeFiles, missingBridgeEntryPoints } from './build-bridge-lib';

test('bridge/src lolos pagar GAS, dimuat maju dan mundur, dan mengekspos doPost/doGet', async () => {
  const files = await buildBridgeFiles();
  expect(files.length).toBeGreaterThan(5);
  expect(loadBridgeFiles(files)).toEqual([]);
  expect(missingBridgeEntryPoints(files)).toEqual([]);
  for (const file of files) expect(file.code).not.toMatch(/^[ \t]*(?:import|export)\b/m);
});

async function buildFrom(source: string): Promise<unknown> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge-build-'));
  try {
    await writeFile(path.join(dir, 'a.ts'), source);
    return await buildBridgeFiles(dir).then(
      () => null,
      (error: unknown) => error,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('fungsi global tanpa akhiran _ ditolak', async () => {
  const error = await buildFrom('export function bocor(): number { return 1; }');
  expect(String(error)).toContain('wajib berakhiran');
});

test('API yang tidak ada di runtime GAS ditolak (atob, fetch, URL)', async () => {
  for (const code of ['atob("x")', 'fetch("u")', 'new URL("http://a")']) {
    const error = await buildFrom(`export function ok_(): unknown { return ${code}; }`);
    expect(String(error)).toContain('runtime Apps Script');
  }
});

test('nama global ganda antarberkas ditolak', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge-build-'));
  try {
    await writeFile(path.join(dir, 'a.ts'), 'export function dup_(): number { return 1; }');
    await writeFile(path.join(dir, 'b.ts'), 'export function dup_(): number { return 2; }');
    await expect(buildBridgeFiles(dir)).rejects.toThrow('bentrok');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('kode level atas yang memakai global berkas lain gagal dimuat', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge-build-'));
  try {
    await writeFile(path.join(dir, 'a.ts'), 'export const A_VALUE = 1;');
    await writeFile(path.join(dir, 'b.ts'), 'export const B_VALUE = A_VALUE + 1;');
    const files = await buildBridgeFiles(dir);
    expect(loadBridgeFiles(files).length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
