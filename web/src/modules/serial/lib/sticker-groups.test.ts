import type { SerialSummaryDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  groupSerialsByItemBu,
  STICKER_GROUPS_MAX,
  STICKER_ROWS_MAX,
  stickerGroupsBlocker,
} from './sticker-groups';

const row = (over: Partial<SerialSummaryDto>): SerialSummaryDto =>
  ({
    id: 's1',
    buId: 'b1',
    buCode: 'BU1',
    serial: 'A1',
    itemId: 'i1',
    itemLabel: 'Item 1',
    ...over,
  }) as SerialSummaryDto;

test('serial dikelompokkan menurut (Item, BU) dengan urutan kemunculan pertama', () => {
  const groups = groupSerialsByItemBu([
    row({ id: 's1', serial: 'A1' }),
    row({ id: 's2', serial: 'B2', itemId: 'i2', itemLabel: 'Item 2' }),
    row({ id: 's3', serial: 'C3' }),
    // Item sama, BU lain: kelompok sendiri.
    row({ id: 's4', serial: 'D4', buId: 'b2', buCode: 'BU2' }),
  ]);
  expect(groups.map((group) => [group.itemId, group.buId, group.ids, group.serials])).toEqual([
    ['i1', 'b1', ['s1', 's3'], ['A1', 'C3']],
    ['i2', 'b1', ['s2'], ['B2']],
    ['i1', 'b2', ['s4'], ['D4']],
  ]);
  expect(groups[0]?.itemLabel).toBe('Item 1');
  expect(groups[2]?.buCode).toBe('BU2');
});

test('pilihan kosong tidak membentuk kelompok', () => {
  expect(groupSerialsByItemBu([])).toEqual([]);
});

test('batas kelompok: sepuluh boleh, sebelas ditolak dengan alasan', () => {
  expect(STICKER_GROUPS_MAX).toBe(10);
  expect(STICKER_ROWS_MAX).toBe(100);
  expect(stickerGroupsBlocker(10)).toBeUndefined();
  expect(stickerGroupsBlocker(11)).toMatch(/paling banyak 10 kombinasi Item dan BU/);
});
