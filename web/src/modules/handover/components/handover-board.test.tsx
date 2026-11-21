import type { HandoverStatus } from '@shared/handover';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { badgeColorOf } from '../lib/status';
import type { CardBindings } from './handover-board';
import { HandoverBoard } from './handover-board';
import { makeHandover } from './test-handover';

const bindings = (): CardBindings => ({
  canMarkDone: true,
  canEdit: true,
  canCancel: true,
  pending: false,
  onOpen: vi.fn(),
  onCheck: vi.fn(),
  onMarkDone: vi.fn(),
  onReopen: vi.fn(),
  onEdit: vi.fn(),
  onCancel: vi.fn(),
  onComment: vi.fn(),
});

function Board({ handovers = tasks }: { handovers?: typeof tasks }) {
  const [filter, setFilter] = useState<HandoverStatus | 'all'>('all');
  return (
    <HandoverBoard
      handovers={handovers}
      filter={filter}
      onFilterChange={setFilter}
      bindings={bindings}
    />
  );
}

const tasks = [
  makeHandover({ id: '1', number: 'ST-1', status: 'new', createdAt: '2026-10-01T00:00:00.000Z' }),
  makeHandover({
    id: '2',
    number: 'ST-2',
    status: 'in_progress',
    createdAt: '2026-10-02T00:00:00.000Z',
  }),
  makeHandover({ id: '3', number: 'ST-3', status: 'done', createdAt: '2026-10-03T00:00:00.000Z' }),
  makeHandover({
    id: '4',
    number: 'ST-4',
    status: 'cancelled',
    createdAt: '2026-10-04T00:00:00.000Z',
  }),
];

function mockMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: memulihkan stub jsdom
  delete (window as any).matchMedia;
});

test('layar lebar memakai empat kolom; layar sempit memakai daftar kartu dengan filter', async () => {
  mockMedia(true);
  const { unmount } = render(<Board />);
  for (const name of ['Baru', 'Dikerjakan', 'Selesai', 'Dibatalkan']) {
    expect(screen.getByRole('group', { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: 'Semua' })).not.toBeInTheDocument();
  unmount();

  mockMedia(false);
  render(<Board />);
  expect(
    screen.queryByRole('group', { name: /^(Baru|Dikerjakan|Selesai|Dibatalkan)$/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('article')).toHaveLength(4);
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('ST-3')).toBeInTheDocument();
});

test('task Dibatalkan dan Selesai ikut tampil di kolomnya', () => {
  mockMedia(true);
  render(<Board />);
  expect(
    within(screen.getByRole('group', { name: 'Selesai' })).getByText('ST-3'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'Dibatalkan' })).getByText('ST-4'),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(4);
});

test('kolom kosong menampilkan petunjuk; semua task tetap tampil tanpa batas', () => {
  mockMedia(true);
  const many = Array.from({ length: 60 }, (_, i) =>
    makeHandover({
      id: `n${i}`,
      number: `ST-N${i}`,
      createdAt: `2026-10-01T00:${String(i).padStart(2, '0')}:00.000Z`,
    }),
  );
  render(<Board handovers={many} />);
  expect(screen.getAllByRole('article')).toHaveLength(60);
  expect(
    within(screen.getByRole('group', { name: 'Selesai' })).getByText('Tidak ada task.'),
  ).toBeInTheDocument();
});

test('data satu task rusak tidak menghilangkan kartu lain', () => {
  mockMedia(true);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const broken = {
    ...makeHandover({ id: 'x', number: 'ST-RUSAK' }),
    checklist: undefined,
    note: null,
  };
  render(<Board handovers={[...tasks, broken as unknown as (typeof tasks)[number]]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('ST-RUSAK');
  expect(screen.getAllByRole('article')).toHaveLength(4);
  errors.mockRestore();
});

test('kanban kit: setinggi viewport, judul kolom tetap, hanya daftar kartu tiap kolom yang bergulir', () => {
  mockMedia(true);
  render(<Board />);
  expect(screen.getByLabelText('Papan Serah Terima')).toHaveAttribute('data-height', 'viewport');
  const column = screen.getByRole('group', { name: 'Baru' });
  expect(column.className).toContain('flex-col');
  expect(column.className).toContain('min-w-[290px]');
  const scroller = column.querySelector('[data-slot="column-cards"]');
  expect(scroller?.className).toContain('overflow-y-auto');
});

test('kolom kanban memakai warna badge statusnya (badgeColorOf) dan hitungan kolom tampil', () => {
  mockMedia(true);
  render(<Board />);
  const expected = {
    Baru: 'secondary',
    Dikerjakan: 'info',
    Selesai: 'success',
    Dibatalkan: 'destructive',
  } as const;
  for (const [name, color] of Object.entries(expected)) {
    const column = screen.getByRole('group', { name });
    const badge = column.querySelector('[data-slot="badge"]');
    expect(badge?.getAttribute('data-color')).toBe(color);
    // Badge status pada kartu memakai warna yang sama dengan kolomnya.
    const cardBadge = column.querySelector('[data-slot="mobile-card"] [data-slot="badge"]');
    expect(cardBadge?.getAttribute('data-color')).toBe(color);
  }
  expect(badgeColorOf('new')).toBe('secondary');
});

test('filter ponsel dikendalikan dari luar (bertahan lewat props)', () => {
  mockMedia(false);
  render(
    <HandoverBoard handovers={tasks} filter="done" onFilterChange={vi.fn()} bindings={bindings} />,
  );
  expect(screen.getByRole('button', { name: 'Selesai' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

const pending = [
  { key: 'e1:a', customerName: 'PT Offline', note: 'catatan', status: 'waiting' as const },
];

function PendingBoard({ handovers = tasks }: { handovers?: typeof tasks }) {
  const [filter, setFilter] = useState<HandoverStatus | 'all'>('all');
  return (
    <HandoverBoard
      handovers={handovers}
      filter={filter}
      onFilterChange={setFilter}
      bindings={bindings}
      pendingCreates={pending}
    />
  );
}

test('kanban: kartu sementara task baru tampil di kolom Baru saja', () => {
  mockMedia(true);
  render(<PendingBoard />);
  const baru = screen.getByRole('group', { name: 'Baru' });
  expect(within(baru).getByText('PT Offline')).toBeInTheDocument();
  expect(within(baru).getByText('—')).toBeInTheDocument();
  for (const name of ['Dikerjakan', 'Selesai', 'Dibatalkan']) {
    const column = screen.getByRole('group', { name });
    expect(within(column).queryByText('PT Offline')).not.toBeInTheDocument();
  }
});

test('kanban: kolom Baru kosong tidak menampilkan "Tidak ada task" bila ada kartu sementara', () => {
  mockMedia(true);
  render(<PendingBoard handovers={[]} />);
  const baru = screen.getByRole('group', { name: 'Baru' });
  expect(within(baru).getByText('PT Offline')).toBeInTheDocument();
  expect(within(baru).queryByText('Tidak ada task.')).not.toBeInTheDocument();
});

test('ponsel: kartu sementara tampil pada filter Semua dan Baru, tidak pada filter lain', async () => {
  mockMedia(false);
  render(<PendingBoard />);
  expect(screen.getByText('PT Offline')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Baru' }));
  expect(screen.getByText('PT Offline')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(screen.queryByText('PT Offline')).not.toBeInTheDocument();
});
