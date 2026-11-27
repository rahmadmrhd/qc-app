import type { ClBundleDto, ClDraftDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { PublishDialog } from './publish-dialog';

function draft(overrides: Partial<ClDraftDto> = {}): ClDraftDto {
  return {
    files: [],
    firmwares: [],
    issues: [],
    computerHash: 'c'.repeat(64),
    routerHash: 'd'.repeat(64),
    changed: true,
    ...overrides,
  };
}

const PUBLISHED = { number: 4 } as ClBundleDto;
let current: ClDraftDto;
const onOpenChange = vi.fn();
const onPublished = vi.fn();

beforeEach(() => {
  current = draft();
  onOpenChange.mockReset();
  onPublished.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'clBundles.draft') return current;
    if (id === 'clBundles.publish') return PUBLISHED;
    throw new Error(`api tak terduga: ${id}`);
  });
});

const dialog = () =>
  renderInRouter(<PublishDialog open onOpenChange={onOpenChange} onPublished={onPublished} />);
const publishButton = async () =>
  (await screen.findByRole('button', { name: 'Terbitkan' })) as HTMLButtonElement;

describe('PublishDialog', () => {
  test('temuan berat error memblokir tombol Terbitkan dan ditampilkan', async () => {
    current = draft({
      issues: [
        {
          severity: 'error',
          code: 'TEMP_REF_MISSING',
          path: 'MIKROTIK/mikrotik-ac.txt',
          message: 'Rujukan /temp/x.npk tidak ada',
        },
      ],
    });
    await dialog();
    expect(await screen.findByText('Rujukan /temp/x.npk tidak ada')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Catatan/), 'Rilis awal');
    expect((await publishButton()).disabled).toBe(true);
  });

  test('hanya peringatan: tombol aktif setelah catatan diisi, peringatan tetap tampil', async () => {
    current = draft({
      issues: [
        {
          severity: 'warning',
          code: 'ORPHAN_ROUTER_FILE',
          path: 'a.npk',
          message: 'Berkas a.npk tak dirujuk',
        },
      ],
    });
    await dialog();
    expect(await screen.findByText('Berkas a.npk tak dirujuk')).toBeTruthy();
    expect((await publishButton()).disabled).toBe(true); // catatan wajib
    await userEvent.type(screen.getByLabelText(/Catatan/), 'Rilis awal');
    await waitFor(async () => expect((await publishButton()).disabled).toBe(false));
    await userEvent.click(await publishButton());
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clBundles.publish', { note: 'Rilis awal' }),
    );
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(PUBLISHED));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('draf sama dengan bundel terbit terakhir: tidak ada yang diterbitkan', async () => {
    current = draft({ changed: false });
    await dialog();
    expect(await screen.findByText(/Tidak ada perubahan/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Catatan/), 'Coba');
    expect((await publishButton()).disabled).toBe(true);
  });

  test('menampilkan hash kandidat dan ringkasan jumlah berkas', async () => {
    current = draft({
      files: [{ id: 'a', path: 'a', role: 'script' } as ClDraftDto['files'][number]],
    });
    await dialog();
    expect(await screen.findByText(/ccccccccccc/)).toBeTruthy();
    expect(within(screen.getByRole('alertdialog')).getByText(/1 berkas/)).toBeTruthy();
  });

  test('galat server (mis. konflik penerbit serentak) ditampilkan di dialog', async () => {
    const { ApiError } = await import('@/lib/api/api-error');
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clBundles.draft') return current;
      throw new ApiError('CONFLICT', 'Draf berubah saat diterbitkan. Coba lagi.', '-');
    });
    await dialog();
    await userEvent.type(await screen.findByLabelText(/Catatan/), 'x');
    await userEvent.click(await publishButton());
    expect(await screen.findByText('Draf berubah saat diterbitkan. Coba lagi.')).toBeTruthy();
    expect(onPublished).not.toHaveBeenCalled();
  });
});
