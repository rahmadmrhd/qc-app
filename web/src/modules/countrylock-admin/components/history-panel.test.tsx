import type { ClRevisionDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { HistoryPanel } from './history-panel';

const HASH = 'ab'.repeat(32);
const UPDATED_AT = '2026-11-28T01:00:00.000Z';

function revision(seq: number, overrides: Partial<ClRevisionDto> = {}): ClRevisionDto {
  return {
    seq,
    sha256: HASH,
    size: 1024,
    message: `catatan ${seq}`,
    author: 'admin@x.com',
    createdAt: '2026-11-28T01:00:00.000Z',
    ...overrides,
  };
}

let history: ClRevisionDto[];
let detail: { id: string; headRev: number; updatedAt: string };

beforeEach(() => {
  installIntersectionObserver();
  history = [revision(3), revision(2), revision(1)];
  detail = { id: 'f1', headRev: 3, updatedAt: UPDATED_AT };
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'clFiles.history') return history;
    if (id === 'clFiles.get') return detail;
    if (id === 'clFiles.revert') {
      return { id: 'f1', headRev: 4, text: 'x', updatedAt: '2026-11-28T02:00:00.000Z' };
    }
    throw new Error(`api tak terduga: ${id}`);
  });
});

const panel = (kind: 'text' | 'binary' = 'text') =>
  renderInRouter(<HistoryPanel fileId="f1" kind={kind} language="rsc" canEdit />);
const revertCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'clFiles.revert');

describe('HistoryPanel', () => {
  test('berkas biner: daftar versi menampilkan sha256 PENUH, ukuran, pengunggah, dan waktu', async () => {
    history = [revision(2), revision(1, { sha256: 'cd'.repeat(32) })];
    await panel('binary');
    expect(await screen.findByText(HASH)).toBeTruthy();
    expect(screen.getByText('cd'.repeat(32))).toBeTruthy();
    expect(screen.getAllByText('admin@x.com').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Salin hash revisi 2' })).toBeTruthy();
  });

  test('kembalikan revisi: dialog konfirmasi lebih dulu, tidak ada revisi baru sebelum dikonfirmasi', async () => {
    await panel();
    await userEvent.click(await screen.findByRole('button', { name: 'Kembalikan revisi 1' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/revisi BARU/i)).toBeTruthy();
    expect(revertCalls()).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(revertCalls()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Kembalikan revisi 1' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Kembalikan' }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clFiles.revert', {
        id: 'f1',
        seq: 1,
        baseSeq: 3,
        expectedUpdatedAt: UPDATED_AT,
      }),
    );
  });

  test('server menolak (412, orang lain sudah menyimpan): dialog menjelaskan, riwayat dimuat ulang, tidak menimpa', async () => {
    const { ApiError } = await import('@/lib/api/api-error');
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.history') return history;
      if (id === 'clFiles.get') return detail;
      if (id === 'clFiles.revert') {
        throw new ApiError('CONFLICT', 'Data sudah diubah', '-', undefined, { status: 412 });
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    await panel();
    await userEvent.click(await screen.findByRole('button', { name: 'Kembalikan revisi 1' }));
    const dialog = await screen.findByRole('alertdialog');
    const historyCalls = () =>
      apiMock.mock.calls.filter((call) => call[0] === 'clFiles.history').length;
    const before = historyCalls();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kembalikan' }));
    expect(await within(dialog).findByText(/sudah diubah orang lain/i)).toBeTruthy();
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(before));
    // Mengulang dengan dasar yang basi tak diperbolehkan: tutup lalu buka lagi setelah meninjau riwayat.
    expect(
      (within(dialog).getByRole('button', { name: 'Kembalikan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test('dasar pengembalian dari SATU detail berkas, bukan daftar riwayat yang tak serempak', async () => {
    // Riwayat (basi) masih berpuncak revisi 3, tetapi detail berkas menyatakan revisi 4 dengan updatedAt tertentu.
    detail = { id: 'f1', headRev: 4, updatedAt: '2026-11-28T03:00:00.000Z' };
    await panel();
    await userEvent.click(await screen.findByRole('button', { name: 'Kembalikan revisi 1' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Kembalikan' }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clFiles.revert', {
        id: 'f1',
        seq: 1,
        baseSeq: 4,
        expectedUpdatedAt: '2026-11-28T03:00:00.000Z',
      }),
    );
  });
});
