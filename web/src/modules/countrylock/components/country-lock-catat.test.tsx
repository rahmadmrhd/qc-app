import type { MeDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { optionsApi, testMe } from '@/modules/serial/test-support';
import { pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { createFakeBridge } from '../fake-bridge';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { CountryLockPage } from './country-lock-page';

// Catat Serial Number bersama di halaman Country Lock desktop (draft SQLite, serial hasil inject terkunci).

let media: ReturnType<typeof mockMatchMedia>;

beforeEach(() => {
  localStorage.clear();
  media = mockMatchMedia(true);
  apiMock.mockImplementation(optionsApi);
  me = testMe();
});

afterEach(() => {
  media.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

const savedRow = (serial: string) => ({
  clientId: `cid-${serial}-00000000`,
  serial,
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  buId: 'b1',
  buLabel: 'BU1',
  testDate: '2026-11-18',
  locationId: 'l1',
  locationLabel: 'Jakarta (JKT)',
  sample: false,
  note: '',
  capturedAt: '2026-11-18T08:00:00.000Z',
  source: 'countrylock',
  stickers: null,
  proofPhotos: [],
});

function renderPage(
  bridge = createFakeBridge(),
  props: { canRecord?: boolean; signedIn?: boolean } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CountryLockPage bridge={bridge} {...props} />
    </QueryClientProvider>,
  );
  return bridge;
}

async function selectBrandAndFirmware() {
  await screen.findByRole('combobox', { name: 'Merk' });
  await pickSelect(screen, 'Merk', 'Mikrotik');
  await pickSelect(screen, 'Firmware', 'AC 6.x');
}

const LOCK_HINT = 'Serial dari perangkat, tidak dapat diubah';

describe('canRecord (masuk dan berizin serial: edit)', () => {
  test('memuat Catat Serial Number bersama tanpa judulnya; draft tersimpan tampil dengan serial terkunci', async () => {
    const bridge = createFakeBridge();
    bridge.draftRows.push(savedRow('AB12'));
    renderPage(bridge, { canRecord: true });
    expect(await screen.findByRole('region', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByLabelText('Scan atau tempel serial (satu per baris)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Catat Serial Number' })).toBeNull();
    expect(await screen.findByRole('checkbox', { name: 'Pilih baris AB12' })).toBeInTheDocument();
    expect(screen.getByTitle(LOCK_HINT)).toHaveTextContent('AB12');
    expect(screen.queryByRole('textbox', { name: 'Serial AB12' })).toBeNull();
  });

  test('inject sukses menambah baris terkunci ke tabel dan menyimpannya ke draft', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = renderPage(createFakeBridge(), { canRecord: true });
    await selectBrandAndFirmware();
    const inject = screen.getByRole('button', { name: 'Inject' });
    await waitFor(() => expect(inject).toBeEnabled());
    await userEvent.click(inject);
    expect(await screen.findByRole('checkbox', { name: 'Pilih baris ABC123' })).toBeInTheDocument();
    expect(screen.getByTitle(LOCK_HINT)).toHaveTextContent('ABC123');
    await waitFor(() =>
      expect(bridge.draftRows[0]).toMatchObject({ serial: 'ABC123', source: 'countrylock' }),
    );
  });

  test('serial manual tetap bisa ditambah lewat Default + scan, dan tersimpan ke draft', async () => {
    const bridge = renderPage(createFakeBridge(), { canRecord: true });
    await screen.findByRole('region', { name: 'Default' });
    await pickLink(screen, 'Item', 'Cisco C9200');
    await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
    const scan = screen.getByLabelText('Scan atau tempel serial (satu per baris)');
    await waitFor(() => expect(scan).toBeEnabled());
    await userEvent.type(scan, 'manual1{Enter}');
    // Baris manual: kolom serialnya masih dapat diubah (bukan teks terkunci).
    expect(await screen.findByRole('textbox', { name: 'Serial MANUAL1' })).toBeInTheDocument();
    await waitFor(() =>
      expect(bridge.draftRows[0]).toMatchObject({ serial: 'MANUAL1', source: 'manual' }),
    );
  });
});

describe('tanpa hak mencatat', () => {
  test('belum masuk: ringkasan hanya-baca dengan alasan masuk; tanpa kolom scan', async () => {
    const bridge = createFakeBridge();
    bridge.draftRows.push(savedRow('AB12'));
    renderPage(bridge, { canRecord: false, signedIn: false });
    const summary = await screen.findByRole('region', { name: 'Draft Serial Number' });
    expect(within(summary).getByText('AB12')).toBeInTheDocument();
    expect(within(summary).getByText(/Masuk dulu untuk mencatat/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Scan atau tempel serial (satu per baris)')).toBeNull();
  });

  test('sudah masuk tetapi tanpa izin: alasan menyebut izin', async () => {
    renderPage(createFakeBridge(), { canRecord: false, signedIn: true });
    expect(await screen.findByText(/tidak punya izin mencatat Serial Number/)).toBeInTheDocument();
  });
});

describe('draft yang menahan inject', () => {
  test('draft.load gagal (berkas rusak): galat tampil, Inject nonaktif, tak pernah menyimpan', async () => {
    const save = vi.fn(async () => undefined);
    const bridge = createFakeBridge({
      draft: {
        load: async () => {
          throw new Error('Draft tersimpan rusak: isinya tidak terbaca.');
        },
        save,
      },
    });
    renderPage(bridge, { canRecord: true });
    await selectBrandAndFirmware();
    expect(await screen.findByText(/Draft tersimpan rusak: isinya tidak terbaca/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inject' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Default' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  test('draft penuh: Inject nonaktif dengan alasan yang terlihat', async () => {
    const bridge = createFakeBridge();
    for (let i = 0; i < SERIAL_LIMITS.tableRows; i++) bridge.draftRows.push(savedRow(`S${i}`));
    renderPage(bridge, { canRecord: false });
    await selectBrandAndFirmware();
    expect(await screen.findByText(/Draft penuh \(maks\. 1000 baris\)/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inject' })).toBeDisabled();
  });
});
