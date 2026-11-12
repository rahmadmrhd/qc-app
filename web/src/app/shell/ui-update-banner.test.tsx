import type { UiUpdateInfo } from '@countrylock/bridge-contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { resetUiUpdateStore, startUiUpdateWatch } from '@/app/ui-update-store';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { UiUpdateBanner } from './ui-update-banner';

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
  resetUiUpdateStore();
});

function setBridge(overrides: Parameters<typeof createFakeBridge>[0] = {}) {
  let emit: (info: UiUpdateInfo) => void = () => undefined;
  let subscriptions = 0;
  const bridge = createFakeBridge({
    ...overrides,
    ui: {
      onUpdateReady: (cb) => {
        subscriptions += 1;
        emit = cb;
        return () => undefined;
      },
      ...overrides.ui,
    },
  });
  (window as unknown as { qcBridge?: unknown }).qcBridge = bridge;
  return {
    emit: (info: UiUpdateInfo) => act(() => emit(info)),
    subscriptions: () => subscriptions,
  };
}

test('di peramban tidak menampilkan apa pun', () => {
  const { container } = render(<UiUpdateBanner />);
  expect(container).toBeEmptyDOMElement();
});

test('desktop: tersembunyi sampai bundel UI baru siap, lalu menampilkan spanduk dan tombol Muat ulang', async () => {
  const reload = vi.fn(async () => undefined);
  const { emit } = setBridge({ ui: { reload } });
  render(<UiUpdateBanner />);
  expect(screen.queryByText(/versi ui baru tersedia/i)).not.toBeInTheDocument();

  emit({ uiVersion: 'v2' });
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('desktop: muat ulang gagal menampilkan galat dan tombol dapat dicoba lagi', async () => {
  const reload = vi.fn(async () => {
    throw new Error('ipc');
  });
  const { emit } = setBridge({ ui: { reload } });
  render(<UiUpdateBanner />);
  emit({ uiVersion: 'v2' });
  await userEvent.click(await screen.findByRole('button', { name: 'Muat ulang' }));
  expect(await screen.findByText(/muat ulang gagal/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeEnabled();
});

test('N3: pengumuman yang datang sebelum spanduk terpasang tetap tampil saat dipasang', async () => {
  const { emit } = setBridge();
  startUiUpdateWatch(); // seperti main.tsx saat aplikasi start
  emit({ uiVersion: 'v2' }); // halaman /login: spanduk belum ada
  render(<UiUpdateBanner />);
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
});

test('N3: pindah halaman (spanduk di-mount ulang) tidak menghilangkan keadaan siap', async () => {
  const { emit, subscriptions } = setBridge();
  const first = render(<UiUpdateBanner />);
  emit({ uiVersion: 'v2' });
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
  first.unmount();

  render(<UiUpdateBanner />);
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
  // Satu langganan untuk seluruh sesi, bukan satu per mount.
  startUiUpdateWatch();
  expect(subscriptions()).toBe(1);
});

test('N6: jembatan v2 (tanpa bridge.ui) tidak melempar dan tidak menampilkan spanduk', () => {
  const bridge = createFakeBridge({ version: 2 }) as unknown as Record<string, unknown>;
  bridge.ui = undefined;
  (window as unknown as { qcBridge?: unknown }).qcBridge = bridge;
  const { container } = render(<UiUpdateBanner />);
  expect(container).toBeEmptyDOMElement();
});

test('N6: versi 3 tetapi bridge.ui tak lengkap diabaikan', () => {
  const bridge = createFakeBridge() as unknown as Record<string, unknown>;
  bridge.ui = {};
  (window as unknown as { qcBridge?: unknown }).qcBridge = bridge;
  const { container } = render(<UiUpdateBanner />);
  expect(container).toBeEmptyDOMElement();
});
