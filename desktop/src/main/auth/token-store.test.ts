import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTokenStore, type TokenCrypto } from './token-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-token-'));
  file = join(dir, 'sub', 'token.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Tiruan safeStorage: XOR + penanda; bukan enkripsi sungguhan, cukup agar isi disk != polos. */
const fakeCrypto = (): TokenCrypto => ({
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (data) => Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8'),
});

const SECRET = 'tok.SANGAT-RAHASIA.abc123';
const value = { token: SECRET, email: 'a@b.co', expiresAt: 2_000_000 };

describe('createTokenStore', () => {
  test('bertahan setelah dibuka ulang', () => {
    const first = createTokenStore(file, fakeCrypto(), () => 1000);
    expect(first.get()).toBeNull();
    first.set(value);
    expect(createTokenStore(file, fakeCrypto(), () => 1000).get()).toEqual(value);
  });

  test('terenkripsi di disk: berkas tidak memuat token polos', () => {
    createTokenStore(file, fakeCrypto(), () => 1000).set(value);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('a@b.co');
    expect(readdirSync(join(dir, 'sub'))).toEqual(['token.json']); // tanpa berkas sementara
  });

  test('crypto null tidak menulis disk; token hanya di memori', () => {
    const store = createTokenStore(file, null, () => 1000);
    store.set(value);
    expect(store.get()).toEqual(value);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(dir, 'sub'))).toBe(false);
    expect(createTokenStore(file, null, () => 1000).get()).toBeNull();
  });

  test('berkas rusak, bentuk salah, atau tak terdekripsi = kosong tanpa melempar', () => {
    const store = createTokenStore(file, fakeCrypto(), () => 1000);
    store.set(value);
    writeFileSync(file, '{ rusak');
    expect(createTokenStore(file, fakeCrypto(), () => 1000).get()).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ v: 1, data: Buffer.from('bukan terenkripsi').toString('base64') }),
    );
    expect(createTokenStore(file, fakeCrypto(), () => 1000).get()).toBeNull();
    const bad: TokenCrypto = { encrypt: fakeCrypto().encrypt, decrypt: () => '{"token":1}' };
    writeFileSync(file, JSON.stringify({ v: 1, data: 'AAAA' }));
    expect(createTokenStore(file, bad, () => 1000).get()).toBeNull();
  });

  test('clear menghapus memori dan berkas', () => {
    const store = createTokenStore(file, fakeCrypto(), () => 1000);
    store.set(value);
    store.clear();
    expect(store.get()).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  test('token kedaluwarsa tidak dikembalikan dan berkasnya dihapus', () => {
    let clock = 1000;
    const store = createTokenStore(file, fakeCrypto(), () => clock);
    store.set(value);
    clock = 2_000_000;
    expect(store.get()).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  test('enkripsi gagal: token tetap di memori dan tidak ditulis polos', () => {
    const broken: TokenCrypto = {
      encrypt: () => {
        throw new Error('safeStorage tak tersedia');
      },
      decrypt: fakeCrypto().decrypt,
    };
    const store = createTokenStore(file, broken, () => 1000);
    expect(() => store.set(value)).not.toThrow();
    expect(store.get()).toEqual(value);
    expect(existsSync(file)).toBe(false);
  });

  test('get mengembalikan salinan', () => {
    const store = createTokenStore(file, null, () => 1000);
    store.set(value);
    const copy = store.get();
    if (copy) copy.token = 'diubah';
    expect(store.get()?.token).toBe(SECRET);
  });
});
