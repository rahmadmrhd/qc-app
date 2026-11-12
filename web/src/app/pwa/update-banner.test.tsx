import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';
import { type RegisterSW, resetPwaUpdateForTests, startPwaUpdates } from './update';
import { PwaUpdateBanner } from './update-banner';

// Memulai pemeriksaan pembaruan dengan register palsu; mengembalikan pemicu "versi baru siap" dan updateSW.
function startFake() {
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  let needRefresh: (() => void) | undefined;
  const register: RegisterSW = (options) => {
    needRefresh = options.onNeedRefresh;
    return updateSW;
  };
  startPwaUpdates({
    register,
    win: {
      navigator: { serviceWorker: {} },
      document: { addEventListener: () => undefined, removeEventListener: () => undefined },
      setInterval: () => 0,
      clearInterval: () => undefined,
    } as unknown as Window,
  });
  return { updateSW, announce: () => act(() => needRefresh?.()) };
}

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

beforeEach(() => {
  resetPwaUpdateForTests();
  resetUnsavedChangesForTests();
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
