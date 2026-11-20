import type { QrItemOptionDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { ItemPicker, type PickedItem } from './item-picker';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const option = (
  id: string,
  model: string,
  extra: Partial<QrItemOptionDto> = {},
): QrItemOptionDto => ({
  id,
  brand: 'Brand',
  model,
  businessUnitIds: ['bu1'],
  manualBookName: '',
  ...extra,
});

function Harness({
  initial = [],
  ownedIds = [],
  onCreate,
}: {
  initial?: PickedItem[];
  ownedIds?: string[];
  onCreate?: () => void;
}) {
  const [selected, setSelected] = useState<PickedItem[]>(initial);
  return (
    <>
      <ItemPicker
        selected={selected}
        onChange={setSelected}
        ownedIds={new Set(ownedIds)}
        onCreate={onCreate}
      />
      <output aria-label="dipilih">{selected.map((item) => item.id).join(',')}</output>
    </>
  );
}

function renderPicker(props: React.ComponentProps<typeof Harness> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    items: [
      option('i1', 'PBE M5-400'),
      option('i2', 'PBE M5-200'),
      option('i3', 'U6-XG', { manualBookName: 'U6 Lama' }),
    ],
    nextCursor: null,
  });
});

test('memilih beberapa item; label opsi = merk + tipe; hasil memuat BU item untuk penarikan preset', async () => {
  renderPicker();
  await pickLink(screen, 'Item', 'Brand PBE M5-400');
  await pickLink(screen, 'Item', 'Brand PBE M5-200');
  expect(screen.getByLabelText('dipilih')).toHaveTextContent('i1,i2');
  expect(screen.getByRole('button', { name: 'Hapus Brand PBE M5-400' })).toBeInTheDocument();
});

test('item yang sudah tergabung ke konfigurasi ini sendiri tetap dapat dipilih walau ber-Manual Book', async () => {
  renderPicker({ ownedIds: ['i3'] });
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  const row = await screen.findByRole('option', { name: /U6-XG/ });
  expect(row).not.toHaveAttribute('aria-disabled');
});

test('item tergabung ke Manual Book lain tidak dapat dipilih', async () => {
  renderPicker();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  const row = await screen.findByRole('option', { name: /U6-XG/ });
  expect(row).toHaveAttribute('aria-disabled', 'true');
  expect(row).toHaveTextContent('U6 Lama');
});

test('mengetik mencari lewat qrcodes.itemOptions dengan query', async () => {
  renderPicker();
  await userEvent.type(screen.getByRole('combobox', { name: 'Item' }), 'pbe');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'qrcodes.itemOptions',
      expect.objectContaining({ query: 'pbe' }),
    ),
  );
});

test('baris "Tambah Item" hanya ada bila onCreate diberikan dan memanggilnya', async () => {
  const first = renderPicker();
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await screen.findByRole('option', { name: /PBE M5-400/ });
  expect(screen.queryByRole('option', { name: 'Tambah Item' })).toBeNull();
  first.unmount();
  const onCreate = vi.fn();
  renderPicker({ onCreate });
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Item' }));
  expect(onCreate).toHaveBeenCalledTimes(1);
});
