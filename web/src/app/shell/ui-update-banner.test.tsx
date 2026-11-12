import type { UiUpdateInfo } from '@countrylock/bridge-contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { UiUpdateBanner } from './ui-update-banner';

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
});

function setBridge(overrides: Parameters<typeof createFakeBridge>[0] = {}) {
  let emit: (info: UiUpdateInfo) => void = () => undefined;
  let unsubscribed = 0;
  const bridge = createFakeBridge({
    ...overrides,
    ui: {
      onUpdateReady: (cb) => {
        emit = cb;
        return () => {
          unsubscribed += 1;
        };
      },
      ...overrides.ui,
    },
  });
  (window as unknown as { qcBridge?: unknown }).qcBridge = bridge;
  return { emit: (info: UiUpdateInfo) => act(() => emit(info)), unsubscribed: () => unsubscribed };
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

test('berhenti berlangganan saat unmount', () => {
  const { unsubscribed } = setBridge();
  const { unmount } = render(<UiUpdateBanner />);
  unmount();
  expect(unsubscribed()).toBe(1);
});
