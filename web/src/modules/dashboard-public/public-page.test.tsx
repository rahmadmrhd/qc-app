import type { PublicDashboardDto } from '@shared/dashboard-public';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { closeFilterChip, linkOptionNames } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { type DashboardSearch, parseDashboardSearch } from '../dashboard/lib/search';
import { PublicDashboardPage } from './public-page';

const BASE_DTO: PublicDashboardDto = {
  title: 'Rekap Mingguan',
  sharedBy: 'budi',
  generatedAt: '2026-11-24T02:15:00.000Z',
  expiresAt: '2026-12-20T16:59:59.000Z',
  range: { from: '2026-11-01', to: '2026-11-24' },
  bucket: 'day',
  scope: { buNames: ['BU Satu'], locationNames: ['Lokasi Satu'] },
  options: {
    bu: [
      { value: 'b1', label: 'BU Satu' },
      { value: 'b2', label: 'BU Dua' },
    ],
    location: [{ value: 'l1', label: 'Lokasi Satu' }],
    groups: { customer: [{ value: 'c1', label: 'PT Satu' }] },
  },
  widgets: [
    {
      id: 'hs.created',
      group: 'handover',
      result: { status: 'ok', data: { kind: 'number', value: 7 } },
    },
    {
      id: 'sn.recorded',
      group: 'serial',
      result: { status: 'ok', data: { kind: 'number', value: 3 } },
    },
  ],
};

let dto: PublicDashboardDto;
/** Bila terisi, semua permintaan dijawab dengan status ini (problem+json). */
let failStatus: number | null = null;
const fetchMock = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  dto = structuredClone(BASE_DTO);
  failStatus = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    if (failStatus !== null) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND' }), {
        status: failStatus,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return new Response(JSON.stringify(dto), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [search, setSearch] = useState<DashboardSearch>(parseDashboardSearch(initial));
  return (
    <PublicDashboardPage
      token="tok.en"
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const callsTo = () => fetchMock.mock.calls.map((call) => [String(call[0]), call[1]] as const);

test('kepala memuat judul, periode, nama BU/Lokasi cakupan, waktu, pembagi, dan masa berlaku', async () => {
  await renderInRouter(<Harness />);
  expect(await screen.findByRole('heading', { name: 'Rekap Mingguan' })).toBeTruthy();
  expect(screen.getByText('BU Satu')).toBeTruthy();
  expect(screen.getByText('Lokasi Satu')).toBeTruthy();
  expect(screen.getByText('budi')).toBeTruthy();
  expect(screen.getByText('Periode:')).toBeTruthy();
  // Periode tampil di kepala dan di tombol chip Tanggal.
  expect(screen.getAllByText('1 Nov 2026 – 24 Nov 2026').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/24 Nov 2026 09\.15 WIB/)).toBeTruthy();
  expect(screen.getByText('20 Des 2026')).toBeTruthy();
  expect(screen.getByText('Tautan berlaku sampai:')).toBeTruthy();
});

test('tanpa navigasi aplikasi, lonceng, atau menu pengguna', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('button', { name: /notifikasi/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /keluar|akun|profil/i })).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

test('widget tampil tanpa delta periode lalu', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('7');
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByText(/periode lalu/)).toBeNull();
});

test('chip BU hanya menawarkan opsi dari options', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  await userEvent.click(screen.getByRole('button', { name: /^BU(:|$)/ }));
  expect(await linkOptionNames(screen, 'Filter BU')).toEqual(['BU Satu', 'BU Dua']);
});

test('memilih rentang tanggal memanggil POST query dengan header CSRF dan from/to', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  expect(callsTo().every(([, init]) => init?.method === undefined)).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: /^Tanggal(:|$)/ }));
  fireEvent.change(await screen.findByLabelText('Dari tanggal'), {
    target: { value: '2026-11-05' },
  });
  fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-11-20' } });
  await closeFilterChip();
  await waitFor(() => {
    const post = callsTo().find(([, init]) => init?.method === 'POST');
    expect(post).toBeTruthy();
    const [url, init] = post as NonNullable<ReturnType<typeof callsTo>[number]>;
    expect(url).toBe('/api/public/dashboards/tok.en/query');
    expect(init?.headers).toMatchObject({ 'X-Requested-With': 'qc' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ from: '2026-11-05', to: '2026-11-20' });
  });
});

test('kolom tanggal dijepit ke rentang pembagi', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  await userEvent.click(screen.getByRole('button', { name: /^Tanggal(:|$)/ }));
  const from = (await screen.findByLabelText('Dari tanggal')) as HTMLInputElement;
  expect(from.min).toBe('2026-11-01');
  expect(from.max).toBe('2026-11-24');
});

test('filter relasi yang ditawarkan dirender, yang tidak ditawarkan tidak', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  expect(screen.getByRole('button', { name: /^Customer(:|$)/ })).toBeTruthy();
  // Filter enum grup selalu ada.
  expect(screen.getByRole('button', { name: /^Status papan(:|$)/ })).toBeTruthy();
});

test('tanpa tawaran relasi, chip Customer tidak dirender', async () => {
  dto.options.groups = {};
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  expect(screen.queryByRole('button', { name: /^Customer(:|$)/ })).toBeNull();
});

test.each([404, 429])('status %i: satu pesan seragam tanpa membuka sebab', async (status) => {
  failStatus = status;
  await renderInRouter(<Harness />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Tautan tidak berlaku atau terlalu banyak permintaan');
  expect(screen.queryByRole('heading', { name: 'Rekap Mingguan' })).toBeNull();
});

test('filter ditolak server (400): pesan filter dengan tombol hapus filter', async () => {
  failStatus = 400;
  await renderInRouter(<Harness initial={{ bu: ['asing'] }} />);
  expect(await screen.findByText('Filter tidak dapat diterapkan')).toBeTruthy();
  failStatus = null;
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter' }));
  expect(await screen.findByRole('heading', { name: 'Rekap Mingguan' })).toBeTruthy();
});

test('meta robots noindex dan referrer no-referrer terpasang, lalu dilepas', async () => {
  const view = await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
    'noindex',
  );
  expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe(
    'no-referrer',
  );
  view.unmount();
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
});

test('hanya memanggil rute publik, tidak pernah /api/v1', async () => {
  await renderInRouter(<Harness />);
  await screen.findByRole('heading', { name: 'Rekap Mingguan' });
  const urls = callsTo().map(([url]) => url);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.every((url) => url.startsWith('/api/public/dashboards/'))).toBe(true);
});
