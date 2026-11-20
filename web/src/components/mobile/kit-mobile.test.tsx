import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ActionButton } from '@/components/action-button';
import { DataTable } from '@/components/data-table';
import { useBulkAction } from '@/components/data-table/use-bulk-action';
import { useRowSelection } from '@/components/data-table/use-row-selection';
import { GridView } from '@/components/grid/grid-view';
import { Fab } from '@/components/page/fab';
import { FormPage } from '@/components/page/form-page';
import { ListPage } from '@/components/page/list-page';
import { ListState } from '@/components/page/list-state';
import { SCROLL_TOP_THRESHOLD, ScrollToTop } from '@/components/page/scroll-to-top';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { MobileCard } from './mobile-card';

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

/** Semua tes di sini berjalan di mode ponsel 360 px (lebar viewport 360, `matchMedia` sempit). */
let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  localStorage.clear();
  toast.success.mockReset();
});
afterEach(() => {
  media.restore();
  window.innerWidth = 1024;
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

test('MobileCard: judul, subjudul, badge, meta berlabel, aksi kanan, leading; tone dan terpilih', () => {
  render(
    <ul>
      <MobileCard
        title="Asus RT-AX55"
        subtitle="Router"
        badges={[<span key="a">Aktif</span>, null, false]}
        meta={[{ id: 'bu', label: 'BU', value: 'NET' }]}
        leading={<input type="checkbox" aria-label="Pilih" />}
        actions={<button type="button">Aksi</button>}
        footer={<p>catatan</p>}
        selected
        tone="warn"
      />
    </ul>,
  );
  const card = screen.getByRole('listitem');
  expect(within(card).getByText('Asus RT-AX55')).toBeInTheDocument();
  expect(within(card).getByText('Router')).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  expect(within(card).getByText('BU')).toBeInTheDocument();
  expect(within(card).getByText('NET')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Aksi' })).toBeInTheDocument();
  expect(within(card).getByText('catatan')).toBeInTheDocument();
  expect(card).toHaveAttribute('data-state', 'selected');
  expect(card.className).toContain('border-warning-text/35');
  // 360 px: teks panjang membungkus, tidak melebarkan kartu.
  expect(card.querySelector('.break-words')).not.toBeNull();
});

test('ListState: galat awal, kosong karena filter, kosong biasa dengan ajakan aksi, dan daftar', async () => {
  const onRetry = vi.fn();
  const onClear = vi.fn();
  const { rerender } = render(
    <ListState isError onRetry={onRetry} isEmpty>
      <p>daftar</p>
    </ListState>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Gagal memuat data');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(onRetry).toHaveBeenCalled();

  rerender(
    <ListState isEmpty filtered onClearFilters={onClear}>
      <p>daftar</p>
    </ListState>,
  );
  expect(screen.getByText('Tidak ada hasil untuk filter ini.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter' }));
  expect(onClear).toHaveBeenCalled();

  rerender(
    <ListState
      isEmpty
      empty="Belum ada merk."
      emptyAction={<button type="button">Tambah merk</button>}
    >
      <p>daftar</p>
    </ListState>,
  );
  expect(screen.getByText('Belum ada merk.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah merk' })).toBeInTheDocument();

  rerender(
    <ListState isEmpty={false}>
      <p>daftar</p>
    </ListState>,
  );
  expect(screen.getByText('daftar')).toBeInTheDocument();
});

test('DataTable dan GridView memakai ListState: kosong karena filter dengan tombol hapus filter', async () => {
  const onClear = vi.fn();
  render(
    <DataTable
      rows={[]}
      rowKey={(row: { id: string }) => row.id}
      columns={[{ id: 'a', header: 'A', cell: () => null }]}
      label="Daftar"
      filtered
      onClearFilters={onClear}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('GridView: kosong karena filter dan kosong dengan ajakan aksi; tanpa teks kosong tak menampilkan apa pun', () => {
  const props = {
    items: [] as string[],
    itemKey: (item: string) => item,
    renderItem: (item: string) => <div>{item}</div>,
    label: 'Gambar',
  };
  const { rerender, container } = render(<GridView {...props} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<GridView {...props} filtered onClearFilters={() => undefined} />);
  expect(screen.getByRole('button', { name: 'Hapus filter' })).toBeInTheDocument();
  rerender(
    <GridView
      {...props}
      empty="Belum ada gambar"
      emptyAction={<button type="button">Unggah</button>}
    />,
  );
  expect(screen.getByRole('button', { name: 'Unggah' })).toBeInTheDocument();
});

test('Fab: tombol ikon 48 px dengan aria-label label aksi', async () => {
  const onClick = vi.fn();
  render(<Fab label="Tambah merk" onClick={onClick} />);
  const fab = screen.getByRole('button', { name: 'Tambah merk' });
  expect(fab.className).toContain('size-12');
  expect(fab.className).toContain('fixed');
  await userEvent.click(fab);
  expect(onClick).toHaveBeenCalled();
});

test('ScrollToTop: muncul setelah gulir jauh dan menggulir ke atas', async () => {
  const scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  render(<ScrollToTop />);
  expect(screen.queryByRole('button', { name: 'Ke atas' })).toBeNull();
  Object.defineProperty(window, 'scrollY', {
    value: SCROLL_TOP_THRESHOLD + 100,
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ke atas' }));
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
});

test('ListPage ponsel: hitungan hasil di samping judul, FAB Tambah, dan tombol ke atas di atas FAB', () => {
  Object.defineProperty(window, 'scrollY', {
    value: SCROLL_TOP_THRESHOLD + 100,
    configurable: true,
  });
  render(
    <TooltipProvider>
      <ListPage
        title="Merk"
        count="12 merk"
        createAction={{ label: 'Tambah merk', onClick: () => undefined }}
      >
        <p>isi</p>
      </ListPage>
    </TooltipProvider>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('12 merk');
  expect(screen.getByRole('button', { name: 'Tambah merk' }).className).toContain('fixed');
  expect(screen.getByRole('button', { name: 'Ke atas' }).className).toContain('bottom-[calc(5rem');
});

test('idempoten: ActionButton dengan onClick async hanya memicu satu kiriman walau diketuk dua kali', async () => {
  let resolve: () => void = () => undefined;
  const send = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(
    <TooltipProvider>
      <ActionButton action="save" onClick={send} />
    </TooltipProvider>,
  );
  const button = screen.getByRole('button', { name: 'Simpan' });
  // Dua klik pada tick yang sama (sebelum render ulang menonaktifkan tombol).
  fireEvent.click(button);
  fireEvent.click(button);
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Menyimpan/ })).toBeDisabled();
  await act(async () => {
    resolve();
  });
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(send).toHaveBeenCalledTimes(2);
});

test('idempoten: busy dari pemanggil mematikan tombol', async () => {
  const send = vi.fn();
  render(
    <TooltipProvider>
      <ActionButton action="delete" busy onClick={send} />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button'));
  expect(send).not.toHaveBeenCalled();
});

test('idempoten: FormPage submitting mematikan Simpan dan Batal (bar bawah ponsel)', () => {
  render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" onCancel={() => undefined} submitting>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  const bar = screen.getByRole('region', { name: 'Aksi form' });
  expect(within(bar).getByRole('button', { name: 'Batal' })).toBeDisabled();
  expect(within(bar).getByRole('button', { name: /Menyimpan/ })).toBeDisabled();
});

test('idempoten: useBulkAction hanya satu proses per waktu', async () => {
  let resolve: (value: string[]) => void = () => undefined;
  const send = vi.fn(
    () =>
      new Promise<string[]>((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(() => {
    const selection = useRowSelection('x');
    return { selection, bulk: useBulkAction({ selection, send, verb: 'dihapus' }) };
  });
  act(() => result.current.selection.toggle('1'));
  await act(async () => {
    void result.current.bulk.run();
    void result.current.bulk.run();
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(['1']);
  });
});

test('toast hasil aksi massal memuat Urungkan bila ada jalan kembali dan menjalankannya satu kali', async () => {
  const undo = vi.fn(async () => undefined);
  const { result } = renderHook(() => {
    const selection = useRowSelection('x');
    return {
      selection,
      bulk: useBulkAction({
        selection,
        send: async (ids) => ids,
        verb: 'dinonaktifkan',
        subject: 'merk',
        undo: { run: undo },
      }),
    };
  });
  act(() => result.current.selection.toggle('1'));
  await act(async () => {
    await result.current.bulk.run();
  });
  expect(toast.success).toHaveBeenCalledTimes(1);
  const [message, options] = toast.success.mock.calls[0] as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
  expect(message).toBe('1 merk dinonaktifkan');
  expect(options.action.label).toBe('Urungkan');
  options.action.onClick();
  options.action.onClick();
  expect(undo).toHaveBeenCalledTimes(1);
  expect(undo).toHaveBeenCalledWith(['1']);
});
