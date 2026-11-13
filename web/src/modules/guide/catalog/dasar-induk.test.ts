import { describe, expect, test } from 'vitest';
import type { GuideEntry } from '../lib/types';
import { GUIDE_CATALOG } from './index';

/**
 * M3 (review): setiap panduan `baru` menyebut `dasar` induknya secara eksplisit (spek 4.2: `baru` baru ditawarkan
 * setelah `dasar` modulnya selesai) dan induk itu ada di katalog sebagai entri `dasar`. Berkas terpisah dari
 * `catalog.test.ts` agar perubahan paralel pada berkas itu tak bentrok.
 */
function dasarProblems(catalog: readonly GuideEntry[]): string[] {
  const problems: string[] = [];
  for (const entry of catalog) {
    if (entry.kind !== 'baru') continue;
    if (entry.dasar === undefined) {
      problems.push(`${entry.id}: panduan baru tanpa field dasar`);
      continue;
    }
    const parent = catalog.find((candidate) => candidate.id === entry.dasar);
    if (!parent) problems.push(`${entry.id}: dasar ${entry.dasar} tidak ada di katalog`);
    else if (parent.kind !== 'dasar')
      problems.push(`${entry.id}: ${entry.dasar} bukan panduan dasar`);
  }
  return problems;
}

function entry(overrides: Partial<GuideEntry>): GuideEntry {
  return {
    id: 'x',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'T',
    steps: [],
    ...overrides,
  };
}

describe('panduan baru menyebut dasar induknya', () => {
  test('katalog nyata', () => {
    expect(dasarProblems(GUIDE_CATALOG)).toEqual([]);
  });

  test('pemeriksa menangkap pelanggaran', () => {
    const induk = entry({ id: 'dasar-a' });
    expect(dasarProblems([induk, entry({ id: 'baru-a', kind: 'baru' })])).toHaveLength(1);
    expect(
      dasarProblems([induk, entry({ id: 'baru-a', kind: 'baru', dasar: 'hantu' })]),
    ).toHaveLength(1);
    expect(
      dasarProblems([
        entry({ id: 'tip-a', kind: 'tip' }),
        entry({ id: 'baru-a', kind: 'baru', dasar: 'tip-a' }),
      ]),
    ).toHaveLength(1);
    expect(dasarProblems([induk, entry({ id: 'baru-a', kind: 'baru', dasar: 'dasar-a' })])).toEqual(
      [],
    );
  });
});
