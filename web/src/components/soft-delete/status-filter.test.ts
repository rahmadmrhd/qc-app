import { expect, it } from 'vitest';
import { liveStatusFilterOptions, statusFilterOptions } from './status-filter';

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

it('model tanpa status aktif/nonaktif: Hidup dan Terhapus hanya bagi pemegang izin Pulihkan', () => {
  expect(liveStatusFilterOptions(false)).toEqual([]);
  expect(liveStatusFilterOptions(true)).toEqual([
    { value: 'live', label: 'Hidup' },
    { value: 'deleted', label: 'Terhapus' },
  ]);
});
