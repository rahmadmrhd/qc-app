import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { clearAllDrafts } from '../lib/draft-store';
import { optionsApi, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

beforeEach(() => {
  localStorage.clear();
  me = testMe();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.buOptions') {
      return Promise.resolve({
        businessUnits: [
          { id: 'b1', code: 'BU1', name: 'Business Unit 1' },
          { id: 'b2', code: 'BU2', name: 'Business Unit 2' },
        ],
      });
    }
    return optionsApi(id, input);
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

const defaults = () => screen.getByRole('region', { name: 'Default' });

test('urutan field Default: Lokasi, Tanggal uji, Item, BU, Sample, Stiker yang ditempel, Catatan', async () => {
  renderPage();
  await screen.findByRole('combobox', { name: 'Lokasi' });
  const region = defaults();
  const anchors = [
    region.querySelector('#default-location'),
    region.querySelector('#default-date'),
    region.querySelector('#default-item'),
    region.querySelector('#default-bu'),
    region.querySelector('#default-sample'),
    within(region).getByText('Stiker yang ditempel'),
    region.querySelector('#default-note'),
  ];
  for (const anchor of anchors) expect(anchor).not.toBeNull();
  for (let at = 1; at < anchors.length; at++) {
    const before = anchors[at - 1] as Element;
    const after = anchors[at] as Element;
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test('Item, BU, dan Lokasi memakai LinkField; tidak ada elemen select bawaan', async () => {
  const { container } = renderPage();
  for (const name of ['Item', 'Business Unit', 'Lokasi']) {
    expect(await screen.findByRole('combobox', { name })).toBeInTheDocument();
  }
  expect(container.querySelector('select')).toBeNull();
});

test('BU selalu tampil sebelum item dipilih dan menawarkan semua BU tulis', async () => {
  renderPage();
  expect(await screen.findByRole('combobox', { name: 'Business Unit' })).toBeEnabled();
  expect(await linkOptionNames(screen, 'Business Unit')).toEqual([
    'BU1 - Business Unit 1',
    'BU2 - Business Unit 2',
  ]);
});

test('item satu BU mengisi BU otomatis; BU boleh diganti ke BU lain dan gerbang tetap terpenuhi', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Business Unit' })).toHaveValue(
      'BU1 - Business Unit 1',
    ),
  );
  await pickLink(screen, 'Business Unit', 'BU2 - Business Unit 2');
  expect(screen.getByRole('combobox', { name: 'Business Unit' })).toHaveValue(
    'BU2 - Business Unit 2',
  );
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await waitFor(() =>
    expect(screen.getByLabelText('Scan atau tempel serial (satu per baris)')).toBeEnabled(),
  );
});

test('BU dikosongkan: gerbang menyebut Business Unit (BU kosong = belum lengkap)', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await waitFor(() =>
    expect(screen.getByLabelText('Scan atau tempel serial (satu per baris)')).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Business Unit' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Isi Default dulu: Business Unit');
});

test('Catatan memakai editor Markdown (kotak teks kaya), bukan input teks biasa', async () => {
  renderPage();
  const note = await screen.findByRole('textbox', { name: 'Catatan' });
  expect(note).toHaveAttribute('contenteditable', 'true');
  expect(note).toHaveAttribute('id', 'default-note');
  expect(note.tagName).not.toBe('INPUT');
  // Batas karakter catatan serial ditampilkan oleh editor.
  expect(screen.getByText('0/1000')).toBeInTheDocument();
});

test('Default Catat Serial: Lokasi, Tanggal uji, Item, BU wajib; Catatan opsional', () => {
  renderPage();
  const region = defaults();
  for (const name of ['Lokasi', 'Tanggal uji', 'Item', 'Business Unit']) {
    expect(within(region).getByLabelText(name)).toHaveAttribute('aria-required', 'true');
  }
  expect(within(region).getByLabelText('Catatan')).not.toHaveAttribute('aria-required');
});
