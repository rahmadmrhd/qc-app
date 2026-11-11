import type { QrVersionDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { VersionHistory } from './version-history';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const version = (over: Partial<QrVersionDto>): QrVersionDto => ({
  stickerId: 's1',
  version: 1,
  name: 'PBE M5-400 v1',
  status: 'deprecated',
  reason: '',
  createdAt: '2026-11-10T03:00:00.000Z',
  createdBy: 'a@x.com',
  fileId: null,
  total: 0,
  ...over,
});

function renderHistory(canViewImages = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VersionHistory designId="d1" canViewImages={canViewImages} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

test('menampilkan v2 di atas v1 dengan nama, status, alasan, dan pembuat', async () => {
  apiMock.mockResolvedValue([
    version({
      stickerId: 's2',
      version: 2,
      name: 'PBE M5-400 v2',
      status: 'active',
      reason: 'Logo diganti',
    }),
    version({ stickerId: 's1', version: 1 }),
  ]);
  renderHistory();
  const items = await screen.findAllByRole('listitem');
  expect(apiMock).toHaveBeenCalledWith('qrcodes.versions', { id: 'd1' });
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('v2');
  expect(items[0]).toHaveTextContent('PBE M5-400 v2');
  expect(items[0]).toHaveTextContent('Aktif');
  expect(items[0]).toHaveTextContent('Logo diganti');
  expect(items[1]).toHaveTextContent('v1');
  expect(items[1]).toHaveTextContent('Usang');
  expect(items[1]).toHaveTextContent('a@x.com');
});

test('tanpa versi: keterangan belum ada stiker; tanpa hak baca gambar: placeholder, bukan permintaan berkas', async () => {
  apiMock.mockResolvedValueOnce([]);
  const first = renderHistory();
  expect(await screen.findByText(/Belum ada stiker Manual Book/)).toBeInTheDocument();
  first.unmount();
  apiMock.mockResolvedValueOnce([version({ fileId: 'f1' })]);
  renderHistory(false);
  const row = await screen.findByRole('listitem');
  expect(within(row).getByLabelText('Gambar contoh tidak ditampilkan')).toBeInTheDocument();
  expect(apiMock).not.toHaveBeenCalledWith('files.get', expect.anything());
});
