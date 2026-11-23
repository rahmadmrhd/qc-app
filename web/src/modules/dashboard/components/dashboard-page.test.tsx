import type { MeDto } from '@shared/contract';
import {
  type DashboardOptionsInput,
  type DashboardQueryInput,
  rangePreset,
  type WidgetResult,
  widgetMeta,
} from '@shared/dashboard';
import { wibDateIso } from '@shared/postel';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { closeFilterChip, pickSelect } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { type DashboardSearch, parseDashboardSearch } from '../lib/search';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { DashboardPage } from './dashboard-page';

const NONE_LEVELS = {
  access: 'none',
  item: 'none',
  qrcode: 'none',
  handover: 'none',
  qc: 'none',
  stock: 'none',
  sticker: 'none',
  stickerstock: 'none',
  serial: 'none',
  serialservice: 'none',
  countrylock: 'none',
  dashboard: 'none',
} as MeDto['permissions'];

function makeUser(options: { handover?: boolean; serial?: boolean }): MeDto {
  return {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    canManageSerialSettings: false,
    sharedAccount: false,
    permissions: NONE_LEVELS,
    locations: options.handover
      ? [
          {
            id: 'l1',
            code: 'L1',
            name: 'Lokasi Satu',
            permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
          },
        ]
      : [],
    businessUnits: options.serial
      ? [
          {
            id: 'b1',
            code: 'B1',
            name: 'BU Satu',
            status: 'active',
            permissions: { item: 'none', serial: 'view', serialservice: 'none' },
          },
        ]
      : [],
  } as unknown as MeDto;
}

function okResult(id: WidgetResult['id']): WidgetResult {
  const meta = widgetMeta(id);
  switch (meta.visual) {
    case 'number':
      return { id, status: 'ok', data: { kind: 'number', value: 5 } };
    case 'list':
      return { id, status: 'ok', data: { kind: 'list', columns: [], rows: [], total: 0 } };
    case 'line':
    case 'barGroup':
      return {
        id,
        status: 'ok',
        data: { kind: 'series', bucket: 'day', points: [], series: [] },
      };
    default:
      return { id, status: 'ok', data: { kind: 'parts', slices: [] } };
  }
}

const CUSTOMERS = [
  { value: 'c1', label: 'PT Satu' },
  { value: 'c2', label: 'PT Dua' },
];
let optionsNext = false;
/** Bila terisi, permintaan `ids` menunggu promise ini (meniru resolusi nama yang belum tiba). */
let idsGate: Promise<void> | null = null;
let overrides: Partial<Record<WidgetResult['id'], WidgetResult>> = {};

beforeEach(() => {
  overrides = {};
  optionsNext = false;
  idsGate = null;
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: DashboardQueryInput | null) => {
    if (id === 'dashboard.options') {
      const request = (input ?? {}) as DashboardOptionsInput;
      if (request.ids && idsGate) await idsGate;
      const all = CUSTOMERS.filter((option) =>
        request.ids
          ? request.ids.includes(option.value)
          : option.label.toLowerCase().includes((request.query ?? '').toLowerCase()),
      );
      return {
        customers: request.kind === 'customers' || !request.kind ? all : [],
        items: [],
        stickerTypes: [],
        stickers: [],
        ...(optionsNext ? { next: { customers: '50' } } : {}),
      };
    }
    if (id === 'dashboard.query' && input) {
      return {
        generatedAt: '2026-11-23T00:00:00.000Z',
        range: { from: input.filter.from, to: input.filter.to },
        bucket: 'day',
        widgets: input.widgets.map((widget) => overrides[widget.id] ?? okResult(widget.id)),
      };
    }
    throw new Error(`api tak terduga: ${id}`);
  });
});

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [search, setSearch] = useState<DashboardSearch>(parseDashboardSearch(initial));
  return (
    <DashboardPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const queryCalls = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'dashboard.query')
    .map((call) => call[1] as DashboardQueryInput);
const callsOf = (prefix: string) =>
  queryCalls().filter((input) => input.widgets[0]?.id.startsWith(prefix));

async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

test('pengguna hanya Serah Terima: hanya grup Serah Terima yang tampil', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  expect(await screen.findByRole('heading', { name: 'Serah Terima' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Serial Number' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Stok Stiker' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Postel' })).toBeNull();
  // Widget Serah Terima saja yang diminta dari server.
  await waitFor(() => expect(callsOf('hs.').length).toBeGreaterThan(0));
  expect(queryCalls().every((input) => input.widgets.every((w) => w.id.startsWith('hs.')))).toBe(
    true,
  );
});

test('tanpa izin apa pun: pesan tanpa akses dan tanpa permintaan', async () => {
  me = makeUser({});
  await renderInRouter(<Harness />);
  expect(await screen.findByText('Anda belum punya akses ke data dashboard.')).toBeTruthy();
  expect(queryCalls()).toHaveLength(0);
});

test('mengubah chip Tanggal memanggil dashboard.query dengan rentang baru', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  await openChip('Tanggal');
  await userEvent.click(await screen.findByRole('button', { name: '7 hari terakhir' }));
  await closeFilterChip();
  const expected = rangePreset('last7', wibDateIso(Date.now()));
  await waitFor(() => {
    const last = queryCalls().at(-1);
    expect(last?.filter.from).toBe(expected.from);
    expect(last?.filter.to).toBe(expected.to);
  });
});

test('filter grup mengubah widget grup itu saja', async () => {
  me = makeUser({ handover: true, serial: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serial Number' });
  await waitFor(() => expect(callsOf('sn.').length).toBeGreaterThan(0));
  const serialBefore = callsOf('sn.').length;
  await openChip('Status papan');
  await pickSelect(screen, 'Filter Status papan', 'Selesai');
  await closeFilterChip();
  await waitFor(() => {
    const last = callsOf('hs.').at(-1);
    expect(last?.widgets[0]?.filters).toEqual({ status: ['done'] });
  });
  expect(callsOf('sn.').length).toBe(serialBefore);
  expect(callsOf('sn.').at(-1)?.widgets[0]?.filters).toBeUndefined();
});

test('filter BU aktif memunculkan "BU tidak berlaku" pada widget Serah Terima', async () => {
  me = makeUser({ handover: true, serial: true });
  await renderInRouter(<Harness initial={{ bu: ['b1'] }} />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  await waitFor(() => expect(screen.getAllByText('BU tidak berlaku').length).toBeGreaterThan(0));
  // Widget Serial mengikuti BU, jadi tak pernah bertanda "BU tidak berlaku": jumlahnya = widget Serah Terima.
  const handoverWidgets = document.querySelectorAll('[data-widget^="hs."]').length;
  expect(screen.getAllByText('BU tidak berlaku')).toHaveLength(handoverWidgets);
});

test('tanpa filter BU, tak ada penanda "BU tidak berlaku"', async () => {
  me = makeUser({ handover: true, serial: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  expect(screen.queryByText('BU tidak berlaku')).toBeNull();
});

test('galat satu widget tidak menyembunyikan widget lain', async () => {
  me = makeUser({ handover: true });
  overrides = {
    'hs.created': { id: 'hs.created', status: 'error', message: 'Widget tidak dapat dimuat' },
  };
  await renderInRouter(<Harness />);
  expect(await screen.findByText('Widget tidak dapat dimuat')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  // Widget lain di grup yang sama tetap menampilkan angkanya.
  await waitFor(() => expect(screen.getAllByText('5').length).toBeGreaterThan(0));
});

test('ponsel: kisi dua kolom, kartu angka satu kolom dan kartu lain selebar dua kolom', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  const wrapperOf = (id: string) => {
    const card = document.querySelector(`[data-widget="${id}"]`);
    expect(card).not.toBeNull();
    return card?.parentElement as HTMLElement;
  };
  const number = wrapperOf('hs.created');
  const donut = wrapperOf('hs.status');
  const trend = wrapperOf('hs.trend');
  expect(number.parentElement?.className).toContain('grid-cols-2');
  expect(number.className).not.toMatch(/(^|\s)col-span-2(\s|$)/);
  expect(donut.className).toMatch(/(^|\s)col-span-2(\s|$)/);
  expect(trend.className).toMatch(/(^|\s)col-span-2(\s|$)/);
});

test('grup di luar layar tidak diminta; diminta begitu mendekat; berhenti saat menjauh', async () => {
  const fake = installIntersectionObserver();
  try {
    me = makeUser({ handover: true, serial: true });
    await renderInRouter(<Harness />);
    const handover = (await screen.findByRole('heading', { name: 'Serah Terima' })).closest(
      'section',
    ) as HTMLElement;
    const serial = screen
      .getByRole('heading', { name: 'Serial Number' })
      .closest('section') as HTMLElement;
    expect(queryCalls()).toHaveLength(0);
    fake.setIntersecting(handover, true);
    await waitFor(() => expect(callsOf('hs.').length).toBe(1));
    expect(callsOf('sn.')).toHaveLength(0);
    fake.setIntersecting(serial, true);
    await waitFor(() => expect(callsOf('sn.').length).toBe(1));
    // Menjauh lalu mendekat lagi dengan data masih segar: tanpa permintaan baru.
    fake.setIntersecting(serial, false);
    fake.setIntersecting(serial, true);
    expect(callsOf('sn.')).toHaveLength(1);
  } finally {
    fake.restore();
  }
});

const optionCalls = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'dashboard.options')
    .map((call) => call[1] as DashboardOptionsInput);

test('filter relasi: mengetik mencari ke server (bukan menyaring daftar lokal)', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  await openChip('Customer');
  await userEvent.type(await screen.findByRole('combobox', { name: 'Filter Customer' }), 'dua');
  await waitFor(() =>
    expect(optionCalls().some((call) => call.kind === 'customers' && call.query === 'dua')).toBe(
      true,
    ),
  );
  expect(await screen.findByRole('option', { name: 'PT Dua' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'PT Satu' })).toBeNull();
});

test('nilai terpilih dari URL diresolusi namanya lewat ids (bukan "tidak dikenal")', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness initial={{ handover_customer: ['c2'] }} />);
  expect(await screen.findByRole('button', { name: /^Customer: PT Dua/ })).toBeTruthy();
  expect(
    optionCalls().some(
      (call) => call.kind === 'customers' && call.ids?.length === 1 && call.ids[0] === 'c2',
    ),
  ).toBe(true);
});

test('id yang tak ada di server tetap tampil "tidak dikenal"', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness initial={{ handover_customer: ['hilang'] }} />);
  expect(await screen.findByRole('button', { name: /Customer tidak dikenal/ })).toBeTruthy();
});

test('ada halaman berikutnya: petunjuk persempit pencarian', async () => {
  optionsNext = true;
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  await openChip('Customer');
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter Customer' }));
  expect(await screen.findByText('Ada hasil lain, persempit pencarian')).toBeTruthy();
});

/** Gerbang yang dibuka tes (meniru jawaban `ids` yang terlambat). */
function makeGate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test('memilih nilai baru (belum ada nilai terkomit): label di input dan di tombol chip tak pernah "Memuat..." atau "tidak dikenal"', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Serah Terima' });
  await openChip('Customer');
  await pickSelect(screen, 'Filter Customer', 'PT Dua');
  // Chip di dalam input memakai nama dari hasil pencarian yang baru diterima.
  expect(screen.queryByText('Memuat…')).toBeNull();
  expect(screen.queryByText('Customer tidak dikenal')).toBeNull();
  expect(screen.getAllByText('PT Dua').length).toBeGreaterThan(0);
  // Jawaban `ids` untuk nilai baru tertahan: tombol chip setelah ditutup tetap menulis nama, bukan kilatan teks lain.
  const gate = makeGate();
  idsGate = gate.promise;
  await closeFilterChip();
  expect(await screen.findByRole('button', { name: /^Customer: PT Dua/ })).toBeTruthy();
  expect(screen.queryByText(/tidak dikenal/)).toBeNull();
  expect(screen.queryByText('Memuat…')).toBeNull();
  gate.open();
  await waitFor(() =>
    expect(optionCalls().some((call) => call.ids?.length === 1 && call.ids[0] === 'c2')).toBe(true),
  );
  expect(screen.getByRole('button', { name: /^Customer: PT Dua/ })).toBeTruthy();
});

test('memilih nilai baru di atas nilai terkomit: kedua nama tampil di input dan tombol chip tanpa kilatan "tidak dikenal"', async () => {
  me = makeUser({ handover: true });
  await renderInRouter(<Harness initial={{ handover_customer: ['c1'] }} />);
  await screen.findByRole('button', { name: /^Customer: PT Satu/ });
  await openChip('Customer');
  await pickSelect(screen, 'Filter Customer', 'PT Dua');
  expect(screen.queryByText('Customer tidak dikenal')).toBeNull();
  expect(screen.queryByText('Memuat…')).toBeNull();
  expect(screen.getAllByText('PT Satu').length).toBeGreaterThan(0);
  expect(screen.getAllByText('PT Dua').length).toBeGreaterThan(0);
  const gate = makeGate();
  idsGate = gate.promise;
  await closeFilterChip();
  expect(await screen.findByRole('button', { name: /^Customer: PT Satu, PT Dua/ })).toBeTruthy();
  expect(screen.queryByText(/tidak dikenal/)).toBeNull();
  gate.open();
  await waitFor(() => expect(optionCalls().some((call) => call.ids?.length === 2)).toBe(true));
  expect(screen.getByRole('button', { name: /^Customer: PT Satu, PT Dua/ })).toBeTruthy();
});

test('grup di luar layar tidak dimuat ulang oleh selang 60 dtk; kembali ke layar menyegarkan data basi', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    shouldAdvanceTime: true,
  });
  const fake = installIntersectionObserver();
  try {
    me = makeUser({ handover: true });
    await renderInRouter(<Harness />);
    const handover = (await screen.findByRole('heading', { name: 'Serah Terima' })).closest(
      'section',
    ) as HTMLElement;
    fake.setIntersecting(handover, true);
    await waitFor(() => expect(callsOf('hs.').length).toBe(1));
    // Kontrol: selagi tampil, selang 60 dtk memuat ulang (tanpa ini asersi "tidak" di bawah tak bermakna).
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(callsOf('hs.').length).toBe(2));
    fake.setIntersecting(handover, false);
    const before = callsOf('hs.').length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(callsOf('hs.').length).toBe(before);
    // Mendekat lagi dengan data yang sudah basi: dimuat ulang sekali.
    fake.setIntersecting(handover, true);
    await waitFor(() => expect(callsOf('hs.').length).toBe(before + 1));
  } finally {
    fake.restore();
    vi.useRealTimers();
  }
});
