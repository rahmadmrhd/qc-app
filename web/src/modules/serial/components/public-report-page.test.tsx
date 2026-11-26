import type { SerialPublicReportDto } from '@shared/serial-public';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Halaman publik tidak boleh memakai klien API berizin: ada sesi atau tidak, hanya `fetch` biasa.
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { PublicReportPage } from './public-report-page';

const TOKEN = 'v1.c1.1799999999.sig_abc-123';

const REPORT: SerialPublicReportDto = {
  number: 'LP/SBY/2611-0001',
  openedOn: '2026-11-13',
  closedOn: '2026-11-14',
  outcome: 'broken',
  expiresOn: '2026-12-14',
  viewerCanOpen: false,
  serialId: 's1',
  caseId: 'c1',
  unit: {
    serial: 'ABC123',
    itemLabel: 'Cisco C9200',
    buCode: 'BU1',
    buName: 'Satu',
    locationName: 'Surabaya',
    testDate: '2026-11-10',
    sample: false,
    status: 'broken',
  },
  events: [
    {
      seq: 5,
      type: 'report_failure',
      occurredOn: '2026-11-13',
      actorName: 'Budi',
      actorTeam: 'qc',
      message: 'Port 3 mati ![foto](qcfile:abc12345-1111-4222-8333-444455556666)',
      changes: [{ field: 'status', from: 'Lolos', to: 'Dilaporkan' }],
    },
    {
      seq: 9,
      type: 'declare_broken',
      occurredOn: '2026-11-14',
      actorName: 'Sari',
      actorTeam: 'service',
      message: 'Mainboard rusak. Lihat [panduan](https://contoh.example/panduan)',
      changes: [],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
const onOpenSerial = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicReportPage token={TOKEN} onOpenSerial={onOpenSerial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  onOpenSerial.mockReset();
  fetchMock = vi.fn(async () => jsonResponse(REPORT));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Buka kelompok "riwayat sebelumnya" (tertutup sejak awal; hanya riwayat saat ini yang terbuka). */
async function expandAll() {
  for (const button of screen.queryAllByRole('button', { name: /^Tampilkan riwayat sebelumnya/ })) {
    await userEvent.click(button);
  }
}

test('menampilkan nomor LP, hasil, detail unit, masa berlaku, dan linimasa tanpa tombol aksi', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' })).toBeInTheDocument();
  expect(screen.getByText('Rusak', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
  expect(screen.getByText(/Tautan ini berlaku sampai 14 Des 2026/)).toBeInTheDocument();
  const unit = screen.getByRole('region', { name: 'Unit' });
  expect(within(unit).getByText('ABC123')).toBeInTheDocument();
  expect(within(unit).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(unit).getByText('BU1 - Satu')).toBeInTheDocument();
  expect(within(unit).getByText('Surabaya')).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Linimasa' });
  // Hanya riwayat saat ini (seq 9) yang tampil sejak awal; riwayat sebelumnya dilipat jadi satu kelompok.
  expect(within(list).queryByText('Status: Lolos → Dilaporkan')).toBeNull();
  await expandAll();
  expect(within(list).getByText('Dilaporkan rusak')).toBeInTheDocument();
  expect(within(list).getByText('Dinyatakan rusak')).toBeInTheDocument();
  expect(within(list).getByText('Status: Lolos → Dilaporkan')).toBeInTheDocument();
  // Nomor LP mengisi rincian kejadian (data mentah tidak dikirim server): bukan "Laporan — dibuka".
  expect(within(list).getByText('Laporan LP/SBY/2611-0001 dibuka')).toBeInTheDocument();
  expect(within(list).getByText('Laporan LP/SBY/2611-0001 ditutup: rusak')).toBeInTheDocument();
  // Lama di atas (seq naik); tanpa badge Terbaru dan tanpa stempel "dicatat".
  const seqs = within(list)
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-seq'))
    .filter(Boolean);
  expect(seqs).toEqual(['5', '9']);
  expect(screen.queryByText('Terbaru')).toBeNull();
  expect(screen.queryByText(/dicatat/)).toBeNull();
  // Hanya baca: tidak ada tombol aksi (hanya pelipat riwayat), field, atau tautan "Lapor".
  for (const button of screen.queryAllByRole('button')) {
    expect(button).toHaveAccessibleName(/riwayat/i);
  }
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(apiMock).not.toHaveBeenCalled();
});

test('memuat lewat fetch biasa ke rute publik: tanpa cache dan tanpa Referer', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(`/api/public/serial-reports/${TOKEN}`);
  expect(init.cache).toBe('no-store');
  expect(init.referrerPolicy).toBe('no-referrer');
});

test('gambar pesan memakai URL rute berkas bertoken, bukan klien berizin', async () => {
  const { container } = renderPage();
  await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' });
  await expandAll();
  const image = container.querySelector('img') as HTMLImageElement;
  expect(image.getAttribute('src')).toBe(
    `/api/public/serial-reports/${TOKEN}/files/abc12345-1111-4222-8333-444455556666`,
  );
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('tautan luar di catatan memakai noreferrer; meta referrer no-referrer dipasang dan dilepas', async () => {
  const { unmount } = renderPage();
  await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' });
  const link = screen.getByRole('link', { name: 'panduan' });
  expect(link.getAttribute('rel')).toContain('noreferrer');
  expect(
    document.head.querySelector('meta[name="referrer"][content="no-referrer"]'),
  ).not.toBeNull();
  unmount();
  expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
});

test('pemegang tautan berizin (viewerCanOpen) dialihkan ke halaman biasa tanpa menampilkan isi', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ...REPORT, viewerCanOpen: true }));
  renderPage();
  await waitFor(() => expect(onOpenSerial).toHaveBeenCalledWith('s1', 'c1'));
  expect(screen.queryByRole('heading', { name: 'LP/SBY/2611-0001' })).toBeNull();
});

test('tanpa viewerCanOpen tidak ada pengalihan', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' });
  expect(onOpenSerial).not.toHaveBeenCalled();
});

test.each([404, 429])(
  'status %s = satu pesan seragam: tautan tidak berlaku atau kedaluwarsa',
  async (status) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: status === 429 ? 'FORBIDDEN' : 'NOT_FOUND', title: 'x' }, status),
    );
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tautan tidak berlaku atau sudah kedaluwarsa');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading', { name: /LP\// })).toBeNull();
  },
);

test('galat jaringan atau 5xx tampil sebagai gagal memuat dengan Coba lagi, bukan tautan tidak berlaku', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('putus'));
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Laporan belum bisa dimuat');
  expect(alert).not.toHaveTextContent('Tautan tidak berlaku');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' })).toBeInTheDocument();
});

test('laporan yang masih terbuka: lencana Masih terbuka tanpa tanggal selesai', async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      ...REPORT,
      closedOn: null,
      outcome: null,
      unit: { ...REPORT.unit, status: 'at_service' },
    }),
  );
  renderPage();
  expect(await screen.findByText('Masih terbuka')).toBeInTheDocument();
  expect(screen.getByText('Di servis')).toBeInTheDocument();
  expect(screen.queryByText(/selesai/)).toBeNull();
});

test('foto bukti QC tidak pernah tampil di halaman publik, walau data kejadian membawanya', async () => {
  fetchMock.mockImplementation(async () =>
    jsonResponse({
      ...REPORT,
      events: REPORT.events.map((entry) => ({
        ...entry,
        proofPhotos: [
          {
            id: 'aaaaaaaa-1',
            state: 'done',
            mime: 'image/webp',
            size: 1,
            width: 1,
            height: 1,
            filename: 'bukti-aaaaaaaa.webp',
            error: null,
          },
        ],
      })),
    }),
  );
  const { container } = renderPage();
  await screen.findByRole('heading', { name: 'LP/SBY/2611-0001' });
  await expandAll();
  expect(screen.queryByText('Bukti foto QC')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Foto bukti QC' })).not.toBeInTheDocument();
  expect(container.querySelector('img[src*="serial-proofs"]')).toBeNull();
});
