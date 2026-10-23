import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

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
  onToggleDone: vi.fn(),
  onEdit: vi.fn(),
  onCancel: vi.fn(),
});

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
  const { unmount } = render(<HandoverBoard handovers={tasks} bindings={bindings} />);
  for (const name of ['Baru', 'Dikerjakan', 'Selesai', 'Dibatalkan']) {
    expect(screen.getByRole('region', { name: `Kolom ${name}` })).toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: 'Semua' })).not.toBeInTheDocument();
  unmount();

  mockMedia(false);
  render(<HandoverBoard handovers={tasks} bindings={bindings} />);
  expect(screen.queryByRole('region', { name: /^Kolom/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('article')).toHaveLength(4);
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('ST-3')).toBeInTheDocument();
});

test('task Dibatalkan dan Selesai ikut tampil di kolomnya', () => {
  mockMedia(true);
  render(<HandoverBoard handovers={tasks} bindings={bindings} />);
  expect(
    within(screen.getByRole('region', { name: 'Kolom Selesai' })).getByText('ST-3'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: 'Kolom Dibatalkan' })).getByText('ST-4'),
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
  render(<HandoverBoard handovers={many} bindings={bindings} />);
  expect(screen.getAllByRole('article')).toHaveLength(60);
  expect(
    within(screen.getByRole('region', { name: 'Kolom Selesai' })).getByText('Tidak ada task.'),
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
  render(
    <HandoverBoard
      handovers={[...tasks, broken as unknown as (typeof tasks)[number]]}
      bindings={bindings}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('ST-RUSAK');
  expect(screen.getAllByRole('article')).toHaveLength(4);
  errors.mockRestore();
});
