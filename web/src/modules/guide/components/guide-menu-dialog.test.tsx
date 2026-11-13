import type { MeDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '../lib/types';

const state = vi.hoisted(() => ({
  done: new Map<string, number>(),
  start: vi.fn(),
  reset: vi.fn(),
  calls: [] as string[],
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: { item: 'view' },
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));
vi.mock('../lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: state.done, mark: vi.fn(), reset: state.reset }),
}));
vi.mock('./tour/tour-provider', () => ({
  useTour: () => ({ start: state.start, active: false }),
}));
const catalogState = vi.hoisted(() => ({ entries: [] as GuideEntry[] }));
vi.mock('../catalog', () => ({
  get GUIDE_CATALOG() {
    return catalogState.entries;
  },
}));

import { GuideMenuDialog } from './guide-menu-dialog';

function entry(overrides: Partial<GuideEntry>): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Mengenal tampilan',
    steps: [{ target: 'x', text: 't', advance: 'next' }],
    ...overrides,
  };
}

beforeEach(() => {
  state.done = new Map();
  state.calls = [];
  state.start.mockReset().mockImplementation(() => state.calls.push('start'));
  state.reset.mockReset().mockImplementation(async () => {
    state.calls.push('reset');
  });
  catalogState.entries = [
    entry({}),
    entry({
      id: 'handover-dasar',
      title: 'Serah Terima',
      izin: { module: 'handover', level: 'view' },
    }),
    entry({ id: 'perangkat-pwa', status: 'diturunkan', title: 'Pasang aplikasi' }),
    entry({ id: 'tip-x', kind: 'tip', title: 'Tip' }),
  ];
});

function row(title: string) {
  const item = screen.getByText(title).closest('li');
  if (!item) throw new Error(`baris ${title} tak ada`);
  return within(item);
}

describe('GuideMenuDialog', () => {
  test('memuat semua panduan yang berhak (termasuk yang selesai), tanpa yang tak berhak dan tip', () => {
    state.done = new Map([['dasar-layout', 1]]);
    render(<GuideMenuDialog onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Panduan' })).toBeInTheDocument();
    expect(screen.getByText('Mengenal tampilan')).toBeInTheDocument();
    expect(screen.getByText('Pasang aplikasi')).toBeInTheDocument();
    expect(screen.queryByText('Serah Terima')).toBeNull();
    expect(screen.queryByText('Tip')).toBeNull();
  });

  test('panduan disimpan yang selesai: "Ulangi" memanggil reset lalu start', async () => {
    state.done = new Map([['dasar-layout', 1]]);
    const onClose = vi.fn();
    render(<GuideMenuDialog onClose={onClose} />);
    await userEvent.click(row('Mengenal tampilan').getByRole('button', { name: 'Ulangi' }));
    await waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
    expect(state.calls).toEqual(['reset', 'start']);
    expect(state.reset).toHaveBeenCalledWith('dasar-layout');
    expect(state.start.mock.calls[0]?.[0].id).toBe('dasar-layout');
    expect(onClose).toHaveBeenCalled();
  });

  test('panduan disimpan yang belum selesai: "Mulai" hanya start tanpa reset', async () => {
    render(<GuideMenuDialog onClose={() => undefined} />);
    await userEvent.click(row('Mengenal tampilan').getByRole('button', { name: 'Mulai' }));
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.reset).not.toHaveBeenCalled();
  });

  test('versi tersimpan lebih rendah dari katalog dianggap belum selesai (Mulai)', () => {
    state.done = new Map([['dasar-layout', 1]]);
    catalogState.entries = [entry({ version: 2 })];
    render(<GuideMenuDialog onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Mulai' })).toBeInTheDocument();
  });

  test('panduan diturunkan selalu "Lihat lagi" yang hanya start tanpa reset', async () => {
    render(<GuideMenuDialog onClose={() => undefined} />);
    await userEvent.click(row('Pasang aplikasi').getByRole('button', { name: 'Lihat lagi' }));
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.reset).not.toHaveBeenCalled();
  });

  test('gagal reset tidak memulai tur', async () => {
    state.done = new Map([['dasar-layout', 1]]);
    state.reset.mockRejectedValue(new Error('offline'));
    render(<GuideMenuDialog onClose={() => undefined} />);
    await userEvent.click(row('Mengenal tampilan').getByRole('button', { name: 'Ulangi' }));
    await waitFor(() => expect(state.reset).toHaveBeenCalled());
    expect(state.start).not.toHaveBeenCalled();
  });

  test('menampilkan keterangan bila tak ada panduan', () => {
    catalogState.entries = [];
    render(<GuideMenuDialog onClose={() => undefined} />);
    expect(screen.getByText(/Belum ada panduan/)).toBeInTheDocument();
  });
});
