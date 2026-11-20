import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ItemCreateHost } from '@/modules/item/components/item-create-host';
import { PostelItemPicker } from './postel-item-picker';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

// Dialog item diganti stub: yang diuji di sini hanya penyambungan baris "Tambah Item" dan item baru yang terpilih.
vi.mock('@/modules/item/components/item-form-dialog', () => ({
  ItemFormDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (item: { id: string; brand: string; model: string }) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onCreated({ id: 'new', brand: 'Baru', model: 'X1' })}>
        Simpan item stub
      </button>
    ) : null,
}));

const OPTIONS = {
  items: [
    { id: 'i1', brand: 'PBE', model: 'M5-400', postelNumber: '' },
    { id: 'i2', brand: 'PBE', model: 'M5-200', postelNumber: 'AB-1' },
    { id: 'i3', brand: 'PBE', model: 'M5-300', postelNumber: 'CD-2' },
  ],
  nextCursor: null,
};

function renderPicker(over: Partial<Parameters<typeof PostelItemPicker>[0]> = {}) {
  const props = { selected: [], onChange: vi.fn(), ...over };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ItemCreateHost>
        <form data-testid="outer-form">
          <PostelItemPicker {...props} />
        </form>
      </ItemCreateHost>
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue(OPTIONS);
});

test('opsi berasal dari postels.itemOptions dan memilih memanggil onChange', async () => {
  const props = renderPicker();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: /PBE M5-400/ }));
  expect(apiMock).toHaveBeenCalledWith('postels.itemOptions', { limit: 20 });
  expect(props.onChange).toHaveBeenCalledWith([{ id: 'i1', brand: 'PBE', model: 'M5-400' }]);
});

test('item milik Postel lain nonaktif dengan deskripsi nomor Aktif', async () => {
  renderPicker();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  const taken = await screen.findByRole('option', { name: /PBE M5-200/ });
  expect(taken).toHaveAttribute('aria-disabled', 'true');
  expect(taken).toHaveTextContent('Sudah tergabung ke Postel "AB-1"');
  expect(await screen.findByRole('option', { name: /PBE M5-400/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('item milik catatan ini sendiri (ownedIds) tetap dapat dipilih', async () => {
  renderPicker({ ownedIds: new Set(['i2']) });
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  expect(await screen.findByRole('option', { name: /PBE M5-200/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(await screen.findByRole('option', { name: /PBE M5-300/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('item terpilih tampil sebagai chip; jumlah item tersembunyi tampil', () => {
  renderPicker({
    selected: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
    hiddenCount: 3,
  });
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  expect(
    screen.getByText(
      '3 item lain tergabung di sini tetapi tidak terlihat oleh Anda; tetap terpasang.',
    ),
  ).toBeInTheDocument();
});

test('tanpa item tersembunyi paragraf itu tidak ada; galat ditampilkan', () => {
  renderPicker({ error: 'Pilih minimal satu item' });
  expect(screen.queryByText(/tidak terlihat oleh Anda/)).not.toBeInTheDocument();
  expect(screen.getByText('Pilih minimal satu item')).toBeInTheDocument();
});

test('mengetik memanggil postels.itemOptions dengan query setelah 200 ms; chip terpilih bertahan', async () => {
  apiMock.mockImplementation((_id: string, input: { query?: string }) =>
    Promise.resolve(
      input.query === 'zz'
        ? {
            items: [{ id: 'i7', brand: 'ACME', model: 'ZZ-1', postelNumber: '' }],
            nextCursor: null,
          }
        : OPTIONS,
    ),
  );
  renderPicker({ selected: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }] });
  await userEvent.type(screen.getByRole('combobox', { name: 'Item' }), 'zz');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('postels.itemOptions', { query: 'zz', limit: 20 }),
  );
  expect(await screen.findByRole('option', { name: /ACME ZZ-1/ })).toBeInTheDocument();
  // chip item terpilih tetap tampil walau tak ada di hasil pencarian
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
});

test('baris "Tambah Item" hanya bila canCreateItem; item baru dari dialog langsung terpilih', async () => {
  const first = renderPicker();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await screen.findByRole('option', { name: /PBE M5-400/ });
  expect(screen.queryByRole('option', { name: 'Tambah Item' })).toBeNull();
  cleanup();
  const props = renderPicker({
    canCreateItem: true,
    selected: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Item' }));
  const stub = await screen.findByRole('button', { name: 'Simpan item stub' });
  // Aturan proyek: dialog Tambah dirender di luar pohon <form> induk (bukan hanya di luar DOM-nya).
  expect(stub.closest('form')).toBeNull();
  await userEvent.click(stub);
  expect(props.onChange).toHaveBeenCalledWith([
    { id: 'i1', brand: 'PBE', model: 'M5-400' },
    { id: 'new', brand: 'Baru', model: 'X1' },
  ]);
  expect(first.onChange).not.toHaveBeenCalled();
});

test('item terpilih yang terhapus tampil bertanda Terhapus dan tetap terbawa saat pilihan lain berubah', async () => {
  const props = renderPicker({
    selected: [{ id: 'gone', brand: 'PBE', model: 'Lawas', deleted: true }],
  });
  expect(screen.getByRole('button', { name: 'Hapus PBE Lawas — Terhapus' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: /PBE M5-400/ }));
  expect(props.onChange).toHaveBeenCalledWith([
    { id: 'gone', brand: 'PBE', model: 'Lawas', deleted: true },
    { id: 'i1', brand: 'PBE', model: 'M5-400' },
  ]);
});
