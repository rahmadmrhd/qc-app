import type { ClBundleDetailDto, ClBundleDto, ClDraftDto, MeDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { makeMe } from '@/test/make-me';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { BundleView } from './bundle-view';
import { BundlesPage } from './bundles-page';

function bundle(number: number, overrides: Partial<ClBundleDto> = {}): ClBundleDto {
  return {
    number,
    computerHash: 'c'.repeat(64),
    routerHash: 'd'.repeat(64),
    minApp: '0.0.0',
    note: `Catatan ${number}`,
    publishedBy: 'admin@x.com',
    createdAt: '2026-11-28T01:00:00.000Z',
    sourceNumber: null,
    fileCount: 5,
    ...overrides,
  };
}

const DRAFT: ClDraftDto = {
  files: [],
  firmwares: [],
  issues: [],
  computerHash: 'c'.repeat(64),
  routerHash: 'd'.repeat(64),
  changed: true,
};

let list: ClBundleDto[];

beforeEach(() => {
  installIntersectionObserver();
  me = makeMe({ permissions: { countrylock: 'manage' } });
  list = [bundle(2, { sourceNumber: 1 }), bundle(1)];
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: { number?: string; note?: string }) => {
    if (id === 'clBundles.list') return list;
    if (id === 'clBundles.draft') return DRAFT;
    if (id === 'clBundles.get') {
      const found = list.find((item) => String(item.number) === input.number);
      return {
        ...found,
        files: [{ path: 'settings.json', role: 'settings', sha256: 'e'.repeat(64), size: 900 }],
        firmwares: [
          { brand: 'mikrotik', code: 'AC', label: 'AC', scriptPath: 'M/ac.txt', parallel: false },
        ],
      } as ClBundleDetailDto;
    }
    if (id === 'clBundles.reactivate') return bundle(3, { sourceNumber: Number(input.number) });
    throw new Error(`api tak terduga: ${id}`);
  });
});

describe('BundlesPage', () => {
  test('daftar bundel menampilkan nomor, catatan, dan asal pengaktifan ulang; terbaru ditandai Aktif', async () => {
    await renderInRouter(<BundlesPage />);
    expect(await screen.findByText('Catatan 2')).toBeTruthy();
    expect(screen.getByText('Catatan 1')).toBeTruthy();
    expect(screen.getByText(/Diaktifkan ulang dari #1/)).toBeTruthy();
    expect(screen.getAllByText('Aktif')).toHaveLength(1);
  });

  test('pemegang manage melihat Terbitkan dan dialognya terbuka', async () => {
    await renderInRouter(<BundlesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Terbitkan' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  test('pemegang edit TIDAK melihat Terbitkan', async () => {
    me = makeMe({ permissions: { countrylock: 'edit' } });
    await renderInRouter(<BundlesPage />);
    await screen.findByText('Catatan 2');
    expect(screen.queryByRole('button', { name: 'Terbitkan' })).toBeNull();
  });

  test('menandai draf yang berbeda dari bundel terbit terakhir', async () => {
    await renderInRouter(<BundlesPage />);
    expect(await screen.findByText(/Draf punya perubahan yang belum diterbitkan/)).toBeTruthy();
  });
});

describe('BundleView', () => {
  const view = (number: number) => renderInRouter(<BundleView number={number} onBack={vi.fn()} />);

  test('bundel lama: pemegang manage dapat Jadikan versi aktif dengan catatan wajib', async () => {
    await view(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Jadikan versi aktif' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Jadikan versi aktif',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(dialog).getByLabelText(/Catatan/), 'Kembali ke yang stabil');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clBundles.reactivate', {
        number: '1',
        note: 'Kembali ke yang stabil',
      }),
    );
  });

  test('bundel terbaru (aktif): tanpa Jadikan versi aktif', async () => {
    await view(2);
    await screen.findByText('Catatan 2');
    expect(screen.queryByRole('button', { name: 'Jadikan versi aktif' })).toBeNull();
  });

  test('pemegang edit TIDAK melihat Jadikan versi aktif', async () => {
    me = makeMe({ permissions: { countrylock: 'edit' } });
    await view(1);
    await screen.findByText('Catatan 1');
    expect(screen.queryByRole('button', { name: 'Jadikan versi aktif' })).toBeNull();
  });

  test('menampilkan berkas dan firmware dalam bundel', async () => {
    await view(1);
    expect(await screen.findByText('settings.json')).toBeTruthy();
    expect(screen.getByText('M/ac.txt')).toBeTruthy();
  });
});
