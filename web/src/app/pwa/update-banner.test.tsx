import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';
import {
  notifyChunkLoadFailure,
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
} from './update';
import { PwaUpdateBanner } from './update-banner';

type Listener = (event?: unknown) => void;

// Memulai pemeriksaan pembaruan dengan register dan jendela palsu. `announce` meniru pustaka yang memanggil
// onNeedRefresh untuk SW yang menunggu; `registration.waiting` dapat diganti untuk meniru deploy berikutnya.
function startFake() {
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  const reload = vi.fn();
  const listeners = new Map<string, Set<Listener>>();
  const add = (type: string, listener: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)?.add(listener);
  };
  const remove = (type: string, listener: Listener) => listeners.get(type)?.delete(listener);
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = {
    update,
    waiting: { name: 'sw1' },
  } as unknown as ServiceWorkerRegistration & {
    waiting: unknown;
  };
  let options: Parameters<RegisterSW>[0] = {};
  const register: RegisterSW = (given) => {
    options = given;
    return updateSW;
  };
  startPwaUpdates({
    register,
    win: {
      navigator: { serviceWorker: { addEventListener: add, removeEventListener: remove } },
      document: { addEventListener: add, removeEventListener: remove },
      addEventListener: add,
      removeEventListener: remove,
      location: { reload },
      setInterval: () => 0,
      clearInterval: () => undefined,
    } as unknown as Window,
  });
  options.onRegisteredSW?.('/sw.js', registration);
  return {
    updateSW,
    reload,
    registration,
    announce: () => act(() => options.onNeedRefresh?.()),
    fire: (type: string, event?: unknown) =>
      act(async () => {
        for (const listener of listeners.get(type) ?? []) listener(event);
      }),
  };
}

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetPwaUpdateForTests();
  resetUnsavedChangesForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

test('tanpa pembaruan tidak merender apa pun', () => {
  startFake();
  const { container } = render(<PwaUpdateBanner />);
  expect(container).toBeEmptyDOMElement();
});

test('versi baru: menampilkan teks dan tombol Muat ulang', () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  expect(screen.getByText('Ada versi baru')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeInTheDocument();
  expect(screen.queryByText(/belum disimpan/i)).not.toBeInTheDocument();
});

test('ada formulir belum disimpan: spanduk memperingatkan perubahan akan hilang', () => {
  const fake = startFake();
  render(
    <>
      <Dirty />
      <PwaUpdateBanner />
    </>,
  );
  fake.announce();
  expect(screen.getByText(/formulir yang belum disimpan/i)).toBeInTheDocument();
  expect(screen.getByText(/hilang bila dimuat ulang/i)).toBeInTheDocument();
});

test('tombol Muat ulang memanggil updateSW(true) tepat sekali; tidak pernah otomatis', async () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  expect(fake.updateSW).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(fake.updateSW).toHaveBeenCalledTimes(1);
  expect(fake.updateSW).toHaveBeenCalledWith(true);
});

test('tata letak tetap di bawah dan muat di layar sempit', () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  const banner = screen.getByTestId('pwa-update-banner');
  expect(banner.className).toMatch(/\bfixed\b/);
  expect(banner.className).toMatch(/\bbottom-\d/);
  expect(banner.className).toMatch(/\binset-x-\d/);
  expect(banner.className).toMatch(/\bmax-w-/);
});

test('Nanti menyembunyikan spanduk tanpa memuat ulang; SW yang sama tetap tersembunyi, SW baru dari pemeriksaan menampilkannya lagi', async () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  expect(fake.updateSW).not.toHaveBeenCalled();
  expect(fake.reload).not.toHaveBeenCalled();
  // Pemeriksaan berikutnya menemukan SW menunggu yang sama: tetap tersembunyi.
  await fake.fire('focus');
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  // Deploy berikutnya: SW menunggu baru. Pustaka (workbox-window) tidak lagi memanggil onNeedRefresh pada
  // pembaruan eksternal kedua, jadi pemicunya adalah perbandingan registration.waiting setelah update().
  Object.assign(fake.registration, { waiting: { name: 'sw2' } });
  vi.advanceTimersByTime(5_000);
  await fake.fire('focus');
  expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument();
});

test('Nanti lalu galat muat potongan (pemicu baru) menampilkan spanduk lagi', async () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  act(() => notifyChunkLoadFailure());
  expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument();
});

test('dengan formulir kotor, peringatan tampil sebelum spanduk ditutup dengan Nanti', async () => {
  const fake = startFake();
  render(
    <>
      <Dirty />
      <PwaUpdateBanner />
    </>,
  );
  fake.announce();
  expect(screen.getByText(/hilang bila dimuat ulang/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nanti' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
});
