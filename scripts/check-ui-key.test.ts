import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeFingerprint, publicKeyFingerprint } from '../countrylock/src/ui-manifest';
import { writeUiManifest } from './build-ui-manifest';
import { checkUiKey, DESKTOP_PUBLIC_KEY_SOURCE, readPublicKeyFromSource } from './check-ui-key';
import { signDistManifest } from './sign-ui-manifest';

let root: string;

function keyPair(type: 'ed25519' | 'rsa' = 'ed25519') {
  const { privateKey, publicKey } =
    type === 'ed25519'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function privateFile(pem: string, name = 'kunci.ui-signing-key.pem'): string {
  const file = path.join(root, name);
  writeFileSync(file, pem);
  return file;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'qc-check-ui-key-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sidik kunci publik', () => {
  test('stabil untuk kunci yang sama, berbeda antar kunci, dan 64 heksa huruf kecil', () => {
    const a = keyPair();
    const b = keyPair();
    expect(publicKeyFingerprint(a.publicPem)).toBe(publicKeyFingerprint(a.publicPem));
    expect(publicKeyFingerprint(a.publicPem)).not.toBe(publicKeyFingerprint(b.publicPem));
    expect(publicKeyFingerprint(a.publicPem)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('kunci non-Ed25519 ditolak', () => {
    expect(() => publicKeyFingerprint(keyPair('rsa').publicPem)).toThrow('Ed25519');
  });

  test('normalizeFingerprint menerima huruf besar, titik dua, dan spasi; bentuk lain null', () => {
    const fp = publicKeyFingerprint(keyPair().publicPem);
    const colons = fp.toUpperCase().match(/../g)?.join(':') ?? '';
    expect(normalizeFingerprint(colons)).toBe(fp);
    expect(normalizeFingerprint(`  ${fp}\n`)).toBe(fp);
    expect(normalizeFingerprint(fp.slice(1))).toBeNull();
    expect(normalizeFingerprint('bukan heksa')).toBeNull();
  });
});

describe('checkUiKey', () => {
  test('pasangan kunci yang cocok lolos dan sidik keduanya sama', () => {
    const pair = keyPair();
    const result = checkUiKey({
      privateKeyFile: privateFile(pair.privatePem),
      publicKeyPem: pair.publicPem,
    });
    expect(result.publicFingerprint).toBe(publicKeyFingerprint(pair.publicPem));
    expect(result.privateFingerprint).toBe(result.publicFingerprint);
    expect(result.warnings).toEqual([]);
  });

  test('kunci privat dan publik dari pasangan berbeda DITOLAK (tertukar atau salah putar)', () => {
    const file = privateFile(keyPair().privatePem);
    expect(() => checkUiKey({ privateKeyFile: file, publicKeyPem: keyPair().publicPem })).toThrow(
      'TIDAK berpasangan',
    );
  });

  test('sidik yang diharapkan: cocok lolos, tak cocok ditolak, bentuk salah ditolak', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    const fp = publicKeyFingerprint(pair.publicPem);
    expect(
      checkUiKey({ privateKeyFile: file, expectedFingerprint: fp.toUpperCase() }),
    ).toMatchObject({
      privateFingerprint: fp,
      publicFingerprint: null,
    });
    const other = publicKeyFingerprint(keyPair().publicPem);
    expect(() => checkUiKey({ privateKeyFile: file, expectedFingerprint: other })).toThrow(
      'tidak sama dengan sidik yang diharapkan',
    );
    expect(() => checkUiKey({ publicKeyPem: pair.publicPem, expectedFingerprint: other })).toThrow(
      'tidak sama dengan sidik yang diharapkan',
    );
    expect(() => checkUiKey({ privateKeyFile: file, expectedFingerprint: 'abc' })).toThrow(
      'bukan SHA-256',
    );
  });

  test('kunci publik kosong: peringatan biasa, tetapi GALAT bila wajib (build desktop rilis)', () => {
    const file = privateFile(keyPair().privatePem);
    const lenient = checkUiKey({ privateKeyFile: file, publicKeyPem: null });
    expect(lenient.publicFingerprint).toBeNull();
    expect(lenient.warnings.join(' ')).toContain('belum ditanam');
    expect(() =>
      checkUiKey({ privateKeyFile: file, publicKeyPem: '  ', requirePublicKey: true }),
    ).toThrow('Kunci publik desktop kosong');
  });

  test('kunci publik bukan Ed25519 atau rusak ditolak', () => {
    expect(() => checkUiKey({ publicKeyPem: keyPair('rsa').publicPem })).toThrow('tidak sah');
    expect(() => checkUiKey({ publicKeyPem: 'bukan pem' })).toThrow('tidak sah');
  });

  test('kunci privat rusak, bukan Ed25519, atau tak ada ditolak; tanpa kunci apa pun ditolak', () => {
    expect(() => checkUiKey({ privateKeyFile: privateFile('bukan pem') })).toThrow('tidak sah');
    expect(() => checkUiKey({ privateKeyFile: privateFile(keyPair('rsa').privatePem) })).toThrow(
      'tidak sah',
    );
    expect(() => checkUiKey({ privateKeyFile: path.join(root, 'tidak-ada.pem') })).toThrow(
      'tidak terbaca',
    );
    expect(() => checkUiKey({})).toThrow('Tidak ada kunci');
  });

  test('isi kunci privat tidak pernah ada di pesan galat', () => {
    const pair = keyPair();
    const body = pair.privatePem.split('\n')[1] ?? '';
    expect(body.length).toBeGreaterThan(10);
    const attempts: Array<() => unknown> = [
      () =>
        checkUiKey({
          privateKeyFile: privateFile(pair.privatePem),
          publicKeyPem: keyPair().publicPem,
        }),
      () =>
        checkUiKey({
          privateKeyFile: privateFile(pair.privatePem),
          expectedFingerprint: publicKeyFingerprint(keyPair().publicPem),
        }),
      () => checkUiKey({ privateKeyFile: privateFile(`-----BEGIN PRIVATE KEY-----\n${body}\n`) }),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        throw new Error('seharusnya gagal');
      } catch (error) {
        expect(String(error)).not.toContain(body);
      }
    }
  });
});

describe('readPublicKeyFromSource', () => {
  test('membaca null dan template literal PEM; bentuk tak dikenal melempar', () => {
    const pair = keyPair();
    const nullFile = path.join(root, 'null.ts');
    writeFileSync(nullFile, '// c\nexport const UI_PUBLIC_KEY_PEM: string | null = null;\n');
    expect(readPublicKeyFromSource(nullFile)).toBeNull();
    const pemFile = path.join(root, 'pem.ts');
    writeFileSync(
      pemFile,
      `export const UI_PUBLIC_KEY_PEM: string | null = \`${pair.publicPem}\`;\n`,
    );
    expect(readPublicKeyFromSource(pemFile)).toBe(pair.publicPem);
    const badFile = path.join(root, 'bad.ts');
    writeFileSync(badFile, 'export const LAIN = 1;\n');
    expect(() => readPublicKeyFromSource(badFile)).toThrow('tidak ditemukan');
  });

  test('sumber desktop yang sebenarnya masih terbaca (format tak berubah diam-diam)', () => {
    const value = readPublicKeyFromSource(DESKTOP_PUBLIC_KEY_SOURCE);
    expect(value === null || value.includes('BEGIN PUBLIC KEY')).toBe(true);
  });
});

describe('signDistManifest dengan sidik yang diharapkan', () => {
  function prepareDist(): string {
    const dist = path.join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    writeUiManifest(dist, { minBridge: 2, now: 1_700_000_000_000 });
    return dist;
  }

  test('sidik cocok: tanda tangan ditulis', () => {
    const pair = keyPair();
    const dist = prepareDist();
    signDistManifest(dist, privateFile(pair.privatePem), publicKeyFingerprint(pair.publicPem));
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(true);
  });

  test('sidik tak cocok: GAGAL dan .sig tidak ditulis', () => {
    const dist = prepareDist();
    const file = privateFile(keyPair().privatePem);
    expect(() => signDistManifest(dist, file, publicKeyFingerprint(keyPair().publicPem))).toThrow(
      'TIDAK berpasangan',
    );
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(false);
  });

  test('sidik berbentuk salah ditolak; tanpa sidik tetap menandatangani (perilaku lama)', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    const dist = prepareDist();
    expect(() => signDistManifest(dist, file, 'abc')).toThrow('bukan SHA-256');
    signDistManifest(dist, file);
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(true);
  });
});

describe('CLI check-ui-key', () => {
  const script = path.join(import.meta.dir, 'check-ui-key.ts');

  function run(args: string[], env: Record<string, string> = {}) {
    const result = Bun.spawnSync([process.execPath, 'run', script, ...args], {
      env: { ...process.env, UI_PUBLIC_KEY_PEM: '', UI_PUBLIC_KEY_FINGERPRINT: '', ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      code: result.exitCode,
      out: result.stdout.toString(),
      err: result.stderr.toString(),
    };
  }

  test('pasangan cocok: kode 0 dan sidik dicetak; tertukar: kode 1', () => {
    const pair = keyPair();
    const publicFile = path.join(root, 'kunci.pub.pem');
    writeFileSync(publicFile, pair.publicPem);
    const ok = run(['--private', privateFile(pair.privatePem), '--public', publicFile]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(publicKeyFingerprint(pair.publicPem));

    const swapped = run([
      '--private',
      privateFile(keyPair().privatePem, 'lain.ui-signing-key.pem'),
      '--public',
      publicFile,
    ]);
    expect(swapped.code).toBe(1);
    expect(swapped.err).toContain('TIDAK berpasangan');
  });

  test('kunci publik dari env UI_PUBLIC_KEY_PEM dan sidik dari env UI_PUBLIC_KEY_FINGERPRINT', () => {
    const pair = keyPair();
    const ok = run(['--private', privateFile(pair.privatePem)], {
      UI_PUBLIC_KEY_PEM: pair.publicPem,
      UI_PUBLIC_KEY_FINGERPRINT: publicKeyFingerprint(pair.publicPem),
    });
    expect(ok.code).toBe(0);
    const wrong = run(['--private', privateFile(pair.privatePem)], {
      UI_PUBLIC_KEY_PEM: pair.publicPem,
      UI_PUBLIC_KEY_FINGERPRINT: publicKeyFingerprint(keyPair().publicPem),
    });
    expect(wrong.code).toBe(1);
  });

  test('--require-public gagal (kode 1) tanpa kunci publik yang berpasangan', () => {
    const file = privateFile(keyPair().privatePem);
    // Tanpa --public dan tanpa env, CLI membaca sumber desktop. Saat ini null: galat "kosong". Bila kelak terisi,
    // kunci itu pasti tak berpasangan dengan kunci acak uji ini: galat "TIDAK berpasangan". Keduanya kode 1.
    const result = run(['--private', file, '--require-public']);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/kosong|TIDAK berpasangan/);
  });
});
