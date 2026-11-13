import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '../lib/types';

const state = vi.hoisted(() => ({
  ready: true,
  done: new Map<string, number>(),
  offers: [] as { entry: GuideEntry; stepCount: number }[],
  tourActive: false,
  blocking: false,
  start: vi.fn(),
  mark: vi.fn(),
}));
vi.mock('../lib/use-guide-store', () => ({
  useGuideStore: () => ({
    ready: state.ready,
    done: state.done,
    mark: state.mark,
    reset: vi.fn(),
  }),
}));
vi.mock('../lib/use-offered-guides', () => ({
  useOfferedGuides: () => ({ ready: state.ready, offers: state.ready ? state.offers : [] }),
}));
vi.mock('./tour/tour-provider', () => ({
  useTour: () => ({ start: state.start, active: state.tourActive }),
}));
vi.mock('@/modules/push/components/push-onboarding', () => ({
  useBlockingOnboardingActive: () => state.blocking,
}));

import { GuideGreeting } from './guide-greeting';

const layout: GuideEntry = {
  id: 'dasar-layout',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal tampilan',
  steps: [],
};
const baru: GuideEntry = { ...layout, id: 'baru-x', kind: 'baru', title: 'Fitur baru' };
const pwa: GuideEntry = {
  ...layout,
  id: 'perangkat-pwa',
  status: 'diturunkan',
  title: 'Pasang aplikasi',
};

beforeEach(() => {
  state.ready = true;
  state.done = new Map();
  state.offers = [{ entry: layout, stepCount: 5 }];
  state.tourActive = false;
  state.blocking = false;
  state.start.mockReset();
  state.mark.mockReset();
  state.mark.mockResolvedValue(undefined);
});

describe('GuideGreeting', () => {
  test('menampilkan dialog "Mau tur singkat?" bila sapaan belum ditanyakan', async () => {
    render(<GuideGreeting />);
    expect(await screen.findByRole('dialog', { name: 'Mau tur singkat?' })).toBeInTheDocument();
  });

  test('Mulai: menjalankan panduan dasar pertama yang ditawarkan dan menulis penanda sapaan', async () => {
    state.offers = [
      { entry: pwa, stepCount: 1 },
      { entry: baru, stepCount: 2 },
      { entry: layout, stepCount: 5 },
    ];
    render(<GuideGreeting />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mulai' }));
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.start).toHaveBeenCalledWith(layout);
    expect(state.mark).toHaveBeenCalledWith('sapaan-awal', 1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Nanti: menulis penanda sapaan-awal tanpa memulai tur', async () => {
    render(<GuideGreeting />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nanti' }));
    expect(state.mark).toHaveBeenCalledWith('sapaan-awal', 1);
    expect(state.start).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('tidak tampil bila sapaan sudah tercatat', () => {
    state.done = new Map([['sapaan-awal', 1]]);
    render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('tidak tampil bila belum ready (akun individu belum termuat atau gagal)', () => {
    state.ready = false;
    render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('tidak tampil saat tur sedang berjalan', () => {
    state.tourActive = true;
    render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('tidak tampil saat dialog atau banner PushOnboarding sedang tampil', () => {
    state.blocking = true;
    render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('tidak tampil bila tak ada panduan dasar yang bisa ditawarkan', () => {
    state.offers = [
      { entry: baru, stepCount: 1 },
      { entry: pwa, stepCount: 1 },
    ];
    render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('muncul begitu penghalang hilang', async () => {
    state.blocking = true;
    const view = render(<GuideGreeting />);
    expect(screen.queryByRole('dialog')).toBeNull();
    state.blocking = false;
    view.rerender(<GuideGreeting />);
    expect(await screen.findByRole('dialog', { name: 'Mau tur singkat?' })).toBeInTheDocument();
  });
});
