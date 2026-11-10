import type { GuideUsageDto, ItemDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ApiError } from '@/lib/api/api-error';
import { CopyMarksDialog } from './copy-marks-dialog';

const USAGES: GuideUsageDto[] = [
  { itemId: 'i-self', label: 'Ubiquiti Saya', status: 'active' },
  { itemId: 'i1', label: 'Mikrotik hAP', status: 'active' },
  { itemId: 'i2', label: 'Lama XR', status: 'inactive' },
];

const SOURCE_MARKS = [
  {
    x: 100,
    y: 200,
    target: { kind: 'sticker' as const, stickerId: 's1' },
    note: 'Pojok',
    targetName: 'Stiker Postel',
    resolved: [],
    unresolved: false,
  },
  {
    x: 700,
    y: 800,
    target: { kind: 'type' as const, typeId: 't1' },
    note: '',
    targetName: 'Jenis',
    resolved: [],
    unresolved: true,
  },
];

function itemWithPhoto(guideId: string): ItemDto {
  return {
    id: 'i1',
    stickerPhotos: [
      {
        guideId,
        guideName: 'Belakang',
        width: 800,
        height: 600,
        caption: 'Catatan foto sumber',
        buId: null,
        marks: SOURCE_MARKS,
      },
    ],
  } as unknown as ItemDto;
}

function setup(props: Partial<Parameters<typeof CopyMarksDialog>[0]> = {}) {
  const onCopy = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CopyMarksDialog
        guideId="g1"
        guideName="Belakang"
        currentItemId="i-self"
        onCopy={onCopy}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onCopy, onClose };
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: { id: string }) => {
    if (id === 'stickerGuides.usages') return USAGES;
    if (id === 'items.get') return itemWithPhoto('g1');
    throw new Error(`tak terduga: ${id} ${JSON.stringify(input)}`);
  });
});

test('menampilkan item pemakai gambar (tanpa item yang sedang diubah) dengan tanda status', async () => {
  setup();
  expect(await screen.findByText('Mikrotik hAP')).toBeInTheDocument();
  expect(screen.getByText('Lama XR')).toBeInTheDocument();
  expect(screen.getByText('nonaktif')).toBeInTheDocument();
  expect(screen.queryByText('Ubiquiti Saya')).not.toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith('stickerGuides.usages', { id: 'g1' });
});

test('Salin membaca item sumber dan menyalin penanda apa adanya tanpa catatan foto', async () => {
  const { onCopy } = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Salin penanda dari Mikrotik hAP' }),
  );
  await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
  expect(apiMock).toHaveBeenCalledWith('items.get', { id: 'i1' });
  const marks = onCopy.mock.calls[0]?.[0];
  expect(marks).toEqual([
    { x: 100, y: 200, target: { kind: 'sticker', stickerId: 's1' }, note: 'Pojok' },
    { x: 700, y: 800, target: { kind: 'type', typeId: 't1' }, note: '' },
  ]);
  // hanya penanda: tanpa catatan foto atau field tampilan
  expect(JSON.stringify(marks)).not.toContain('Catatan foto');
  expect(JSON.stringify(marks)).not.toContain('targetName');
});

test('hasil salinan tidak berbagi referensi dengan item sumber', async () => {
  const { onCopy } = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Salin penanda dari Mikrotik hAP' }),
  );
  await waitFor(() => expect(onCopy).toHaveBeenCalled());
  const copied = onCopy.mock.calls[0]?.[0] as { x: number; target: { stickerId: string } }[];
  const first = copied[0] as { x: number; target: { stickerId: string } };
  first.x = 999;
  first.target.stickerId = 'diubah';
  expect(SOURCE_MARKS[0]?.x).toBe(100);
  expect(SOURCE_MARKS[0]?.target).toEqual({ kind: 'sticker', stickerId: 's1' });
});

test('gagal membaca item sumber: galat tampil dan tidak menyalin', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'stickerGuides.usages') return USAGES;
    throw new ApiError('NOT_FOUND', 'Item tidak ditemukan', '-');
  });
  const { onCopy, onClose } = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Salin penanda dari Lama XR' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Item tidak ditemukan');
  expect(onCopy).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('item sumber tanpa penanda pada gambar itu: pesan tampil dan tidak menyalin', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'stickerGuides.usages') return USAGES;
    return itemWithPhoto('gx');
  });
  const { onCopy } = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Salin penanda dari Mikrotik hAP' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('tidak memiliki penanda');
  expect(onCopy).not.toHaveBeenCalled();
});

test('Lewati menutup dialog tanpa menyalin', async () => {
  const { onCopy, onClose } = setup();
  await screen.findByText('Mikrotik hAP');
  await userEvent.click(screen.getByRole('button', { name: 'Lewati' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onCopy).not.toHaveBeenCalled();
});

test('tanpa item pemakai yang dapat dilihat (atau hanya item ini sendiri): dialog menutup sendiri', async () => {
  apiMock.mockImplementation(async () => [USAGES[0]]);
  const { onClose } = setup();
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
