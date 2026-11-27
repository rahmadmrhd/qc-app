import type { PostelSettingsDto, StickerSettingsDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense, useReducer } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route } from './settings';

// Halaman memakai search param `tab` dan navigasi tumpukan: keduanya diganti keadaan lokal sederhana.
const nav = vi.hoisted(() => ({
  search: {} as { tab?: string | undefined },
  bump: () => {},
  pop: vi.fn(),
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  useNavigate: () => (options: { search: (prev: { tab?: string }) => { tab?: string } }) => {
    nav.search = options.search(nav.search);
    nav.bump();
  },
}));
vi.mock('@/hooks/use-stack-navigation', () => ({ useStackNavigation: () => ({ pop: nav.pop }) }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ME = {
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: {
    access: 'none',
    item: 'none',
    qrcode: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
    sticker: 'manage',
    stickerstock: 'none',
  },
  businessUnits: [],
  locations: [],
};

let stickerState: StickerSettingsDto;
let postelState: PostelSettingsDto;

beforeEach(() => {
  nav.search = { tab: undefined };
  nav.pop.mockReset();
  vi.spyOn(Route, 'useSearch').mockImplementation(() => nav.search as never);
  apiMock.mockReset();
  stickerState = {
    alert: { enabled: false, recipients: [], cc: [], bcc: [], digestHour: 8, intervalDays: 1 },
    types: [{ id: 't1', name: 'QC Hijau', systemKind: '', defaultMinQty: 0 }],
    updatedAt: 'sticker-v1',
    smtpConfigured: true,
  };
  postelState = {
    alert: {
      enabled: false,
      recipients: [],
      cc: [],
      bcc: [],
      sendHour: 8,
      thresholds: [90, 60, 30],
      repeatEveryDays: 7,
    },
    updatedAt: 'postel-v1',
    smtpConfigured: true,
  };
  apiMock.mockImplementation((id: string, input: { alert?: unknown }) => {
    switch (id) {
      case 'auth.me':
        return Promise.resolve(ME);
      case 'stickerSettings.get':
        return Promise.resolve(stickerState);
      case 'postelSettings.get':
        return Promise.resolve(postelState);
      case 'stickerSettings.save':
        stickerState = { ...stickerState, updatedAt: 'sticker-v2' };
        return Promise.resolve(stickerState);
      case 'postelSettings.save':
        postelState = {
          ...postelState,
          alert: input.alert as PostelSettingsDto['alert'],
          updatedAt: 'postel-v2',
        };
        return Promise.resolve(postelState);
      default:
        return Promise.reject(new Error(`tak terduga: ${id}`));
    }
  });
});

/** Komponen rute dipecah otomatis (lazy): dimuat dulu agar render pertama langsung memakai isinya. */
async function mount() {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [, force] = useReducer((count: number) => count + 1, 0);
    nav.bump = force;
    return (
      <Suspense fallback={<p>memuat</p>}>
        <Component />
      </Suspense>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Host />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const openTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

// Label yang sama ada di dua panel (keduanya tetap ter-mount): dicari di dalam bagian Ringkasan stok (lewat judulnya;
// `hidden: true` karena panel yang tak aktif disembunyikan), bukan lewat urutan kemunculan.
const hourField = () =>
  within(
    screen
      .getByRole('heading', { name: 'Ringkasan harian stok menipis dan habis', hidden: true })
      .closest('section') as HTMLElement,
  ).getByLabelText('Jam kirim (WIB)');

const calls = (id: string) => apiMock.mock.calls.filter(([name]) => name === id).length;

test('menyimpan peringatan Postel tidak mereset draf Ringkasan stok', async () => {
  await mount();
  await screen.findByRole('tab', { name: 'Ringkasan stok' });
  const hour = hourField();
  await userEvent.clear(hour);
  await userEvent.type(hour, '11');
  await openTab('Peringatan Postel');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '3');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('postelSettings.save')).toBe(1));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'postelSettings.save',
      expect.objectContaining({ expectedUpdatedAt: 'postel-v1' }),
    ),
  );
  // form Postel dimuat ulang dari hasil simpan (versi baru), draf stok tetap utuh dan tanpa simpan stok
  expect(hourField()).toHaveValue(11);
  expect(calls('stickerSettings.save')).toBe(0);
  expect(screen.getByLabelText('Ulangi setiap (hari)')).toHaveValue(3);
});

test('menyimpan Ringkasan stok tidak mereset draf peringatan Postel dan tak mengirim defaults', async () => {
  await mount();
  await screen.findByRole('tab', { name: 'Ringkasan stok' });
  await openTab('Peringatan Postel');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '3');
  const first = screen.getByLabelText('Pengingat 1 (hari sebelum habis)');
  await userEvent.clear(first);
  await userEvent.type(first, '120');
  // Simpan di tab pengaturan stok hanya menyimpan pengaturan stok.
  await openTab('Ringkasan stok');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('stickerSettings.save')).toBe(1));
  const saved = apiMock.mock.calls.find(([name]) => name === 'stickerSettings.save');
  expect(saved?.[1]).not.toHaveProperty('defaults');
  // katalog stiker dimuat ulang (versi baru); pengaturan Postel tidak ikut dimuat ulang dan draf-nya tetap
  await waitFor(() => expect(calls('stickerSettings.get')).toBeGreaterThanOrEqual(2));
  expect(calls('postelSettings.get')).toBe(1);
  expect(calls('postelSettings.save')).toBe(0);
  expect(screen.getByLabelText('Ulangi setiap (hari)')).toHaveValue(3);
  expect(screen.getByLabelText('Pengingat 1 (hari sebelum habis)')).toHaveValue(120);
});

test('berpindah tab menulis search param tab (replace) dan Batal kembali ke daftar Stiker', async () => {
  await mount();
  await screen.findByRole('tab', { name: 'Ringkasan stok' });
  await openTab('Peringatan Postel');
  expect(nav.search.tab).toBe('postel');
  await openTab('Ringkasan stok');
  expect(nav.search.tab).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(nav.pop).toHaveBeenCalledWith({ to: '/sticker' });
});

test('tab lama "minimum" di URL jatuh ke Ringkasan stok tanpa galat', async () => {
  nav.search = { tab: 'minimum' };
  vi.spyOn(Route, 'useSearch').mockImplementation(() => nav.search as never);
  const validate = Route.options.validateSearch as unknown as (search: Record<string, unknown>) => {
    tab?: string;
  };
  const parsed = validate({ tab: 'minimum' });
  expect(parsed.tab).toBeUndefined();
  nav.search = parsed;
  await mount();
  expect(await screen.findByRole('tab', { name: 'Ringkasan stok', selected: true })).toBeVisible();
});
