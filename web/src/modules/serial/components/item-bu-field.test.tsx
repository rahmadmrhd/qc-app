import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { defaultBuForItem, EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';

const BU1 = { id: 'b1', code: 'BU1' };
const BU2 = { id: 'b2', code: 'BU2' };
const BU9 = { id: 'b9', code: 'BU9' };

/** i1 = satu BU tulis; i2 = dua BU tulis; i3 = BU yang bukan hak tulis pengguna; i4 = satu BU tulis dan satu bukan. */
const ITEMS = [
  { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [BU1] },
  { id: 'i2', label: 'Dua BU', buIds: ['b1', 'b2'], buOptions: [BU1, BU2] },
  { id: 'i3', label: 'BU asing', buIds: ['b9'], buOptions: [BU9] },
  { id: 'i4', label: 'Campuran', buIds: ['b1', 'b9'], buOptions: [BU1, BU9] },
];

let buList: () => Promise<unknown>;

beforeEach(() => {
  apiMock.mockReset();
  buList = () =>
    Promise.resolve({
      businessUnits: [
        { id: 'b1', code: 'BU1', name: 'Business Unit 1' },
        { id: 'b2', code: 'BU2', name: 'Business Unit 2' },
        { id: 'b3', code: 'BU3', name: 'Business Unit 3' },
      ],
    });
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.itemOptions') return Promise.resolve({ items: ITEMS, nextCursor: null });
    if (id === 'serials.buOptions') return buList();
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

let latest: ItemBuValue = EMPTY_ITEM_BU;

function Harness({ initial = EMPTY_ITEM_BU }: { initial?: ItemBuValue }) {
  const [value, setValue] = useState(initial);
  latest = value;
  return (
    <ItemBuField
      idPrefix="t"
      label="Item"
      buFieldLabel="Business Unit"
      value={value}
      onChange={setValue}
    />
  );
}

function renderField(initial?: ItemBuValue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...(initial ? { initial } : {})} />
    </QueryClientProvider>,
  );
}

const buField = () => screen.getByRole('combobox', { name: 'Business Unit' });

test('field BU selalu tampil, juga sebelum item dipilih, dengan semua BU tulis', async () => {
  renderField();
  expect(buField()).toBeEnabled();
  expect(buField()).toHaveValue('');
  expect(await linkOptionNames(screen, 'Business Unit')).toEqual(['BU1', 'BU2', 'BU3']);
  expect(screen.queryByText(/^Business Unit:/)).not.toBeInTheDocument();
});

test('item dengan tepat satu BU tulis: BU terisi otomatis dan tetap dapat diganti ke BU mana pun', async () => {
  renderField();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await waitFor(() => expect(buField()).toHaveValue('BU1'));
  // Tidak lagi terbatas pada BU item: BU3 bukan BU item tetapi boleh dipilih.
  await pickLink(screen, 'Business Unit', 'BU3');
  expect(buField()).toHaveValue('BU3');
  expect(latest).toMatchObject({ itemId: 'i1', buId: 'b3', buLabel: 'BU3' });
});

test('item dengan beberapa BU tulis: BU kosong sampai dipilih; pilihan sebelumnya dipertahankan bila salah satu BU item', async () => {
  const view = renderField();
  await pickLink(screen, 'Item', 'Dua BU');
  expect(buField()).toHaveValue('');
  expect(latest.buId).toBe('');
  view.unmount();

  // BU dipilih lebih dulu (BU2), lalu item dua-BU dipilih: BU2 dipertahankan.
  renderField({ ...EMPTY_ITEM_BU, buId: 'b2', buLabel: 'BU2' });
  await pickLink(screen, 'Item', 'Dua BU');
  expect(buField()).toHaveValue('BU2');
});

test('item beberapa BU dan BU sebelumnya bukan salah satunya: dikosongkan sampai dipilih', async () => {
  renderField({ ...EMPTY_ITEM_BU, buId: 'b3', buLabel: 'BU3' });
  await pickLink(screen, 'Item', 'Dua BU');
  expect(buField()).toHaveValue('');
});

test('hanya BU item yang termasuk daftar BU tulis yang menjadi bawaan; item tanpa BU yang dikenal tidak menyentuh BU', async () => {
  const view = renderField();
  // Tunggu daftar BU tulis termuat dulu agar penyaringan BU item berlaku.
  await linkOptionNames(screen, 'Business Unit');
  await userEvent.keyboard('{Escape}');
  await pickLink(screen, 'Item', 'Campuran');
  // BU9 bukan BU tulis: tinggal BU1, jadi terisi otomatis.
  await waitFor(() => expect(buField()).toHaveValue('BU1'));
  view.unmount();

  renderField({ ...EMPTY_ITEM_BU, buId: 'b2', buLabel: 'BU2' });
  await linkOptionNames(screen, 'Business Unit');
  await userEvent.keyboard('{Escape}');
  await pickLink(screen, 'Item', 'BU asing');
  expect(buField()).toHaveValue('BU2');
});

test('mengosongkan item tidak mengosongkan BU; mengosongkan BU tidak mengosongkan item', async () => {
  renderField();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await waitFor(() => expect(buField()).toHaveValue('BU1'));
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Item' }));
  expect(latest).toMatchObject({ itemId: '', buId: 'b1' });
  await pickLink(screen, 'Item', 'Cisco C9200');
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Business Unit' }));
  expect(latest).toMatchObject({ itemId: 'i1', buId: '' });
});

test('daftar BU tulis gagal dimuat: pilihan BU sementara = BU item yang dipilih', async () => {
  buList = () => Promise.reject(new Error('gagal'));
  renderField();
  await pickLink(screen, 'Item', 'Dua BU');
  expect(await linkOptionNames(screen, 'Business Unit')).toEqual(['BU1', 'BU2']);
});

test('tidak ada elemen select bawaan', async () => {
  const view = renderField();
  await pickLink(screen, 'Item', 'Cisco C9200');
  expect(view.container.querySelector('select')).toBeNull();
});

test('defaultBuForItem: aturan bawaan BU dari item', () => {
  const none = { id: '', code: '' };
  expect(defaultBuForItem([BU1], [BU1, BU2], none)).toEqual(BU1);
  expect(defaultBuForItem([BU1, BU2], [BU1, BU2], none)).toEqual(none);
  expect(defaultBuForItem([BU1, BU2], [BU1, BU2], BU2)).toEqual(BU2);
  expect(defaultBuForItem([BU1, BU2], [BU1, BU2], BU9)).toEqual(none);
  expect(defaultBuForItem([BU1, BU9], [BU1, BU2], none)).toEqual(BU1);
  expect(defaultBuForItem([BU9], [BU1, BU2], BU2)).toEqual(BU2);
  // Daftar BU tulis belum diketahui: BU item dipakai apa adanya.
  expect(defaultBuForItem([BU9], null, none)).toEqual(BU9);
});
