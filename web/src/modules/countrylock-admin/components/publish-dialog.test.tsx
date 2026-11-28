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

  test('ADDRESS_CHANGED: peringatan mencolok, tombol Terbitkan butuh centang "Saya paham akibatnya"', async () => {
    current = draft({
      issues: [
        {
          severity: 'warning',
          code: 'ADDRESS_CHANGED',
          path: 'settings.json',
          message: 'Alamat router berubah dari 192.168.88.2 ke 10.0.0.2.',
        },
        {
          severity: 'warning',
          code: 'ADDRESS_CHANGED',
          path: 'settings.json',
          message: 'IP komputer berubah dari 192.168.88.3 ke 10.0.0.3.',
        },
      ],
    });
    await dialog();
    expect(
      await screen.findByText('Alamat atau jaringan berubah dari bundel terbit terakhir'),
    ).toBeTruthy();
    expect(screen.getByText(/Alamat router berubah dari 192\.168\.88\.2/)).toBeTruthy();
    expect(screen.getByText(/router yang sudah terpasang masih di alamat lama/i)).toBeTruthy();
    expect(screen.getByText(/komputer operator harus pindah segmen/i)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Catatan/), 'Pindah jaringan');
    expect((await publishButton()).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Saya paham akibatnya' }));
    await waitFor(async () => expect((await publishButton()).disabled).toBe(false));
    await userEvent.click(await publishButton());
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clBundles.publish', { note: 'Pindah jaringan' }),
    );
  });

  test('tanpa ADDRESS_CHANGED tidak ada kotak "Saya paham akibatnya"', async () => {
    await dialog();
    await screen.findByLabelText(/Catatan/);
    expect(screen.queryByRole('checkbox', { name: 'Saya paham akibatnya' })).toBeNull();
  });

  test('DUPLICATE_ROUTER_NAME memblokir seperti error lain dan menjelaskan akibatnya', async () => {
    current = draft({
      issues: [
        {
          severity: 'error',
          code: 'DUPLICATE_ROUTER_NAME',
          path: 'b/system.npk',
          message: 'Berkas router "b/system.npk" bernama dasar sama dengan "a/system.npk"',
        },
      ],
    });
    await dialog();
    expect(await screen.findByText(/bernama dasar sama/)).toBeTruthy();
    expect(screen.getByText(/saling menimpa di \/temp router jump/i)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Catatan/), 'Rilis');
    expect((await publishButton()).disabled).toBe(true);
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
