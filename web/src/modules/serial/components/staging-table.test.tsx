import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { StagingTable } from './staging-table';

// Regresi (laporan uji PWA ponsel 2026-11-13): teks `sr-only` (position: absolute) di kolom
// paling kanan tabel lebar TIDAK ikut terpotong wadah gulir bila wadahnya bukan blok
// penampung (`position: relative`); ia menambah lebar gulir halaman sehingga peramban
// ponsel memperkecil seluruh halaman begitu draft berisi baris.
test('wadah gulir tabel draft menampung elemen absolut (relative + overflow-x-auto)', () => {
  const noop = vi.fn();
  const { container } = render(
    <StagingTable
      rows={[]}
      onSelect={noop}
      onSelectAll={noop}
      onEdit={noop}
      onCommitSerial={() => null}
      onOpenDetail={noop}
      onRemove={noop}
    />,
  );
  const wrapper = container.querySelector('table')?.parentElement;
  expect(wrapper?.className).toContain('overflow-x-auto');
  expect(wrapper?.className).toContain('relative');
});
