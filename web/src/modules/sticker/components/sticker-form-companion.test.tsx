import type { SavePostelInput, StickerTypeDto } from '@shared/contract';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: false }),
}));
vi.mock('@/modules/item/components/image-thumb', () => ({ ImageThumb: () => null }));

import { StickerFormDialog } from './sticker-form-dialog';

// Postel dan Manual Book dibuat langsung dari form stiker (keputusan pemilik 2026-11-25): seluruh form catatan Postel /
// konfigurasi QR menjadi tab SEJAJAR (flat) dengan tab "Umum", tanpa tab bersarang.

const type = (
  id: string,
  name: string,
  systemKind: StickerTypeDto['systemKind'],
  rule: StickerTypeDto['rule'] = 'none',
): StickerTypeDto => ({
  id,
  name,
  rule,
  status: 'active',
  stickerCount: 0,
  systemKind,
  defaultMinQty: 5,
  updatedAt: '',
});
const types = [
  type('tp-a', 'Segel', ''),
  type('tp-postel', 'Postel', 'postel', 'group'),
  type('tp-mb', 'Manual Book', 'manual_book', 'group'),
];

afterEach(() => cleanup());
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((id: string) => {
    if (id === 'postels.list') {
      return Promise.resolve({ postels: [], today: '2026-11-25', soonDays: 90 });
    }
    if (id === 'postels.itemOptions') {
      return Promise.resolve({
        items: [{ id: 'i1', brand: 'PBE', model: 'M5-400', postelNumber: '' }],
        nextCursor: null,
      });
    }
    if (id === 'qrcodes.getDefaults') {
      return Promise.resolve({ logoFileIds: [], presets: [] });
    }
    return Promise.reject(new Error(`tak terduga: ${id}`));
  });
});

async function open(props: {
  onSavePostel?: (input: SavePostelInput) => Promise<null>;
  onSaveManualBook?: () => Promise<null>;
}) {
  await renderInRouter(
    <StickerFormDialog
      open
      onOpenChange={vi.fn()}
      types={types}
      businessUnits={[]}
      onSave={vi.fn().mockResolvedValue(null)}
      onSavePostel={props.onSavePostel}
      onSaveManualBook={props.onSaveManualBook}
    />,
  );
  return await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
}

const tabNames = (form: HTMLElement) =>
  within(form)
    .queryAllByRole('tab')
    .map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());

test('tanpa penyimpan Postel/Manual Book, jenis sistem tidak ditawarkan dan tak ada tab', async () => {
  const form = await open({});
  await userEvent.click(within(form).getByRole('combobox', { name: 'Jenis' }));
  expect(await screen.findByRole('option', { name: 'Segel' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Postel' })).toBeNull();
  expect(within(form).queryAllByRole('tab')).toHaveLength(0);
});

test('jenis Postel: tab Postel muncul SEJAJAR dengan Umum (satu tablist, tanpa tab bersarang)', async () => {
  const form = await open({ onSavePostel: vi.fn().mockResolvedValue(null) });
  await pickLink(within(form), 'Jenis', 'Postel');
  await waitFor(() => expect(tabNames(form)).toHaveLength(4));
  expect(within(form).getAllByRole('tablist')).toHaveLength(1);
  expect(tabNames(form)).toEqual(['Umum', 'Item', 'Nomor sertifikat', 'Catatan dan lampiran']);
});

test('Postel: simpan mengirim satu panggilan dengan catatan, nomor, dan pengaturan stiker', async () => {
  const onSavePostel = vi.fn<(input: SavePostelInput) => Promise<null>>().mockResolvedValue(null);
  const form = await open({ onSavePostel });
  await pickLink(within(form), 'Jenis', 'Postel');
  await userEvent.type(await within(form).findByLabelText('Alias'), 'Postel M5');
  await userEvent.click(within(form).getByRole('tab', { name: 'Item' }));
  await userEvent.click(within(form).getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: /PBE M5-400/ }));
  await userEvent.click(within(form).getByRole('tab', { name: 'Nomor sertifikat' }));
  await userEvent.type(within(form).getByLabelText('Nomor sertifikat 1'), 'AB-1');
  fireEvent.change(within(form).getByLabelText('Tanggal habis 1'), {
    target: { value: '2027-06-01' },
  });
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSavePostel).toHaveBeenCalledTimes(1));
  expect(onSavePostel.mock.calls[0]?.[0]).toMatchObject({
    itemIds: ['i1'],
    numbers: [{ number: 'AB-1', expiresOn: '2027-06-01' }],
    sticker: { alias: 'Postel M5', minQty: 5 },
  });
});

test('Postel: galat di tab Postel membuka tab itu dan tidak menyimpan', async () => {
  const onSavePostel = vi.fn().mockResolvedValue(null);
  const form = await open({ onSavePostel });
  await pickLink(within(form), 'Jenis', 'Postel');
  await within(form).findByRole('tab', { name: 'Item' });
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(within(form).getByRole('tab', { name: /Item/, selected: true })).toBeInTheDocument(),
  );
  expect(onSavePostel).not.toHaveBeenCalled();
});

test('jenis Manual Book: tab QR sejajar dengan Umum dan catatan bahwa stiker lahir saat ekspor', async () => {
  const form = await open({ onSaveManualBook: vi.fn().mockResolvedValue(null) });
  await pickLink(within(form), 'Jenis', 'Manual Book');
  await waitFor(() => expect(tabNames(form)).toContain('Detail'));
  expect(within(form).getAllByRole('tablist')).toHaveLength(1);
  expect(tabNames(form)[0]).toBe('Umum');
  expect(within(form).getByText(/lahir saat QR-nya diekspor/)).toBeInTheDocument();
  // Field stiker tak berlaku untuk Manual Book (stikernya belum ada).
  expect(within(form).queryByLabelText('Batas minimum')).toBeNull();
});

test('berpindah ke jenis biasa menghapus tab segmen', async () => {
  const form = await open({ onSavePostel: vi.fn().mockResolvedValue(null) });
  await pickLink(within(form), 'Jenis', 'Postel');
  await within(form).findByRole('tab', { name: 'Item' });
  await pickLink(within(form), 'Jenis', 'Segel');
  await waitFor(() => expect(within(form).queryAllByRole('tab')).toHaveLength(0));
});
