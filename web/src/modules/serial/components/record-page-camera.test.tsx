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
  { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
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
