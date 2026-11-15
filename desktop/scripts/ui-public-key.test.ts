import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { publicKeyFingerprint, publicKeyOneLine } from '../../countrylock/src/ui-manifest';
import { resolveUiPublicKey } from './ui-public-key';

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
