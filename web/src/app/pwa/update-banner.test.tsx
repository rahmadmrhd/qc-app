import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { beginBusy, resetBusyForTests } from './busy';
import { resetSafeReloadForTests } from './safe-reload';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';
import {
  notifyChunkLoadFailure,
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
} from './update';
import { PwaUpdateBanner } from './update-banner';

type Listener = (event?: unknown) => void;

function fakeWorker() {
  const listeners = new Set<() => void>();
  const worker = {
    state: 'installing',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    worker: worker as unknown as ServiceWorker,
    setState: (next: string) => {
      worker.state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

// Memulai pemeriksaan pembaruan dengan register dan jendela palsu. `announce` meniru pustaka yang memanggil
// onNeedRefresh untuk SW yang menunggu; `registration.waiting` dapat diganti untuk meniru deploy berikutnya.
// busy (bawaan true): ada penulisan berjalan sehingga TIDAK aman dan spanduk tampil saat versi baru siap.
function startFake(opts: { busy?: boolean } = {}) {
  if (opts.busy ?? true) beginBusy();
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  const reload = vi.fn();
  const store = new Map<string, string>();
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
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
      setInterval: () => 0,
      clearInterval: () => undefined,
      setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    } as unknown as Window,
  });
  options.onRegisteredSW?.('/sw.js', registration);
  return {
    updateSW,
    reload,
    update,
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
  resetSafeReloadForTests();
  resetBusyForTests();
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

test('Nanti menyembunyikan spanduk tanpa memuat ulang; SW yang sama tetap tersembunyi, deploy berikutnya (installing lalu installed) menampilkannya lagi', async () => {
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
  // Deploy berikutnya: update() selesai saat SW baru masih installing; waiting baru terisi setelah pra-cache.
  const installing = fakeWorker();
  fake.update.mockImplementationOnce(async () => {
    Object.assign(fake.registration, { installing: installing.worker });
  });
  vi.advanceTimersByTime(5_000);
  await fake.fire('focus');
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  Object.assign(fake.registration, { waiting: { name: 'sw2' }, installing: null });
  act(() => installing.setState('installed'));
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

test('N6: setelah Nanti fokus pindah ke area utama, bukan hilang ke body', async () => {
  const fake = startFake();
  render(
    <>
      <main data-testid="main">isi</main>
      <PwaUpdateBanner />
    </>,
  );
  fake.announce();
  await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  expect(screen.getByTestId('main')).toHaveFocus();
});

test('N6: tanpa elemen main, Nanti tetap berfungsi tanpa galat', async () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
});

test('B4/N1: selama menunggu, Muat ulang menampilkan Memuat… (aria-disabled) dan Nanti diabaikan (aria-disabled)', async () => {
  const fake = startFake();
  render(<PwaUpdateBanner />);
  fake.announce();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  const busy = screen.getByRole('button', { name: 'Memuat…' });
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  expect(busy).not.toBeDisabled();
  await userEvent.click(busy);
  expect(fake.updateSW).toHaveBeenCalledTimes(1);
  const later = screen.getByRole('button', { name: 'Nanti' });
  expect(later).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(later);
  expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument();
  await fake.fire('controllerchange');
  expect(fake.reload).toHaveBeenCalledTimes(1);
});

test('R5: aman (tanpa penulisan, formulir bersih): spanduk TIDAK tampil walau versi baru siap', () => {
  const fake = startFake({ busy: false });
  const { container } = render(<PwaUpdateBanner />);
  fake.announce();
  expect(container).toBeEmptyDOMElement();
});

test('R5: spanduk tampil saat tidak aman dan hilang sendiri begitu aman kembali', () => {
  const end = beginBusy();
  const fake = startFake({ busy: false });
  render(<PwaUpdateBanner />);
  fake.announce();
  expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument();
  act(() => end());
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
});

test('R5: galat muat potongan menampilkan spanduk walau aman', () => {
  const fake = startFake({ busy: false });
  render(<PwaUpdateBanner />);
  fake.announce();
  expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  act(() => notifyChunkLoadFailure());
  expect(screen.getByTestId('pwa-update-banner')).toBeInTheDocument();
});
