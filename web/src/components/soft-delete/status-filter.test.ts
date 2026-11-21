import { expect, it } from 'vitest';
import { statusFilterOptions } from './status-filter';

it('tanpa izin Pulihkan: Semua status, Aktif, Nonaktif', () => {
  expect(statusFilterOptions(false)).toEqual([
    { value: 'all', label: 'Semua status' },
    { value: 'active', label: 'Aktif' },
    { value: 'inactive', label: 'Nonaktif' },
  ]);
});

it('dengan izin Pulihkan: ditambah Terhapus', () => {
  const options = statusFilterOptions(true);
  expect(options.map((option) => option.value)).toEqual(['all', 'active', 'inactive', 'deleted']);
  expect(options[3]?.label).toBe('Terhapus');
});
