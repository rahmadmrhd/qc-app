import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import type { CameraScanButtonProps } from './camera-scan-button';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

// Tombol kamera diganti penangkap properti: yang diuji di sini hanya sambungannya ke halaman Catat Serial
// (isKnown = isi draft, onScan = jalur penambahan yang sama dengan tempel).
const captured = vi.hoisted(() => ({ props: null as CameraScanButtonProps | null }));
vi.mock('./camera-scan-button', () => ({
  CameraScanButton: (props: CameraScanButtonProps) => {
    captured.props = props;
    return null;
  },
}));

import { RecordPage } from './record-page';

const ITEMS = [
  {
    id: 'i1',
    label: 'Cisco C9200',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: false,
    proofMin: 1,
  },
];

beforeEach(() => {
  localStorage.clear();
  captured.props = null;
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.itemOptions') {
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? ITEMS.filter((item) => ids.includes(item.id)) : ITEMS,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({ stickers: [] });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'edit',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [],
  };
});

afterEach(() => {
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

test('isKnown pemindai kamera mengikuti isi draft (bentuk ternormalisasi, termasuk MAC); onScan menambah baris draft', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  expect(captured.props?.isKnown).toBeTypeOf('function');
  expect(captured.props?.isKnown?.('AAA1')).toBe(false);

  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste('aaa1\naabbccddeeff');
  expect(captured.props?.isKnown?.('AAA1')).toBe(true);
  expect(captured.props?.isKnown?.('AABBCCDDEEFF')).toBe(true);
  expect(captured.props?.isKnown?.('ZZZ9')).toBe(false);

  // Hasil Simpan dari dialog masuk lewat jalur yang sama: baris baru di draft dan serial itu jadi "dikenal".
  let feedback: unknown;
  act(() => {
    feedback = captured.props?.onScan('BBB2');
  });
  expect(feedback).toBe('added');
  expect(await screen.findByDisplayValue('BBB2')).toBeInTheDocument();
  expect(captured.props?.isKnown?.('BBB2')).toBe(true);
  act(() => {
    feedback = captured.props?.onScan('BBB2');
  });
  expect(feedback).toBe('duplicate');
});

test('setelah Simpan dialog, notice halaman meringkas SEMUA baris (bukan hanya yang terakhir)', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  const onSaved = captured.props?.onSaved;
  expect(onSaved).toBeTypeOf('function');
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste('dup1\ndup2');
  // Meniru Simpan: onScan per baris, lalu onSaved dengan hasil semuanya.
  const serials = ['NEW1', 'NEW2', 'DUP1', 'NEW3'];
  const results: { serial: string; feedback: 'added' | 'duplicate' | 'rejected' }[] = [];
  act(() => {
    for (const serial of serials) {
      const feedback = captured.props?.onScan(serial);
      if (feedback) results.push({ serial, feedback });
    }
    captured.props?.onSaved?.(results);
  });
  expect(screen.getByRole('status')).toHaveTextContent('3 serial ditambahkan; 1 duplikat dilewati');
});

test('ringkasan Simpan dialog kamera yang murni sukses memakai toast yang sama (id tetap), tanpa kotak inline', async () => {
  const { toast } = await import('sonner');
  vi.mocked(toast.success).mockClear();
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  act(() => {
    captured.props?.onScan('OK1');
    captured.props?.onScan('OK2');
    captured.props?.onSaved?.([
      { serial: 'OK1', feedback: 'added' },
      { serial: 'OK2', feedback: 'added' },
    ]);
  });
  const calls = vi.mocked(toast.success).mock.calls;
  expect(calls.at(-1)?.[0]).toBe('2 serial ditambahkan');
  for (const call of calls) expect(call[1]).toMatchObject({ id: 'serial-add' });
  expect(screen.queryByText('2 serial ditambahkan')).toBeNull();
});

test('Lapor Rusak: pemindai kamera memakai mode satu-serial (tanpa tabel dan tanpa Simpan)', async () => {
  const { ReportPage } = await import('./report-page');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReportPage onOpenSerial={() => undefined} />
    </QueryClientProvider>,
  );
  expect(captured.props?.single).toBe(true);
  expect(captured.props?.onSaved).toBeUndefined();
});

test('kapasitas draft diberikan ke pemindai kamera (sisa baris) dan Simpan yang terbentur batas diringkas jujur', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  expect(captured.props?.draftCapacity?.()).toBe(1000);
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste('cap1\ncap2');
  expect(captured.props?.draftCapacity?.()).toBe(998);
  act(() => {
    captured.props?.onSaved?.([
      { serial: 'N1', feedback: 'added' },
      { serial: 'N2', feedback: 'rejected' },
    ]);
  });
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('1 serial ditambahkan');
  expect(status).toHaveTextContent('batas 1000 baris draft tercapai');
  expect(status).not.toHaveTextContent('N2');
});
