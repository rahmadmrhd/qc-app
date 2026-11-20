import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyFingerprint, publicKeyPemOf } from '../countrylock/src/ui-manifest';
import { removeTempDirSync } from '../server/test-support/safe-rm';
import { generateSigningKey, RELEASE_PRIVATE_KEY_SUFFIX } from './gen-ui-signing-key';

describe('generateSigningKey dengan sufiks rilis', () => {
  test('menulis pasangan kunci; kunci publik cocok dengan privat; privat tidak dikembalikan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-genkey-'));
    try {
      const file = join(dir, `uji${RELEASE_PRIVATE_KEY_SUFFIX}`);
      const result = generateSigningKey(file, RELEASE_PRIVATE_KEY_SUFFIX);
      expect(existsSync(file)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(publicKeyFingerprint(result.publicKeyPem)).toBe(
        publicKeyFingerprint(publicKeyPemOf(readFileSync(file, 'utf8'))),
      );
      expect(result.publicKeyPath.endsWith('.release-signing-key.pub.pem')).toBe(true);
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('nama tanpa sufiks rilis ditolak, dan sufiks manifest UI tak diterima untuk kunci rilis', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-genkey-'));
    try {
      expect(() =>
        generateSigningKey(join(dir, 'x.ui-signing-key.pem'), RELEASE_PRIVATE_KEY_SUFFIX),
      ).toThrow(RELEASE_PRIVATE_KEY_SUFFIX);
      expect(existsSync(join(dir, 'x.ui-signing-key.pem'))).toBe(false);
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('tidak menimpa kunci yang sudah ada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-genkey-'));
    try {
      const file = join(dir, `uji${RELEASE_PRIVATE_KEY_SUFFIX}`);
      generateSigningKey(file, RELEASE_PRIVATE_KEY_SUFFIX);
      expect(() => generateSigningKey(file, RELEASE_PRIVATE_KEY_SUFFIX)).toThrow();
    } finally {
      removeTempDirSync(dir);
    }
  });
});
