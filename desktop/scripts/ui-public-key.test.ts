import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { publicKeyFingerprint, publicKeyOneLine } from '../../countrylock/src/ui-manifest';
import { resolveReleasePublicKey, resolveUiPublicKey } from './ui-public-key';

function publicPem(type: 'ed25519' | 'rsa' = 'ed25519'): string {
  const { publicKey } =
    type === 'ed25519'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

describe('resolveUiPublicKey', () => {
  test('env kosong atau tak ada: null (build dev/tes), tetapi galat bila wajib (build rilis)', () => {
    expect(resolveUiPublicKey({})).toEqual({ pem: null, fingerprint: null });
    expect(resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: '   ' })).toEqual({
      pem: null,
      fingerprint: null,
    });
    expect(() => resolveUiPublicKey({}, true)).toThrow('wajib menanam');
    expect(() => resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: '' }, true)).toThrow('wajib menanam');
  });

  test('menerima PEM berbaris banyak, `\\n` harfiah, PEM satu baris, dan base64 satu baris; hasilnya sama', () => {
    const pem = publicPem();
    const fingerprint = publicKeyFingerprint(pem);
    const forms = [
      pem,
      pem.trim().replace(/\n/g, '\\n'),
      pem.trim().replace(/\n/g, ' '),
      publicKeyOneLine(pem),
      `  ${publicKeyOneLine(pem)}\n`,
    ];
    for (const form of forms) {
      const resolved = resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: form }, true);
      expect(resolved.pem).toBe(pem);
      expect(resolved.fingerprint).toBe(fingerprint);
    }
  });

  test('kunci yang diberikan tetapi rusak atau bukan Ed25519 SELALU galat, tanpa membocorkan isinya', () => {
    expect(() => resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: 'bukan kunci!!' })).toThrow(
      'dapat dibaca',
    );
    expect(() => resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: 'AAAA' })).toThrow('Ed25519');
    const rsa = publicPem('rsa');
    expect(() => resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: rsa })).toThrow('Ed25519');
    try {
      resolveUiPublicKey({ UI_PUBLIC_KEY_PEM: rsa });
    } catch (error) {
      expect(String(error)).not.toContain(publicKeyOneLine(rsa).slice(0, 40));
    }
  });
});

describe('resolveReleasePublicKey (kunci tanda tangan rilis, env DESKTOP_RELEASE_PUBLIC_KEY_PEM)', () => {
  test('membaca env namanya sendiri, bukan UI_PUBLIC_KEY_PEM', () => {
    const pem = publicPem();
    expect(resolveReleasePublicKey({ DESKTOP_RELEASE_PUBLIC_KEY_PEM: pem }).pem).toBe(pem);
    expect(resolveReleasePublicKey({ UI_PUBLIC_KEY_PEM: pem })).toEqual({
      pem: null,
      fingerprint: null,
    });
  });

  test('wajib (build rilis) galat dengan nama env dan dokumen yang benar; kunci rusak selalu galat tanpa isi', () => {
    expect(() => resolveReleasePublicKey({}, true)).toThrow('DESKTOP_RELEASE_PUBLIC_KEY_PEM');
    expect(() => resolveReleasePublicKey({}, true)).toThrow('docs/desktop-release-signing.md');
    expect(() => resolveReleasePublicKey({ DESKTOP_RELEASE_PUBLIC_KEY_PEM: 'AAAA' })).toThrow(
      'Ed25519',
    );
    expect(() =>
      resolveReleasePublicKey({ DESKTOP_RELEASE_PUBLIC_KEY_PEM: 'bukan kunci!!' }),
    ).toThrow('dapat dibaca');
  });
});
