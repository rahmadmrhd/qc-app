import type { BrandDto, BusinessUnitOptionDto, ItemDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { meQueryKey } from '@/modules/auth/queries';
import { makeMe } from '@/test/make-me';
import { ItemFormDialog } from './item-form-dialog';

const brands: BrandDto[] = [
  {
    id: 'b1',
    name: 'Ubiquiti',
    status: 'active',
    itemCount: 0,
    updatedAt: '',
    businessUnitIds: [],
  },
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
  { id: 'bu-x', code: 'XTR', name: 'Xtra', status: 'active' },
];

const saved = {
  id: 'i-new',
  brandId: 'b1',
  brand: 'Ubiquiti',
  model: 'AF 5XHD',
  isCountryLock: false,
  firmware: '',
  proofRequired: false,
  proofMin: 1,
  boxSize: 0,
  status: 'active',
  aliases: [],
  imageCount: 0,
  businessUnits: [{ id: 'bu-a', code: 'RTL', name: 'Retail' }],
  updatedAt: '2026-11-20T00:00:00.000Z',
  hasInstructions: false,
  hasManualBook: false,
  hasPostel: false,
  manualBook: null,
  postel: null,
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
  createdAt: '',
  updatedBy: '',
} as ItemDto;

let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  calls = [];
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    calls.push({ id, input });
    switch (id) {
      case 'brands.list':
        return brands;
      case 'businessUnits.options':
        return businessUnits;
      case 'stickers.list':
      case 'stickerTypes.list':
        return [];
      case 'items.save':
        return saved;
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount(
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
  allowedBuIds?: readonly string[],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Hanya bu-a yang boleh diedit; bu-x tidak punya level item.
  client.setQueryData(
    meQueryKey,
    makeMe({
      itemLevel: 'edit',
      businessUnits: [
        {
          id: 'bu-a',
          code: 'RTL',
          name: 'Retail',
          status: 'active',
          permissions: { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
        },
        {
          id: 'bu-b',
          code: 'WHL',
          name: 'Wholesale',
          status: 'active',
          permissions: { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
        },
        {
          id: 'bu-x',
          code: 'XTR',
          name: 'Xtra',
          status: 'active',
          permissions: { item: 'view', serial: 'none', serialservice: 'none', serialwh: 'none' },
        },
      ],
    }),
  );
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={<p>memuat</p>}>
          <ItemFormDialog
            open
            onOpenChange={onOpenChange}
            onCreated={onCreated}
            allowedBuIds={allowedBuIds}
          />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  const dialog = await screen.findByRole('alertdialog');
  await within(dialog).findByLabelText('Tipe');
  return { dialog, onCreated, onOpenChange };
}

test('field BU hanya menawarkan BU yang boleh diedit pengguna', async () => {
  await mount();
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['RTL - Retail', 'WHL - Wholesale']);
});

test('allowedBuIds membatasi pilihan BU ke irisan dengan BU yang boleh diedit', async () => {
  await mount(vi.fn(), vi.fn(), ['bu-b', 'bu-x']);
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['WHL - Wholesale']);
});

test('menyimpan memanggil items.save, lalu onCreated dengan item tersimpan dan dialog menutup', async () => {
  const { onCreated, onOpenChange } = await mount();
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Ubiquiti' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  await userEvent.click(await screen.findByRole('option', { name: 'RTL - Retail' }));
  await userEvent.keyboard('{Escape}');
  await userEvent.type(screen.getByLabelText('Tipe'), 'AF 5XHD');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(saved));
  expect(calls.find((call) => call.id === 'items.save')?.input).toMatchObject({
    brandId: 'b1',
    model: 'AF 5XHD',
    businessUnitIds: ['bu-a'],
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('dialog tertutup tidak memuat apa pun', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ItemFormDialog open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(apiMock).not.toHaveBeenCalled();
});
