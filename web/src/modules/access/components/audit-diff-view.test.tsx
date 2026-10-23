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
const itemBefore = {
  brand: 'Ubiquiti',
  model: 'ES 24',
  isCountryLock: false,
  status: 'active',
  aliases: ['ES24'],
  stickers: ['Label — Belakang'],
  accessories: ['Kabel ×1'],
  attachments: ['f1'],
  detailLength: 10,
  detailHash: 'aaaaaaaa',
};
const itemAfter = {
  ...itemBefore,
  isCountryLock: true,
  aliases: ['ES24', 'AirSwitch'],
  stickers: ['Label — Belakang', 'Garansi'],
  accessories: ['Kabel ×2'],
  attachments: ['f1', 'f2'],
  detailLength: 25,
  detailHash: 'bbbbbbbb',
};

test('snapshot item: label Indonesia, boolean Ya/Tidak, daftar per entri, dan hash detail tidak ditampilkan', () => {
  render(<AuditDiffView before={itemBefore} after={itemAfter} />);
  expect(within(row('isCountryLock')).getByText('Country lock')).toBeInTheDocument();
  expect(within(row('isCountryLock')).getByText('Tidak')).toBeInTheDocument();
  expect(within(row('isCountryLock')).getByText('Ya')).toBeInTheDocument();
  expect(within(row('aliases')).getByText('Nama lain')).toBeInTheDocument();
  expect(within(row('aliases')).getByText('AirSwitch').closest('li')).toHaveAttribute(
    'data-kind',
    'added',
  );
  expect(within(row('stickers')).getByText('Garansi').closest('li')).toHaveAttribute(
    'data-kind',
    'added',
  );
  expect(within(row('accessories')).getByText('Kabel ×2').closest('li')).toHaveAttribute(
    'data-kind',
    'added',
  );
  expect(within(row('accessories')).getByText('Kabel ×1').closest('li')).toHaveAttribute(
    'data-kind',
    'removed',
  );
  expect(within(row('attachments')).getByText('Gambar …f2')).toBeInTheDocument();
  expect(within(row('detailLength')).getByText('Panjang detail (karakter)')).toBeInTheDocument();
  expect(within(row('detailHash')).getByText('Isi detail')).toBeInTheDocument();
  expect(within(row('detailHash')).getByText('Isi Markdown diubah')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('aaaaaaaa');
  expect(document.body.textContent).not.toContain('bbbbbbbb');
});

test('hash detail disembunyikan bila tidak berubah atau pada create', () => {
  const { unmount } = render(
    <AuditDiffView before={itemBefore} after={{ ...itemBefore, model: 'ES 24 Lite' }} />,
  );
  expect(document.querySelector('[data-field="detailHash"]')).toBeNull();
  unmount();
  render(<AuditDiffView before={null} after={itemBefore} />);
  expect(document.querySelector('[data-field="detailHash"]')).toBeNull();
  expect(within(row('brand')).getByText('Merk')).toBeInTheDocument();
});

test('task serah terima: status memakai label Indonesia dan perubahan catatan terbaca', () => {
  render(
    <AuditDiffView
      before={{ number: 'ST-1', customer: 'PT A', status: 'new', note: 'CRS310 = 1 unt' }}
      after={{
        number: 'ST-1',
        customer: 'PT A',
        status: 'in_progress',
        note: 'CRS310 = 1 unt\nRB5009 = 2 unt',
      }}
    />,
  );
  expect(within(row('status')).getByText('Baru')).toBeInTheDocument();
  expect(within(row('status')).getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('Customer')).toBeInTheDocument();
});
