import { describe, expect, test } from 'bun:test';
import { GUIDE_COVERS, GUIDE_IDS, GUIDE_VERSIONS } from './guides';

describe('daftar panduan', () => {
  test('setiap id punya versi bilangan bulat >= 1 dan tak ada versi tanpa id', () => {
    for (const id of GUIDE_IDS) {
      expect(Number.isInteger(GUIDE_VERSIONS[id]), id).toBe(true);
      expect(GUIDE_VERSIONS[id], id).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(GUIDE_VERSIONS).sort()).toEqual([...GUIDE_IDS].sort());
  });

  test('id panduan unik', () => {
    expect(new Set(GUIDE_IDS).size).toBe(GUIDE_IDS.length);
  });

  test('kunci dan nilai GUIDE_COVERS semuanya id panduan yang dikenal', () => {
    const known = new Set<string>(GUIDE_IDS);
    for (const [key, covered] of Object.entries(GUIDE_COVERS)) {
      expect(known.has(key), key).toBe(true);
      for (const id of covered ?? []) expect(known.has(id), `${key} -> ${id}`).toBe(true);
    }
  });
});
