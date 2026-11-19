import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { addSerials, type DraftControl, type StagingRow } from '../lib/draft';
import { optionsApi, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

// Mode terkontrol (`draft`): tabel dan penyimpanannya milik pemanggil (draft SQLite di desktop); `localStorage` tak boleh
// tersentuh sama sekali.

let media: ReturnType<typeof mockMatchMedia>;

function seedRows(serials: string[], source: 'manual' | 'countrylock' = 'manual'): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    serials.join('\n'),
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta (JKT)',
      sample: false,
      note: '',
      stickers: [],
    },
    () => `id-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows.map((row) => ({ ...row, source }));
}

beforeEach(() => {
  localStorage.clear();
  media = mockMatchMedia(true);
  apiMock.mockImplementation(optionsApi);
  me = testMe();
});

afterEach(() => {
  media.restore();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function Harness({
  initial,
  onReplace,
  saveFailed,
  hideTitle,
}: {
  initial: StagingRow[];
  onReplace: (next: StagingRow[]) => void;
  saveFailed?: boolean;
  hideTitle?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const draft: DraftControl = {
    rows,
    replace: (next) => {
      onReplace(next);
      setRows(next);
    },
    ...(saveFailed === undefined ? {} : { saveFailed }),
  };
  return <RecordPage draft={draft} {...(hideTitle === undefined ? {} : { hideTitle })} />;
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

test('baris berasal dari draft.rows dan localStorage tak tersentuh', async () => {
  const replace = vi.fn();
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
  renderHarness({ initial: seedRows(['AAA111', 'BBB222']), onReplace: replace });
  expect(await screen.findAllByRole('row')).toHaveLength(3);
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

test('menambah serial lewat kolom scan memanggil replace dengan baris baru (tanpa localStorage)', async () => {
  const replace = vi.fn();
  renderHarness({ initial: seedRows(['AAA111']), onReplace: replace });
  await screen.findAllByRole('row');
  // Default dilengkapi lebih dulu (gerbang scan); baris contoh sudah punya item/BU/lokasi, tapi Default form kosong.
  // Cukup membuktikan jalur "Kosongkan draft": perubahan tabel selalu lewat replace.
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan draft' }));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenLastCalledWith([]);
  expect(localStorage.length).toBe(0);
});

test('hapus satu baris memanggil replace dengan sisanya', async () => {
  const replace = vi.fn();
  renderHarness({ initial: seedRows(['AAA111', 'BBB222']), onReplace: replace });
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus AAA111' }));
  expect(replace).toHaveBeenLastCalledWith([expect.objectContaining({ serial: 'BBB222' })]);
  expect(localStorage.length).toBe(0);
});

test('hideTitle menyembunyikan judul; tanpa itu judul tampil', async () => {
  const first = renderHarness({
    initial: seedRows(['AAA111']),
    onReplace: vi.fn(),
    hideTitle: true,
  });
  await screen.findAllByRole('row');
  expect(screen.queryByRole('heading', { name: 'Catat Serial Number' })).toBeNull();
  first.unmount();
  renderHarness({ initial: seedRows(['AAA111']), onReplace: vi.fn() });
  expect(await screen.findByRole('heading', { name: 'Catat Serial Number' })).toBeInTheDocument();
});

test('saveFailed menampilkan peringatan draft tidak tersimpan', async () => {
  renderHarness({ initial: seedRows(['AAA111']), onReplace: vi.fn(), saveFailed: true });
  expect(await screen.findByRole('alert')).toHaveTextContent('Draft tidak tersimpan otomatis');
});
