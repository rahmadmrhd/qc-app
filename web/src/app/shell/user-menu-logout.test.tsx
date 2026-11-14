import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const logoutMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/pwa/install', () => ({
  useInstall: () => ({ state: 'unavailable', install: vi.fn() }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () => ({ name: 'Rina', email: 'rina@qc.local' }),
}));
vi.mock('@/modules/auth/use-logout', () => ({ useLogout: () => logoutMock }));
vi.mock('@/modules/push/components/push-settings-dialog', () => ({
  PushSettingsDialog: () => null,
}));

import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import { readOutbox, removeOutboxEntries } from '@/modules/handover/lib/outbox';
import { resetOutboxEnv } from '@/test/outbox-env';
import { UserMenu } from './user-menu';

const queue = (owner: string, index: number) =>
  enqueueCheck(owner, {
    taskId: 'h1',
    locationId: 'loc-a',
    index,
    text: `Butir ${index}`,
    checked: true,
    at: Date.now(),
  });

async function clickKeluar() {
  await userEvent.click(screen.getByRole('button', { name: /Rina/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Keluar' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOutboxEnv();
});

test('tanpa entri: klik Keluar langsung memanggil logout tanpa dialog', async () => {
  render(<UserMenu />);
  await clickKeluar();
  expect(logoutMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Keluar sekarang?')).not.toBeInTheDocument();
});

test('dengan entri: klik Keluar menampilkan dialog dan belum memanggil logout', async () => {
  await queue('rina@qc.local', 0);
  render(<UserMenu />);
  await clickKeluar();
  expect(await screen.findByText('Keluar sekarang?')).toBeInTheDocument();
  expect(screen.getByText(/1 perubahan belum terkirim/)).toBeInTheDocument();
  expect(logoutMock).not.toHaveBeenCalled();
});

test('Batal menutup dialog, logout tidak dipanggil, antrean utuh', async () => {
  await queue('rina@qc.local', 0);
  await queue('rina@qc.local', 1);
  const before = readOutbox('rina@qc.local');
  render(<UserMenu />);
  await clickKeluar();
  await userEvent.click(await screen.findByRole('button', { name: 'Batal' }));
  expect(screen.queryByText('Keluar sekarang?')).not.toBeInTheDocument();
  expect(logoutMock).not.toHaveBeenCalled();
  expect(readOutbox('rina@qc.local')).toEqual(before);
});

test('Tetap keluar memanggil logout satu kali', async () => {
  await queue('rina@qc.local', 0);
  render(<UserMenu />);
  await clickKeluar();
  await userEvent.click(await screen.findByRole('button', { name: 'Tetap keluar' }));
  expect(logoutMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Keluar sekarang?')).not.toBeInTheDocument();
});

test('entri milik pemilik lain ikut terhitung', async () => {
  await queue('rina@qc.local', 0);
  await queue('lain@qc.local', 0);
  await queue('lain@qc.local', 1);
  render(<UserMenu />);
  await clickKeluar();
  expect(await screen.findByText(/3 perubahan belum terkirim/)).toBeInTheDocument();
});

test('antrean dikosongkan saat dialog terbuka: teks berubah menjadi aman untuk keluar', async () => {
  await queue('rina@qc.local', 0);
  render(<UserMenu />);
  await clickKeluar();
  expect(await screen.findByText(/1 perubahan belum terkirim/)).toBeInTheDocument();
  await act(async () => {
    await removeOutboxEntries(
      'rina@qc.local',
      readOutbox('rina@qc.local').map((e) => e.id),
    );
  });
  expect(
    await screen.findByText('Semua perubahan sudah terkirim. Aman untuk keluar.'),
  ).toBeInTheDocument();
  expect(logoutMock).not.toHaveBeenCalled();
});

test('entri baru saat dialog terbuka: angka naik', async () => {
  await queue('rina@qc.local', 0);
  render(<UserMenu />);
  await clickKeluar();
  expect(await screen.findByText(/1 perubahan belum terkirim/)).toBeInTheDocument();
  await act(async () => {
    await queue('rina@qc.local', 1);
  });
  expect(await screen.findByText(/2 perubahan belum terkirim/)).toBeInTheDocument();
});
