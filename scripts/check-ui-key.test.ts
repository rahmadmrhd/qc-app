import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeFingerprint,
  normalizePublicKeyInput,
  publicKeyFingerprint,
  publicKeyOneLine,
} from '../countrylock/src/ui-manifest';
import { writeUiManifest } from './build-ui-manifest';
import { checkUiKey } from './check-ui-key';
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

describe('sidik dan normalisasi kunci publik', () => {
  test('sidik stabil untuk kunci yang sama, berbeda antar kunci, dan 64 heksa huruf kecil', () => {
    const a = keyPair();
    const b = keyPair();
    expect(publicKeyFingerprint(a.publicPem)).toBe(publicKeyFingerprint(a.publicPem));
    expect(publicKeyFingerprint(a.publicPem)).not.toBe(publicKeyFingerprint(b.publicPem));
    expect(publicKeyFingerprint(a.publicPem)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('kunci non-Ed25519 ditolak sidiknya', () => {
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

  test('normalizePublicKeyInput: PEM, `\\n` harfiah, PEM satu baris, dan base64 satu baris menghasilkan PEM yang sama', () => {
    const { publicPem } = keyPair();
    const oneLine = publicKeyOneLine(publicPem);
    expect(oneLine).not.toContain('\n');
    expect(oneLine).not.toContain('-----');
    const forms = [
      publicPem,
      publicPem.trim().replace(/\n/g, '\\n'),
      publicPem.trim().replace(/\n/g, ' '),
      oneLine,
      `  ${oneLine}\n`,
    ];
    for (const form of forms) expect(normalizePublicKeyInput(form)).toBe(publicPem);
  });

  test('normalizePublicKeyInput menolak teks yang bukan base64', () => {
    expect(normalizePublicKeyInput('bukan kunci!!')).toBeNull();
    expect(normalizePublicKeyInput('')).toBeNull();
    expect(normalizePublicKeyInput('-----BEGIN PUBLIC KEY-----')).toBeNull();
  });
});

describe('checkUiKey', () => {
  test('pasangan kunci yang cocok lolos dan sidik keduanya sama (juga dengan kunci publik satu baris)', () => {
    const pair = keyPair();
    for (const publicKeyPem of [pair.publicPem, publicKeyOneLine(pair.publicPem)]) {
      const result = checkUiKey({ privateKeyFile: privateFile(pair.privatePem), publicKeyPem });
      expect(result.publicFingerprint).toBe(publicKeyFingerprint(pair.publicPem));
      expect(result.privateFingerprint).toBe(result.publicFingerprint);
      expect(result.warnings).toEqual([]);
    }
  });

  test('kunci privat dan publik dari pasangan berbeda DITOLAK (tertukar atau salah putar)', () => {
    const file = privateFile(keyPair().privatePem);
    expect(() => checkUiKey({ privateKeyFile: file, publicKeyPem: keyPair().publicPem })).toThrow(
      'TIDAK berpasangan',
    );
  });

  test('sidik yang diharapkan (opsional, bantuan manual): cocok lolos, tak cocok ditolak, bentuk salah ditolak', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    const fp = publicKeyFingerprint(pair.publicPem);
    expect(
      checkUiKey({ privateKeyFile: file, expectedFingerprint: fp.toUpperCase() }),
    ).toMatchObject({ privateFingerprint: fp, publicFingerprint: null });
    const other = publicKeyFingerprint(keyPair().publicPem);
    expect(() => checkUiKey({ privateKeyFile: file, expectedFingerprint: other })).toThrow(
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
    expect(() => checkUiKey({ publicKeyPem: 'bukan kunci!!' })).toThrow('tidak sah');
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

describe('signDistManifest dengan kunci publik desktop', () => {
  function prepareDist(): string {
    const dist = path.join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    writeUiManifest(dist, { minBridge: 2, now: 1_700_000_000_000 });
    return dist;
  }
  const sigOf = (dist: string) => path.join(dist, 'ui-manifest.sig');

  test('kunci publik cocok (PEM atau satu baris): tanda tangan ditulis', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    for (const publicKey of [pair.publicPem, publicKeyOneLine(pair.publicPem)]) {
      const dist = prepareDist();
      signDistManifest(dist, file, { publicKey, requirePublicKey: true });
      expect(existsSync(sigOf(dist))).toBe(true);
      rmSync(dist, { recursive: true });
    }
  });

  test('kunci publik dari pasangan lain: GAGAL dan .sig tidak ditulis', () => {
    const dist = prepareDist();
    const file = privateFile(keyPair().privatePem);
    expect(() => signDistManifest(dist, file, { publicKey: keyPair().publicPem })).toThrow(
      'TIDAK berpasangan',
    );
    expect(existsSync(sigOf(dist))).toBe(false);
  });

  test('kunci publik berbentuk salah ditolak tanpa menulis .sig', () => {
    const dist = prepareDist();
    const file = privateFile(keyPair().privatePem);
    expect(() => signDistManifest(dist, file, { publicKey: 'bukan kunci!!' })).toThrow(
      'dapat dibaca',
    );
    expect(existsSync(sigOf(dist))).toBe(false);
  });

  test('requirePublicKey tanpa kunci publik: GAGAL; tanpa opsi apa pun tetap menandatangani (perilaku lama)', () => {
    const file = privateFile(keyPair().privatePem);
    const dist = prepareDist();
    for (const publicKey of [undefined, '', '   ']) {
      expect(() => signDistManifest(dist, file, { publicKey, requirePublicKey: true })).toThrow(
        'UI_PUBLIC_KEY_PEM wajib',
      );
      expect(existsSync(sigOf(dist))).toBe(false);
    }
    signDistManifest(dist, file);
    expect(existsSync(sigOf(dist))).toBe(true);
  });
});

describe('CLI', () => {
  const checkScript = path.join(import.meta.dir, 'check-ui-key.ts');
  const signScript = path.join(import.meta.dir, 'sign-ui-manifest.ts');

  function run(script: string, args: string[], env: Record<string, string> = {}) {
    const result = Bun.spawnSync([process.execPath, 'run', script, ...args], {
      env: { ...process.env, UI_PUBLIC_KEY_PEM: '', ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  }

  test('check-ui-key: pasangan cocok kode 0 dan sidik dicetak; tertukar kode 1', () => {
    const pair = keyPair();
    const publicFile = path.join(root, 'kunci.pub.pem');
    writeFileSync(publicFile, pair.publicPem);
    const ok = run(checkScript, [
      '--private',
      privateFile(pair.privatePem),
      '--public',
      publicFile,
    ]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(publicKeyFingerprint(pair.publicPem));

    const swapped = run(checkScript, [
      '--private',
      privateFile(keyPair().privatePem, 'lain.ui-signing-key.pem'),
      '--public',
      publicFile,
    ]);
    expect(swapped.code).toBe(1);
    expect(swapped.err).toContain('TIDAK berpasangan');
  });

  test('check-ui-key: kunci publik dari env UI_PUBLIC_KEY_PEM (satu baris, seperti Variable CI)', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    const ok = run(checkScript, ['--private', file], {
      UI_PUBLIC_KEY_PEM: publicKeyOneLine(pair.publicPem),
    });
    expect(ok.code).toBe(0);
    const wrong = run(checkScript, ['--private', file], {
      UI_PUBLIC_KEY_PEM: publicKeyOneLine(keyPair().publicPem),
    });
    expect(wrong.code).toBe(1);
  });

  test('check-ui-key --require-public: env kosong menggagalkan (kode 1)', () => {
    const result = run(checkScript, [
      '--private',
      privateFile(keyPair().privatePem),
      '--require-public',
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('kosong');
  });

  test('sign-ui-manifest --require-public-key (seperti Dockerfile): tanpa env gagal, cocok lolos, tertukar gagal', () => {
    const pair = keyPair();
    const file = privateFile(pair.privatePem);
    const dist = path.join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    writeUiManifest(dist, { minBridge: 2, now: 1_700_000_000_000 });
    const args = ['--key', file, '--dist', dist, '--require-public-key'];

    const missing = run(signScript, args);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('UI_PUBLIC_KEY_PEM wajib');
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(false);

    const swapped = run(signScript, args, {
      UI_PUBLIC_KEY_PEM: publicKeyOneLine(keyPair().publicPem),
    });
    expect(swapped.code).toBe(1);
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(false);

    const ok = run(signScript, args, { UI_PUBLIC_KEY_PEM: publicKeyOneLine(pair.publicPem) });
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(publicKeyFingerprint(pair.publicPem));
    expect(existsSync(path.join(dist, 'ui-manifest.sig'))).toBe(true);
  });
});
