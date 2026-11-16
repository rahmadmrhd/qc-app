import { GUIDE_IDS, GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import type { GuideEntry } from '../lib/types';
import { GUIDE_CATALOG } from './index';

/**
 * Kesamaan DUA arah antara `shared/guides.ts` dan katalog (spek 4.1): setiap entri `disimpan` ada di `GUIDE_IDS`
 * dengan versi yang sama, dan setiap id di `GUIDE_IDS` punya entri katalog (id yatim = panduan yang dihapus dari
 * web tetapi masih diterima server).
 */
function idsWithoutCatalogEntry(catalog: readonly GuideEntry[], ids: readonly string[]): string[] {
  const inCatalog = new Set(catalog.map((entry) => entry.id));
  return ids.filter((id) => !inCatalog.has(id));
}

function entriesWithoutId(catalog: readonly GuideEntry[], ids: readonly string[]): string[] {
  return catalog
    .filter((entry) => entry.status === 'disimpan' && !ids.includes(entry.id))
    .map((entry) => entry.id);
}

function versionMismatches(catalog: readonly GuideEntry[]): string[] {
  const versions = GUIDE_VERSIONS as Record<string, number>;
  return catalog
    .filter((entry) => entry.status === 'disimpan' && versions[entry.id] !== entry.version)
    .map((entry) => entry.id);
}

function entry(id: string): GuideEntry {
  return { id, kind: 'tip', status: 'disimpan', version: 1, title: id, steps: [] };
}

describe('shared/guides.ts <-> katalog', () => {
  test('setiap id di GUIDE_IDS punya entri katalog (termasuk sapaan-awal)', () => {
    expect(idsWithoutCatalogEntry(GUIDE_CATALOG, GUIDE_IDS)).toEqual([]);
  });

  test('setiap entri disimpan di katalog ada di GUIDE_IDS dengan versi yang sama', () => {
    expect(entriesWithoutId(GUIDE_CATALOG, GUIDE_IDS)).toEqual([]);
    expect(versionMismatches(GUIDE_CATALOG)).toEqual([]);
  });

  test('sapaan-awal adalah entri katalog bertipe sapaan tanpa langkah', () => {
    const sapaan = GUIDE_CATALOG.find((item) => item.id === 'sapaan-awal');
    expect(sapaan?.kind).toBe('sapaan');
    expect(sapaan?.steps).toEqual([]);
  });

  test('pemeriksa menangkap id yatim di shared dan entri katalog tak terdaftar', () => {
    expect(idsWithoutCatalogEntry([entry('a')], ['a', 'hantu'])).toEqual(['hantu']);
    expect(entriesWithoutId([entry('a'), entry('b')], ['a'])).toEqual(['b']);
    expect(idsWithoutCatalogEntry([entry('a')], ['a'])).toEqual([]);
  });
});
