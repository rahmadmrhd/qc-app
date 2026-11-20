import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProofStore, isStagedName, newStagedName, type ProofStore } from './store';

let root = '';
let dir = '';
let store: ProofStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qc-proof-store-'));
  dir = join(root, 'belum', 'ada'); // folder sengaja belum dibuat: dibuat saat tulis pertama
  store = createProofStore(dir);
});

afterEach(async () => {
  // Penjaga: `rm('')` menghapus isi direktori kerja bila `beforeEach` gagal sebelum `root` terisi.
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('newStagedName', () => {
  test('UUID acak yang lolos pola, selalu berbeda', () => {
    const a = newStagedName();
    const b = newStagedName();
    expect(isStagedName(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('ProofStore', () => {
  test('tulis, baca, hapus', async () => {
    const name = newStagedName();
    expect(await store.read(name)).toBeNull();
    await store.write(name, new Uint8Array([1, 2, 3, 4]));
    expect([...((await store.read(name)) ?? [])]).toEqual([1, 2, 3, 4]);
    await store.remove(name);
    expect(await store.read(name)).toBeNull();
    await store.remove(name); // hapus berkas yang sudah tak ada tidak melempar
  });

  test('menimpa nama yang sama dan tidak meninggalkan berkas .partial', async () => {
    const name = newStagedName();
    await store.write(name, new Uint8Array([1]));
    await store.write(name, new Uint8Array([9, 9]));
    expect([...((await store.read(name)) ?? [])]).toEqual([9, 9]);
    expect(await readdir(dir)).toEqual([name]);
  });

  test('nama tak valid ditolak di semua operasi (tanpa menyentuh disk)', async () => {
    for (const bad of [
      '',
      '../x',
      '..',
      '.',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'C:\\x',
      `${newStagedName()}/../x`,
      `${newStagedName()}.partial`,
      newStagedName().toUpperCase(),
      'x'.repeat(300),
    ]) {
      await expect(store.write(bad, new Uint8Array([1]))).rejects.toThrow();
      await expect(store.read(bad)).rejects.toThrow();
      await expect(store.remove(bad)).rejects.toThrow();
    }
    expect(await store.totalBytes()).toBe(0);
  });

  test('totalBytes: folder belum ada = 0, lalu jumlah ukuran semua berkas', async () => {
    expect(await store.totalBytes()).toBe(0);
    await store.write(newStagedName(), new Uint8Array(100));
    await store.write(newStagedName(), new Uint8Array(250));
    expect(await store.totalBytes()).toBe(350);
    // sisa .partial dari proses yang mati ikut dihitung (menghitung pemakaian disk sebenarnya)
    await writeFile(join(dir, `${newStagedName()}.partial`), new Uint8Array(50));
    expect(await store.totalBytes()).toBe(400);
  });

  test('menghapus mengurangi totalBytes', async () => {
    const a = newStagedName();
    await store.write(a, new Uint8Array(100));
    await store.write(newStagedName(), new Uint8Array(40));
    await store.remove(a);
    expect(await store.totalBytes()).toBe(40);
  });
});
