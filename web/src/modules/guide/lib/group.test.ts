import { describe, expect, test } from 'vitest';
import { groupGuides, UNGROUPED_NAME } from './group';
import type { GuideEntry } from './types';

function offer(id: string, grup?: string) {
  const entry: GuideEntry = {
    id,
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: id,
    steps: [],
    ...(grup === undefined ? {} : { grup }),
  };
  return { entry };
}

describe('groupGuides', () => {
  test('mengelompokkan menurut grup, urut kemunculan pertama, urutan di dalam kelompok tetap', () => {
    const groups = groupGuides([
      offer('a1', 'A'),
      offer('b1', 'B'),
      offer('a2', 'A'),
      offer('c1', 'C'),
      offer('b2', 'B'),
    ]);
    expect(groups.map((g) => [g.name, g.items.map((i) => i.entry.id)])).toEqual([
      ['A', ['a1', 'a2']],
      ['B', ['b1', 'b2']],
      ['C', ['c1']],
    ]);
  });

  test('panduan tanpa grup masuk "Lainnya" di akhir', () => {
    const groups = groupGuides([offer('x'), offer('a1', 'A'), offer('y', '')]);
    expect(groups.map((g) => g.name)).toEqual(['A', UNGROUPED_NAME]);
    expect(groups[1]?.items.map((i) => i.entry.id)).toEqual(['x', 'y']);
  });

  test('daftar kosong = tanpa kelompok', () => {
    expect(groupGuides([])).toEqual([]);
  });
});
