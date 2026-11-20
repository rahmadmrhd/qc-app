import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const outbox = vi.hoisted(() => ({ entries: [] as unknown[], sending: 0 }));
vi.mock('@/app/pwa/install', () => ({
  useInstall: () => ({ state: 'unavailable', install: vi.fn() }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () => ({ name: 'Rina', email: 'rina@qc.local', locations: [] }),
}));
vi.mock('@/modules/auth/use-logout', () => ({ useLogout: () => vi.fn() }));
vi.mock('@/modules/handover/lib/use-outbox-summary', () => ({
  useOutboxSummary: () => ({ entries: outbox.entries, sending: outbox.sending }),
}));
vi.mock('./outbox-chip', () => ({ OutboxList: () => <ul data-testid="outbox-list" /> }));
vi.mock('@/modules/theme/theme-provider', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { mockMatchMedia } from '@/test/match-media';
import { UserMenu } from './user-menu';

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  outbox.entries = [];
  outbox.sending = 0;
});
afterEach(() => {
  media.restore();
  window.innerWidth = 1024;
});

test('ponsel: avatar membuka lembar berisi kartu pengguna, tema, Panduan, dan Keluar (tanpa Antrean bila kosong)', async () => {
  render(<UserMenu />);
  expect(document.querySelector('[data-slot="avatar-dot"]')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Akun' }));
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByText('rina@qc.local')).toBeInTheDocument();
  for (const name of ['Terang', 'Gelap', 'Sistem']) {
    expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
  }
  expect(within(sheet).getByRole('button', { name: /Panduan/ })).toBeInTheDocument();
  expect(within(sheet).getByRole('button', { name: /Keluar/ })).toBeInTheDocument();
  expect(sheet.querySelector('[data-slot="account-outbox"]')).toBeNull();
  expect(sheet.querySelector('[data-slot="account-location"]')).toBeNull();
});

test('ponsel: antrean offline memberi titik pada avatar dan baris Antrean di lembar', async () => {
  outbox.entries = [{ id: '1' }, { id: '2' }];
  render(<UserMenu />);
  expect(document.querySelector('[data-slot="avatar-dot"]')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Akun, 2 belum terkirim' }));
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByText('2 belum terkirim')).toBeInTheDocument();
  expect(within(sheet).getByTestId('outbox-list')).toBeInTheDocument();
});
