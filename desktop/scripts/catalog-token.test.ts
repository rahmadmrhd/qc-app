import { describe, expect, test } from 'vitest';
import { resolveCatalogToken } from './catalog-token';

describe('resolveCatalogToken', () => {
  test('kosong atau tidak ada = tanpa token dan tanpa masalah', () => {
    expect(resolveCatalogToken({})).toEqual({ token: null, problem: null });
    expect(resolveCatalogToken({ CATALOG_TOKEN: '   ' })).toEqual({ token: null, problem: null });
  });

  test('token sah dipakai (spasi pinggir dibuang)', () => {
    const token = 'ab12'.repeat(10);
    expect(resolveCatalogToken({ CATALOG_TOKEN: ` ${token}\n` })).toEqual({ token, problem: null });
  });

  test('terlalu pendek atau berkarakter aneh = diabaikan; pesan tidak memuat nilainya', () => {
    for (const value of [
      'pendek',
      `${'a'.repeat(40)} spasi`,
      `${'a'.repeat(40)}"`,
      'é'.repeat(40),
    ]) {
      const result = resolveCatalogToken({ CATALOG_TOKEN: value });
      expect(result.token).toBeNull();
      expect(result.problem).toBeTruthy();
      expect(result.problem).not.toContain(value);
    }
  });
});
