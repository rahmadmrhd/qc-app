import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AuditDiffView } from './audit-diff-view';

function row(field: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (!found) throw new Error(`field ${field} tidak dirender`);
  return found;
}

test('field yang berubah menampilkan nilai lama dan baru dengan penanda teks', () => {
  render(
    <AuditDiffView
      before={{ name: 'Budi', status: 'active' }}
      after={{ name: 'Budi S', status: 'active' }}
    />,
  );
  const name = row('name');
  expect(name).toHaveAttribute('data-kind', 'changed');
  expect(within(name).getByText('Nama')).toBeInTheDocument();
  expect(within(name).getByText('Diubah')).toBeInTheDocument();
  expect(within(name).getByText('Budi').tagName).toBe('DEL');
  expect(within(name).getByText('Budi S').tagName).toBe('INS');
  const status = row('status');
  expect(status).toHaveAttribute('data-kind', 'unchanged');
  expect(within(status).getByText('Aktif')).toBeInTheDocument();
  expect(within(status).queryByText('Diubah')).not.toBeInTheDocument();
});

test('create menandai semua field ditambah, delete menandai semua dihapus', () => {
  const { unmount } = render(<AuditDiffView before={null} after={{ name: 'Ani' }} />);
  expect(row('name')).toHaveAttribute('data-kind', 'added');
  expect(within(row('name')).getByText('Ditambah')).toBeInTheDocument();
  unmount();
  render(<AuditDiffView before={{ name: 'Ani' }} after={null} />);
  expect(row('name')).toHaveAttribute('data-kind', 'removed');
  expect(within(row('name')).getByText('Dihapus')).toBeInTheDocument();
  expect(within(row('name')).getByText('Ani').tagName).toBe('DEL');
});

test('roleIds ditampilkan dengan nama bila diketahui, id bila tidak', () => {
  render(
    <AuditDiffView
      before={{ roleIds: ['r-qc', 'r-hilang'] }}
      after={{ roleIds: ['r-qc', 'r-wh'] }}
      roleNames={new Map([['r-qc', 'QC Staff']])}
    />,
  );
  const items = row('roleIds').querySelectorAll('li[data-kind]');
  expect(
    [...items].map((item) => [
      item.querySelector('[data-slot="label"]')?.textContent,
      item.getAttribute('data-kind'),
    ]),
  ).toEqual([
    ['QC Staff', 'unchanged'],
    ['r-wh', 'added'],
    ['r-hilang', 'removed'],
  ]);
});

test('permissions memakai nama modul dan level yang mudah dibaca', () => {
  render(
    <AuditDiffView
      before={{ permissions: { item: 'edit' } }}
      after={{ permissions: { item: 'manage', stock: 'view' } }}
    />,
  );
  const permissions = row('permissions');
  expect(within(permissions).getByText('Akses per modul')).toBeInTheDocument();
  const item = within(permissions).getByText('Data Item', { exact: false }).closest('li');
  expect(item).toHaveAttribute('data-kind', 'changed');
  expect(within(item as HTMLElement).getByText('Ubah').tagName).toBe('DEL');
  expect(within(item as HTMLElement).getByText('Kelola').tagName).toBe('INS');
  const stock = within(permissions).getByText('Monitoring Stok', { exact: false }).closest('li');
  expect(stock).toHaveAttribute('data-kind', 'added');
  expect(screen.getByText('Lihat')).toBeInTheDocument();
});

test('menampilkan legenda warna', () => {
  render(<AuditDiffView before={null} after={{ name: 'A' }} />);
  expect(screen.getByRole('list', { name: 'Keterangan warna' })).toBeInTheDocument();
});

test('penugasan ditampilkan per lokasi dengan nama lokasi dan role yang ditambah atau dihapus', () => {
  render(
    <AuditDiffView
      before={{ assignments: { '*': ['r1'], 'l-a': ['r1'] } }}
      after={{ assignments: { '*': ['r1', 'r2'], 'l-b': ['r1'] } }}
      roleNames={
        new Map([
          ['r1', 'Manajer'],
          ['r2', 'Pemantau'],
        ])
      }
      locationNames={
        new Map([
          ['l-a', 'Jakarta'],
          ['l-b', 'Bandung'],
        ])
      }
    />,
  );
  const field = row('assignments');
  expect(within(field).getByText('Penugasan')).toBeInTheDocument();
  const items = [...field.querySelectorAll(':scope > ul > li[data-kind]')].map((item) => [
    item.querySelector('[data-slot="label"]')?.textContent,
    item.getAttribute('data-kind'),
  ]);
  expect(items).toEqual([
    ['Semua lokasi', 'changed'],
    ['Bandung', 'added'],
    ['Jakarta', 'removed'],
  ]);
  const everywhere = field.querySelector('li[data-kind="changed"]') as HTMLElement;
  const roles = [...everywhere.querySelectorAll('li[data-kind]')].map((item) => [
    item.textContent,
    item.getAttribute('data-kind'),
  ]);
  expect(roles).toEqual([
    ['Manajer', 'unchanged'],
    ['Pemantau', 'added'],
  ]);
});

test('field lokasi memakai label yang mudah dibaca', () => {
  render(
    <AuditDiffView before={null} after={{ code: 'JKT', name: 'Jakarta', status: 'active' }} />,
  );
  expect(within(row('code')).getByText('Kode')).toBeInTheDocument();
  expect(within(row('status')).getByText('Aktif')).toBeInTheDocument();
});
