import type { HandoverStatus } from '@shared/handover';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import type { BoardColumnState } from '../queries';
import type { CardBindings } from './handover-board';
import { HandoverBoard } from './handover-board';
import { HandoverCard } from './handover-card';
import { makeHandover } from './test-handover';

/** IntersectionObserver palsu: tes menentukan kapan elemen "terlihat". */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  show() {
    this.callback(
      this.observed.map(
        (target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}
const live = () => FakeObserver.instances.filter((observer) => !observer.disconnected);

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

const cardProps = {
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
};

test('kartu: catatan dirender lazy; placeholder tinggi tetap sampai mendekati viewport, lalu tetap terpasang', () => {
  render(<HandoverCard handover={makeHandover()} {...cardProps} />);
  // judul/nomor/progres tampil walau isi berat belum
  expect(screen.getByText('ST-20261015-001')).toBeTruthy();
  expect(screen.getByText('0/2')).toBeTruthy();
  const placeholder = document.querySelector('[data-slot="note-placeholder"]') as HTMLElement;
  expect(placeholder).toBeTruthy();
  expect(placeholder.style.height).toBe('72px');
  expect(screen.queryByRole('checkbox')).toBeNull();
  act(() => live()[0]?.show());
  expect(document.querySelector('[data-slot="note-placeholder"]')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  // pengamat dilepas dan isi tidak dibuang lagi
  expect(live()).toHaveLength(0);
});

test('kartu: tinggi placeholder mengikuti jumlah baris catatan (dibatasi)', () => {
  const long = makeHandover({
    note: Array.from({ length: 100 }, (_, i) => `- [ ] x${i}`).join('\n'),
  });
  render(<HandoverCard handover={long} {...cardProps} />);
  expect(
    (document.querySelector('[data-slot="note-placeholder"]') as HTMLElement).style.height,
  ).toBe('480px');
});

test('tanpa IntersectionObserver kartu langsung penuh (perilaku lama)', () => {
  vi.unstubAllGlobals();
  vi.stubGlobal('IntersectionObserver', undefined);
  render(<HandoverCard handover={makeHandover()} {...cardProps} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

const bindings = (): CardBindings => cardProps;

function column(over: Partial<BoardColumnState> = {}): BoardColumnState {
  return { total: 10, loaded: 3, hasMore: true, loadingMore: false, loadMore: vi.fn(), ...over };
}

function Board({ columns }: { columns: Record<HandoverStatus, BoardColumnState> }) {
  return (
    <HandoverBoard
      handovers={[makeHandover({ id: 'a', status: 'new' })]}
      filter="all"
      onFilterChange={() => undefined}
      columns={columns}
      bindings={bindings}
    />
  );
}

const columnsOf = (state: BoardColumnState) => ({
  new: state,
  in_progress: column({ hasMore: false }),
  done: column({ hasMore: false }),
  cancelled: column({ hasMore: false }),
});

test('infinite scroll: sentinel terlihat memuat halaman berikutnya otomatis (tanpa tombol)', () => {
  const state = column();
  render(<Board columns={columnsOf(state)} />);
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
  const sentinel = document.querySelector('[data-slot="load-more-sentinel"]') as HTMLElement;
  expect(sentinel).toBeTruthy();
  const observer = live().find((o) => o.observed.includes(sentinel));
  expect(observer).toBeTruthy();
  // pengamat memakai kolom bergulir sebagai akar dan margin awal
  expect(observer?.options?.root).toBe(document.querySelector('[data-slot="column-cards"]'));
  act(() => observer?.show());
  expect(state.loadMore).toHaveBeenCalledTimes(1);
});

test('kolom diisi sampai penuh layar: sentinel diamati ulang tiap jumlah task termuat berubah', () => {
  const first = column({ loaded: 3 });
  const { rerender } = render(<Board columns={columnsOf(first)} />);
  const before = live().filter((o) => o.observed.length > 0).length;
  const next = column({ loaded: 6 });
  rerender(<Board columns={columnsOf(next)} />);
  const observer = live().at(-1);
  expect(live().length).toBeGreaterThanOrEqual(1);
  expect(before).toBeGreaterThanOrEqual(1);
  // sentinel masih terlihat setelah halaman baru: pengamat baru langsung memuat lagi
  act(() => observer?.show());
  expect(next.loadMore).toHaveBeenCalledTimes(1);
});

test('tidak memuat ganda saat sedang memuat atau tak ada halaman lagi', () => {
  const loading = column({ loadingMore: true });
  render(<Board columns={columnsOf(loading)} />);
  expect(screen.getByRole('status').textContent).toBe('Memuat…');
  for (const observer of live()) act(() => observer.show());
  expect(loading.loadMore).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-slot="load-more-sentinel"]').length).toBe(1);
});

test('tanpa IntersectionObserver: tombol "Muat lebih banyak" tetap tersedia', () => {
  vi.unstubAllGlobals();
  vi.stubGlobal('IntersectionObserver', undefined);
  const state = column();
  render(<Board columns={columnsOf(state)} />);
  expect(screen.getByRole('button', { name: 'Muat lebih banyak' })).toBeTruthy();
});
