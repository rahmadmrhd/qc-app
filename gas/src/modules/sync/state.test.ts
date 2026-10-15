import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { assignInitialRevs_, currentRev_, nextRev_ } from './state';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ now: () => Date.parse('2026-10-15T00:00:00.000Z') });
  setPlatform_(platform);
});

test('nextRev_ menaikkan per sumber daya secara terpisah dan tersimpan di sheet sync_state', () => {
  expect(currentRev_('items')).toBe(0);
  expect([nextRev_('items'), nextRev_('items'), nextRev_('brands')]).toEqual([1, 2, 1]);
  expect(currentRev_('items')).toBe(2);
  expect(currentRev_('brands')).toBe(1);
  expect(platform.db.sheet('sync_state').rows).toEqual([
    ['resource', 'seq', 'updated_at'],
    ['items', '2', '2026-10-15T00:00:00.000Z'],
    ['brands', '1', '2026-10-15T00:00:00.000Z'],
  ]);
});

test('assignInitialRevs_ memberi revisi hanya pada baris ber-sync_rev 0, urut createdAt, dan idempoten', () => {
  insertBrand_(brand('B', { createdAt: '2026-01-02T00:00:00.000Z' }));
  insertBrand_(brand('A', { createdAt: '2026-01-01T00:00:00.000Z' }));
  insertBrand_(brand('Sudah', { syncRev: 9 }));
  insertItem_(item({ id: 'i2', brand: 'A', model: 'Y', createdAt: '2026-02-02T00:00:00.000Z' }));
  insertItem_(item({ id: 'i1', brand: 'A', model: 'X', createdAt: '2026-02-01T00:00:00.000Z' }));
  expect(assignInitialRevs_()).toBe(4);
  const brands = listBrands_();
  expect(brands.find((b) => b.name === 'A')?.syncRev).toBe(1);
  expect(brands.find((b) => b.name === 'B')?.syncRev).toBe(2);
  expect(brands.find((b) => b.name === 'Sudah')?.syncRev).toBe(9);
  const items = listItems_();
  expect(items.find((i) => i.id === 'i1')?.syncRev).toBe(1);
  expect(items.find((i) => i.id === 'i2')?.syncRev).toBe(2);
  expect(assignInitialRevs_()).toBe(0);
});
