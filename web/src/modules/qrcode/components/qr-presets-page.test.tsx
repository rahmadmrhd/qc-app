import type { BusinessUnitOptionDto, QrPresetDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { QrPresetsPage, type QrPresetsPageProps } from './qr-presets-page';

const preset = (over: Partial<QrPresetDto> = {}): QrPresetDto => ({
  id: 'p1',
  name: 'Standar Spectrum',
  title: 'Judul',
  subtitle: '',
  footer: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu1',
  namePlacement: 'subtitle',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
  ...over,
});

const BUS: BusinessUnitOptionDto[] = [
  { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' },
  { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' },
];

const handlers = () => ({
  onEdit: vi.fn(),
  onClone: vi.fn(),
  onDelete: vi.fn(),
  onRestore: vi.fn(),
});

async function renderTable(presets: QrPresetDto[], props: Partial<QrPresetsPageProps> = {}) {
  const fns = handlers();
  const view = await renderInRouter(
    <QrPresetsPage presets={presets} businessUnits={BUS} {...fns} {...props} />,
  );
  return { ...fns, ...view };
}

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

test('nama dan BU berupa tautan; tidak ada tombol "Lihat"', async () => {
  await renderTable([preset()]);
  expect(screen.getByRole('link', { name: 'Standar Spectrum' })).toHaveAttribute(
    'href',
    '/qrcode/default/p1',
  );
  expect(screen.getByRole('link', { name: 'Spectrum' })).toHaveAttribute(
    'href',
    '/access/business-units/bu1',
  );
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('tanpa hak buka BU, nama BU tampil sebagai teks biasa; preset tanpa BU "Belum diatur"', async () => {
  await renderTable([preset(), preset({ id: 'p2', name: 'Lama', buId: '' })], {
    canOpenBusinessUnit: false,
  });
  expect(screen.queryByRole('link', { name: 'Spectrum' })).toBeNull();
  expect(screen.getByText('Spectrum')).toBeInTheDocument();
  expect(screen.getByText('Belum diatur')).toBeInTheDocument();
});

test('aksi baris: Ubah, Kloning, Hapus memanggil handler dengan presetnya', async () => {
  const data = preset();
  const { onEdit, onClone, onDelete } = await renderTable([data]);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Standar Spectrum' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kloning Standar Spectrum' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Standar Spectrum' }));
  expect(onEdit).toHaveBeenCalledWith(data);
  expect(onClone).toHaveBeenCalledWith(data);
  expect(onDelete).toHaveBeenCalledWith(data);
});

test('penempatan nama dan tanggal diperbarui tampil; kosong diberi tanda "—"', async () => {
  await renderTable([preset(), preset({ id: 'p2', name: 'Tanpa', namePlacement: '' })]);
  const rows = screen.getAllByRole('row');
  expect(rows[1]).toHaveTextContent('subtitle');
  expect(rows[2]).toHaveTextContent('—');
});

test('tampilan Terhapus: hanya Pulihkan, kolom Dihapus oleh/pada', async () => {
  const deleted = preset({
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  });
  const { onRestore } = await renderTable([deleted], { deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(Ubah|Kloning|Hapus)/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Standar Spectrum' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('kosong: pesan tabel', async () => {
  await renderTable([]);
  expect(screen.getByText('Belum ada konfigurasi default.')).toBeInTheDocument();
});

test('ponsel (360 px): kartu dengan nama sebagai judul; aksi lewat satu tombol menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onClone } = await renderTable([preset()]);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('link', { name: 'Standar Spectrum' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Kloning Standar Spectrum' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Aksi/ }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name: /Kloning Standar Spectrum/ }));
  expect(onClone).toHaveBeenCalledTimes(1);
});
