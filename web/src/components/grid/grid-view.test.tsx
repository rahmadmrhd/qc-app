import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table/use-row-selection';
import { GridView } from './grid-view';

interface Pic {
  id: string;
  name: string;
}

const PICS: Pic[] = [
  { id: '1', name: 'Satu' },
  { id: '2', name: 'Dua' },
];

const baseProps = {
  itemKey: (pic: Pic) => pic.id,
  renderItem: (pic: Pic) => <span>{pic.name}</span>,
  label: 'Gambar',
};

test('merender renderItem per butir dalam list bernama label', () => {
  render(<GridView {...baseProps} items={PICS} />);
  const list = screen.getByRole('list', { name: 'Gambar' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Satu')).toBeInTheDocument();
});

test('isLoading menampilkan 10 skeleton', () => {
  const { container } = render(<GridView {...baseProps} items={[]} isLoading />);
  expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(10);
});

test('isError menampilkan galat dan Coba lagi memanggil onRetry', async () => {
  const onRetry = vi.fn();
  render(<GridView {...baseProps} items={[]} isError errorText="Gagal ya" onRetry={onRetry} />);
  expect(screen.getByText('Gagal ya')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('kosong menampilkan empty', () => {
  render(<GridView {...baseProps} items={[]} empty="Belum ada gambar" />);
  expect(screen.getByText('Belum ada gambar')).toBeInTheDocument();
});

test('tanpa IntersectionObserver ada tombol Muat lebih banyak', async () => {
  const onLoadMore = vi.fn();
  render(<GridView {...baseProps} items={PICS} hasMore onLoadMore={onLoadMore} />);
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test('galat halaman berikutnya: pesan dan Coba lagi memuat ulang halaman itu', async () => {
  const onLoadMore = vi.fn();
  render(<GridView {...baseProps} items={PICS} hasMore loadMoreError onLoadMore={onLoadMore} />);
  expect(screen.getByText('Gagal memuat halaman berikutnya')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

function WithSelection({ withSelection }: { withSelection: boolean }) {
  const selection = useRowSelection('x');
  return (
    <GridView
      {...baseProps}
      items={PICS}
      selection={withSelection ? selection : undefined}
      selectLabel={(pic) => pic.name}
    />
  );
}

test('dengan selection tiap kartu punya checkbox "Pilih <nama>"; tanpa selection tidak ada', async () => {
  const { unmount } = render(<WithSelection withSelection />);
  const box = screen.getByRole('checkbox', { name: 'Pilih Satu' });
  await userEvent.click(box);
  expect(box).toBeChecked();
  unmount();
  render(<WithSelection withSelection={false} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('pilihan dipangkas ke butir yang masih dimuat', async () => {
  function Prune({ items }: { items: string[] }) {
    const selection = useRowSelection('x');
    return (
      <>
        <GridView
          items={items}
          itemKey={(item) => item}
          renderItem={(item) => <span>{item}</span>}
          label="Daftar"
          selection={selection}
          selectLabel={(item) => item}
        />
        <output>{selection.count}</output>
      </>
    );
  }
  const { rerender } = render(<Prune items={['a', 'b']} />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih a' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih b' }));
  expect(screen.getByRole('status')).toHaveTextContent('2');
  rerender(<Prune items={['a']} />);
  expect(await screen.findByText('1')).toBeInTheDocument();
});

test('isSelectable: kartu yang tak dapat dipilih tanpa checkbox', () => {
  function Mixed() {
    const selection = useRowSelection('x');
    return (
      <GridView
        {...baseProps}
        items={PICS}
        selection={selection}
        selectLabel={(pic) => pic.name}
        isSelectable={(pic) => pic.name !== 'Satu'}
      />
    );
  }
  render(<Mixed />);
  expect(screen.queryByRole('checkbox', { name: 'Pilih Satu' })).toBeNull();
  expect(screen.getAllByRole('checkbox').length).toBe(PICS.length - 1);
});
