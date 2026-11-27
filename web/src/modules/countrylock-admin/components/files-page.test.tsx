import type { ClFileDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { FilesPage } from './files-page';

function file(id: string, path: string, overrides: Partial<ClFileDto> = {}): ClFileDto {
  return {
    id,
    path,
    role: 'script',
    kind: 'text',
    headRev: 2,
    size: 2048,
    sha256: 'a'.repeat(64),
    updatedAt: '2026-11-28T01:00:00.000Z',
    updatedBy: 'admin@x.com',
    removed: false,
    ...overrides,
  };
}

let files: ClFileDto[];
const onSearchChange = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  onSearchChange.mockReset();
  files = [
    file('a', 'MIKROTIK/mikrotik-ac.txt'),
    file('b', 'UBIQUITI/XM.txt'),
    file('c', 'firmware/system.npk', { role: 'router', kind: 'binary', size: 5_000_000 }),
    file('d', 'lama/hapus.txt', { removed: true }),
  ];
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'clFiles.list') return files;
    if (id === 'clFiles.remove') return null;
    if (id === 'clFiles.save') {
      return { ...file('n', String(input.path)), role: input.role, text: '' };
    }
    throw new Error(`api tak terduga: ${id}`);
  });
});

const page = (q = '') => renderInRouter(<FilesPage q={q} onSearchChange={onSearchChange} />);

describe('FilesPage', () => {
  test('settings.json tidak dapat dihapus dari daftar: tombol Hapus tersembunyi dan alasannya tampil', async () => {
    files = [
      file('s', 'settings.json', { role: 'settings' }),
      file('a', 'MIKROTIK/mikrotik-ac.txt'),
    ];
    await page();
    await screen.findByText('settings.json');
    expect(screen.queryByRole('button', { name: 'Hapus settings.json' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hapus MIKROTIK/mikrotik-ac.txt' })).toBeTruthy();
    expect(screen.getByText(/Wajib ada; diubah lewat Pengaturan Router/)).toBeTruthy();
  });

  test('menampilkan berkas hidup beserta peran, versi, dan ukuran; yang terhapus disembunyikan', async () => {
    await page();
    expect(await screen.findByText('MIKROTIK/mikrotik-ac.txt')).toBeTruthy();
    expect(screen.getByText('UBIQUITI/XM.txt')).toBeTruthy();
    expect(screen.getByText('firmware/system.npk')).toBeTruthy();
    expect(screen.queryByText('lama/hapus.txt')).toBeNull();
    expect(screen.getAllByText('Skrip').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Berkas router').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revisi 2').length).toBeGreaterThan(0);
  });

  test('pencarian menyaring nama berkas di klien', async () => {
    await page('xm');
    await screen.findByText('UBIQUITI/XM.txt');
    expect(screen.queryByText('MIKROTIK/mikrotik-ac.txt')).toBeNull();
  });

  test('hapus: konfirmasi dulu, lalu memanggil clFiles.remove', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus UBIQUITI/XM.txt' }));
    expect(apiMock.mock.calls.some((call) => call[0] === 'clFiles.remove')).toBe(false);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('clFiles.remove', { id: 'b' }));
  });

  test('Tambah berkas teks membuat berkas kosong lewat clFiles.save tanpa baseSeq', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah berkas teks' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/Nama berkas/), 'MIKROTIK/baru.txt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clFiles.save', {
        path: 'MIKROTIK/baru.txt',
        role: 'script',
        text: '',
        message: 'Berkas dibuat',
      }),
    );
  });

  test('nama berkas tak sah ditolak di klien tanpa memanggil server', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah berkas teks' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/Nama berkas/), 'a/../b.txt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat' }));
    expect(await within(dialog).findByText(/tidak boleh memuat \. atau \.\./)).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'clFiles.save')).toBe(false);
  });

  test('peran berkas baru dapat diganti ke berkas router teks', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah berkas teks' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/Nama berkas/), 'system.cfg');
    await pickLink(within(dialog), 'Peran', 'Berkas router (teks)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFiles.save',
        expect.objectContaining({ path: 'system.cfg', role: 'router' }),
      ),
    );
  });

  test('daftar kosong menampilkan keterangan', async () => {
    files = [];
    await page();
    expect(await screen.findByText('Belum ada berkas.')).toBeTruthy();
  });
});
