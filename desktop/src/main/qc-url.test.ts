import { describe, expect, test } from 'vitest';
import { parseQcUrl } from './qc-url';

describe('parseQcUrl', () => {
  test('qc://country-lock → /country-lock', () => {
    expect(parseQcUrl('qc://country-lock')).toEqual({ route: '/country-lock' });
    expect(parseQcUrl('qc://country-lock/')).toEqual({ route: '/country-lock' });
  });

  test('skema atau host lain dan jalur tambahan ditolak', () => {
    for (const bad of [
      'https://country-lock',
      'app://qc/country-lock',
      'qc://lain',
      'qc://country-lock/../x',
      'qc://country-lock/sub',
      'qc://country-lock?x=1',
      'qc://country-lock#frag',
      'qc://user@country-lock',
      'qc://country-lock:99',
      'qc://country-lock.evil.com',
      'qc:country-lock',
      '',
      'bukan url',
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});

describe('parseQcUrl: qc://auth', () => {
  const code = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';
  const state = 'abcdefgh12345678';

  test('qc://auth?code=&state= sah → { route: null, auth }', () => {
    expect(parseQcUrl(`qc://auth?code=${code}&state=${state}`)).toEqual({
      route: null,
      auth: { code, state },
    });
    expect(parseQcUrl(`qc://auth/?state=${state}&code=${code}`)?.auth).toEqual({ code, state });
  });

  test('query kelebihan/kurang/ganda, kode atau state di luar pola, jalur, hash ditolak', () => {
    for (const bad of [
      'qc://auth',
      'qc://auth?code=abc',
      `qc://auth?state=${state}`,
      `qc://auth?code=${code}&state=${state}&x=1`,
      `qc://auth?code=${code}&code=${code}&state=${state}`,
      `qc://auth?code=&state=${state}`,
      `qc://auth?code=${code}&state=pendek`,
      `qc://auth?code=${code}&state=${'a'.repeat(129)}`,
      `qc://auth?code=${code}&state=abc def12345`,
      `qc://auth?code=${'a'.repeat(1025)}&state=${state}`,
      'qc://auth?code=a%2Fb&state=abcdefgh12',
      'qc://auth?code=a=b&state=abcdefgh12',
      'qc://auth?code=a%20b&state=abcdefgh12',
      `qc://auth/x?code=${code}&state=${state}`,
      `qc://auth?code=${code}&state=${state}#h`,
      `qc://user@auth?code=${code}&state=${state}`,
      `qc://AUTH?code=${code}&state=${state}`,
      `app://qc/auth?code=${code}&state=${state}`,
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});
