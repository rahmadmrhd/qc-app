import type { MeDto } from '@shared/contract';
import {
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

let overrides: Partial<Record<WidgetResult['id'], WidgetResult>> = {};

beforeEach(() => {
  overrides = {};
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: DashboardQueryInput | null) => {
    if (id === 'dashboard.options') {
      return {
        customers: [{ value: 'c1', label: 'PT Satu' }],
        items: [],
        stickerTypes: [],
        stickers: [],
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
