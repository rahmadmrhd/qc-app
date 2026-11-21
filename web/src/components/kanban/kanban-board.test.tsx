import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ServerStatusBanner } from '@/app/shell/server-status-banner';
import { HeadroomFrame } from '@/components/page/headroom-bar';
import { KanbanBoard, type KanbanColumn } from './kanban-board';

vi.mock('@/app/server-status', () => ({
  useServerStatus: () => ({ unavailableSince: 1_700_000_000_000 }),
  formatClock: () => '10.00',
}));

interface Card {
  id: string;
  title: string;
}

function columns(overrides: Partial<KanbanColumn<Card>>[] = []): KanbanColumn<Card>[] {
  return [
    {
      key: 'new',
      label: 'Baru',
      color: 'secondary',
      items: [{ id: '1', title: 'Kartu satu' }],
      ...overrides[0],
    },
    { key: 'done', label: 'Selesai', color: 'success', items: [], ...overrides[1] },
  ];
}

function renderBoard(cols: KanbanColumn<Card>[], height?: 'auto' | 'viewport', emptyText?: string) {
  return render(
    <KanbanBoard
      label="Papan"
      columns={cols}
      height={height}
      itemKey={(card) => card.id}
      renderCard={(card) => <span>{card.title}</span>}
      emptyText={emptyText}
    />,
  );
}

test('dua kolom group bernama, jumlah di kepala, lebar minimum, badge berwarna', () => {
  renderBoard(columns([{ total: 7 }]));
  const board = screen.getByRole('region', { name: 'Papan' });
  const baru = within(board).getByRole('group', { name: 'Baru' });
  const selesai = within(board).getByRole('group', { name: 'Selesai' });
  expect(baru.className).toContain('min-w-[290px]');
  expect(within(baru).getByText('7')).toBeInTheDocument();
  expect(within(selesai).getByText('0')).toBeInTheDocument();
  expect(within(baru).getByText('Baru')).toHaveAttribute('data-color', 'secondary');
  expect(within(selesai).getByText('Selesai')).toHaveAttribute('data-color', 'success');
  expect(within(baru).getByText('Kartu satu').parentElement?.className).toContain(
    'border-l-secondary-text',
  );
});

test('kolom kosong menampilkan emptyText (bawaan "Kosong")', () => {
  const { unmount } = renderBoard(columns());
  expect(within(screen.getByRole('group', { name: 'Selesai' })).getByText('Kosong')).toBeVisible();
  unmount();
  renderBoard(columns(), 'auto', 'Tidak ada task');
  expect(screen.getAllByText('Tidak ada task')).toHaveLength(1);
});

test('mode auto: tombol muat lebih banyak per kolom memanggil onLoadMore kolom itu', async () => {
  const first = vi.fn();
  const second = vi.fn();
  renderBoard(
    columns([
      { hasMore: true, onLoadMore: first },
      { hasMore: true, onLoadMore: second },
    ]),
  );
  const baru = screen.getByRole('group', { name: 'Baru' });
  await userEvent.click(within(baru).getByRole('button', { name: 'Muat lebih banyak' }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
});

test('mode viewport: tinggi dvh, tiap kolom menggulir sendiri, muat lebih banyak per kolom', async () => {
  const onLoadMore = vi.fn();
  renderBoard(columns([{ hasMore: true, onLoadMore }]), 'viewport');
  const board = screen.getByRole('region', { name: 'Papan' });
  expect(board.style.height).toContain('dvh');
  const baru = within(board).getByRole('group', { name: 'Baru' });
  expect(baru.querySelector('[data-slot="column-cards"]')?.className).toContain('overflow-y-auto');
  // jsdom tanpa IntersectionObserver: tombol cadangan.
  await userEvent.click(within(baru).getByRole('button', { name: 'Muat lebih banyak' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test('mode viewport menghitung tinggi spanduk aplikasi yang tampil', async () => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function mocked(this: Element) {
    const height = this.hasAttribute('data-app-banner') ? 40 : 0;
    return { ...original.call(this), height } as DOMRect;
  };
  try {
    render(
      <>
        <ServerStatusBanner />
        <KanbanBoard
          label="Papan"
          height="viewport"
          columns={columns()}
          itemKey={(card) => card.id}
          renderCard={(card) => <span>{card.title}</span>}
        />
      </>,
    );
    await act(async () => {});
    expect(screen.getByTestId('server-status-banner')).toHaveAttribute('data-app-banner');
    expect(screen.getByRole('region', { name: 'Papan' }).style.height).toContain('40px');
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
});

test('mode viewport mengurangi padding main (--main-pad) dan celah bar-isi dari tinggi', () => {
  renderBoard(columns(), 'viewport');
  const height = screen.getByRole('region', { name: 'Papan' }).style.height;
  expect(height).toContain('var(--main-pad');
  expect(height).toContain('2 *');
  expect(height).toContain('12px');
});

test('spanduk yang ditambah belakangan ikut dihitung dan yang dibuang tak lagi dihitung', async () => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function mocked(this: Element) {
    const height = this.hasAttribute('data-app-banner') ? 25 : 0;
    return { ...original.call(this), height } as DOMRect;
  };
  try {
    renderBoard(columns(), 'viewport');
    const board = screen.getByRole('region', { name: 'Papan' });
    expect(board.style.height).toContain('0px');
    const banner = document.createElement('div');
    banner.setAttribute('data-app-banner', '');
    document.body.appendChild(banner);
    await vi.waitFor(() => expect(board.style.height).toContain('25px'));
    banner.remove();
    await vi.waitFor(() => expect(board.style.height).toContain('0px'));
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
});

test('konten di antara bar dan papan (mis. Alert) ikut dikurangi dari tinggi papan', async () => {
  const rect = Element.prototype.getBoundingClientRect;
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Element.prototype.getBoundingClientRect = function mocked(this: Element) {
    let top = 0;
    if (this.getAttribute('aria-label') === 'Papan') top = 112; // 60 bar + 12 celah + 40 konten
    return { ...rect.call(this), top, height: 0 } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.barMock === '' ? 60 : 0;
    },
  });
  try {
    render(
      <HeadroomFrame>
        <div data-bar-mock="">bar</div>
        <p>keterangan di atas papan</p>
        <KanbanBoard
          label="Papan"
          height="viewport"
          columns={columns()}
          itemKey={(card) => card.id}
          renderCard={(card) => <span>{card.title}</span>}
        />
      </HeadroomFrame>,
    );
    await act(async () => {});
    expect(screen.getByRole('region', { name: 'Papan' }).style.height).toContain('- 40px -');
  } finally {
    Element.prototype.getBoundingClientRect = rect;
    if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offset);
  }
});
