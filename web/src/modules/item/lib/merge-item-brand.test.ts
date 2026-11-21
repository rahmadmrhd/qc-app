import type { BrandDto, ItemDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { mergeItemBrand } from './use-item-form-controller';

const live: BrandDto = {
  id: 'b1',
  name: 'Sony',
  status: 'active',
  itemCount: 1,
  updatedAt: '',
  businessUnitIds: [],
};
const item = { brandId: 'b9', brand: 'Lama', brandDeleted: true } as ItemDto;

test('merk milik item yang tak ada di daftar hidup ditambahkan dengan penanda terhapus', () => {
  const merged = mergeItemBrand([live], item);
  expect(merged).toHaveLength(2);
  expect(merged[1]).toMatchObject({ id: 'b9', name: 'Lama', status: 'inactive' });
  expect(merged[1]?.deleted).toBeDefined();
});

test('merk yang sudah ada, atau tanpa item, tidak diubah', () => {
  const list = [live];
  expect(mergeItemBrand(list, { ...item, brandId: 'b1' } as ItemDto)).toBe(list);
  expect(mergeItemBrand(list)).toBe(list);
});

test('merk tak ada di daftar tetapi tidak terhapus: tanpa penanda terhapus', () => {
  const merged = mergeItemBrand([live], { ...item, brandDeleted: false } as ItemDto);
  expect(merged[1]?.deleted).toBeUndefined();
});
