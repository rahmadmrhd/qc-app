import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, pickLink } from '@/test/link-field';
import { clearAllDrafts } from '../lib/draft-store';
import { testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

/** Stiker yang berlaku mengikuti PASANGAN (item, BU serial): item i1 punya stiker berbeda di BU1 dan BU2. */
const STICKERS: Record<string, { id: string; name: string }[]> = {
  'i1|b1': [
    { id: 's1', name: 'Stiker A' },
    { id: 's2', name: 'Stiker B' },
  ],
  'i1|b2': [{ id: 's5', name: 'Segel BU2' }],
};

let stickerCalls: { itemId: string; buId: string }[] = [];
let saved: { buId: string; stickers: { stickerId: string; qty: number }[] }[] = [];

beforeEach(() => {
  localStorage.clear();
  me = testMe();
  stickerCalls = [];
  saved = [];
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.buOptions') {
      return Promise.resolve({
        businessUnits: [
          { id: 'b1', code: 'BU1', name: 'Business Unit 1' },
          { id: 'b2', code: 'BU2', name: 'Business Unit 2' },
        ],
      });
    }
    if (id === 'serials.itemOptions') {
      // Item i1 hanya terdaftar di BU1 (BU2 adalah BU lain: serial boleh dicatat ke BU bebas).
      const items = [
        {
          id: 'i1',
          label: 'Cisco C9200',
          buIds: ['b1'],
          buOptions: [{ id: 'b1', code: 'BU1', name: 'Business Unit 1' }],
        },
      ];
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? items.filter((item) => ids.includes(item.id)) : items,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      const pair = { itemId: String(input.itemId), buId: String(input.buId) };
      stickerCalls.push(pair);
      const list = STICKERS[`${pair.itemId}|${pair.buId}`];
      if (!list) return Promise.reject(new Error('tidak ditemukan'));
      return Promise.resolve({
        stickers: list.map((sticker) => ({
          ...sticker,
          alias: '',
          typeName: 'Jenis',
          defaultQty: 1,
        })),
      });
    }
    if (id === 'serials.saveBatch') {
      const rows = input.rows as {
        clientId: string;
        buId: string;
        stickers: { stickerId: string; qty: number }[];
      }[];
      for (const row of rows) saved.push({ buId: row.buId, stickers: row.stickers });
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, result: 'created', message: '' })),
      });
    }
    if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

afterEach(() => {
  clearAllDrafts();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

async function pickItemAndLocation() {
  await pickLink(screen, 'Item', 'Cisco C9200');
  await expectLinkValue(screen, 'Lokasi', 'Jakarta (JKT)');
  await expectLinkValue(screen, 'Business Unit', 'BU1 - Business Unit 1');
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes('\n')) await userEvent.keyboard('{Enter}');
}

const askedFor = (itemId: string, buId: string) =>
  stickerCalls.some((call) => call.itemId === itemId && call.buId === buId);

test('Default: mengganti BU meminta ulang stiker untuk (item, BU baru) dan mengembalikan pilihan ke bawaan', async () => {
  renderPage();
  await pickItemAndLocation();
  const region = screen.getByRole('region', { name: 'Default' });
  const stickerB = await within(region).findByRole('checkbox', { name: 'Stiker B' });
  // Pilihan eksplisit di BU1: Stiker B dilepas.
  await userEvent.click(stickerB);
  expect(within(region).getByRole('checkbox', { name: 'Stiker B' })).not.toBeChecked();

  await pickLink(screen, 'Business Unit', 'BU2 - Business Unit 2');
  expect(await within(region).findByRole('checkbox', { name: 'Segel BU2' })).toBeChecked();
  expect(askedFor('i1', 'b2')).toBe(true);
  expect(within(region).queryByRole('checkbox', { name: 'Stiker A' })).toBeNull();
  expect(within(region).queryByRole('checkbox', { name: 'Stiker B' })).toBeNull();

  // Kembali ke BU1: pilihan lama (Stiker B dilepas) tidak terbawa, semuanya tercentang lagi.
  await pickLink(screen, 'Business Unit', 'BU1 - Business Unit 1');
  expect(await within(region).findByRole('checkbox', { name: 'Stiker B' })).toBeChecked();
});

test('Default: serial yang dicatat ke BU lain memotong stiker BU itu saat disimpan', async () => {
  renderPage();
  await pickItemAndLocation();
  await pickLink(screen, 'Business Unit', 'BU2 - Business Unit 2');
  await screen.findByRole('checkbox', { name: 'Segel BU2' });
  await paste('A1');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toEqual({ buId: 'b2', stickers: [{ stickerId: 's5', qty: 1 }] });
});

test('Ubah baris: mengganti BU meminta ulang stiker (item, BU baru) dan mereset pilihan lama', async () => {
  renderPage();
  await pickItemAndLocation();
  await paste('A1');
  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker B' }));
  expect(within(dialog).getByRole('checkbox', { name: 'Stiker B' })).not.toBeChecked();

  await pickLink(screen, 'Business Unit baris', 'BU2 - Business Unit 2');
  expect(await within(dialog).findByRole('checkbox', { name: 'Segel BU2' })).toBeChecked();
  expect(within(dialog).queryByRole('checkbox', { name: 'Stiker A' })).toBeNull();
  expect(askedFor('i1', 'b2')).toBe(true);

  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toEqual({ buId: 'b2', stickers: [{ stickerId: 's5', qty: 1 }] });
});

test('Ubah massal: BU baris diganti, pilihan stiker eksplisit BU lama dibuang dan stiker BU baru dimuat saat simpan', async () => {
  renderPage();
  await pickItemAndLocation();
  await paste('A1');
  // Pilihan eksplisit di BU1: hanya Stiker A.
  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker B' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  expect(screen.getByText('Stiker A ×1')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris A1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await pickLink(screen, 'Business Unit (ubah massal)', 'BU2 - Business Unit 2');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 1 baris' }));
  // Pilihan lama tidak terbawa ke BU baru.
  expect(screen.queryByText(/^Stiker A ×/)).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(askedFor('i1', 'b2')).toBe(true);
  expect(saved[0]).toEqual({ buId: 'b2', stickers: [{ stickerId: 's5', qty: 1 }] });
});
