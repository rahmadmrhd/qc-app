import type { MeDto } from '@shared/contract';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Komponen Radix NYATA (DropdownMenu dan Popover) di jsdom; hanya hal di luar menu yang di-mock.
const state = vi.hoisted(() => ({ mark: vi.fn(), pathname: '/' }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: {},
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));
vi.mock('../../lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: new Map(), mark: state.mark, reset: vi.fn() }),
}));

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTourMenu } from '../../lib/tour-menu';
import type { GuideEntry, GuideStep } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';

function ThemeMenu() {
  const menu = useTourMenu('theme-toggle');
  return (
    <DropdownMenu {...menu.rootProps}>
      <DropdownMenuTrigger asChild>
        <Button data-tour="theme-toggle">Tema</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menu.contentProps} data-tour="theme-menu">
        <DropdownMenuItem>Terang</DropdownMenuItem>
        <DropdownMenuItem>Gelap</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BellMenu() {
  const menu = useTourMenu('notification-bell');
  return (
    <Popover {...menu.rootProps}>
      <PopoverTrigger asChild>
        <Button data-tour="notification-bell">Lonceng</Button>
      </PopoverTrigger>
      <PopoverContent {...menu.contentProps} data-tour="notification-menu">
        <p>Daftar kabar</p>
      </PopoverContent>
    </Popover>
  );
}

function step(overrides: Partial<GuideStep>): GuideStep {
  return { target: 'theme-toggle', text: 'Teks', advance: 'next', ...overrides };
}

function entryOf(steps: GuideStep[]): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Uji menu',
    steps,
  };
}

let startTour: (entry: GuideEntry) => void = () => undefined;
function Capture() {
  startTour = useTour().start;
  return null;
}

function Page({ withTheme = true }: { withTheme?: boolean }) {
  return (
    <TourProvider targetWaitMs={150}>
      <Capture />
      {withTheme ? <ThemeMenu /> : null}
      <BellMenu />
    </TourProvider>
  );
}

function start(entry: GuideEntry) {
  act(() => startTour(entry));
}

beforeAll(async () => {
  await import('./tour-overlay');
}, 30_000);

beforeEach(() => {
  state.pathname = '/';
  state.mark.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  document.body.style.pointerEvents = '';
});

const itemVisible = () => screen.queryByRole('menuitem', { name: 'Terang' });

describe('tur membuka menu sendiri', () => {
  test('langkah ber-buka membuka menu dropdown tanpa klik pengguna dan menyorot isinya', async () => {
    render(<Page />);
    expect(itemVisible()).toBeNull();
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Pilihan tema' })]));
    expect(await screen.findByText('Pilihan tema', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(itemVisible()).toBeInTheDocument();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });

  test('langkah ber-buka juga membuka Popover', async () => {
    render(<Page />);
    start(
      entryOf([step({ buka: 'notification-bell', target: 'notification-menu', text: 'Kabar' })]),
    );
    expect(await screen.findByText('Kabar')).toBeInTheDocument();
    expect(screen.getByText('Daftar kabar')).toBeInTheDocument();
  });

  test('kartu tur tetap dapat diklik dan menu tidak menutup sendiri (non-modal, body tak terkunci)', async () => {
    render(<Page />);
    start(
      entryOf([
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Satu' }),
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Dua' }),
      ]),
    );
    await screen.findByText('Satu');
    expect(document.body.style.pointerEvents).not.toBe('none');
    // userEvent menolak mengklik elemen ber-pointer-events: none; berhasil = kartu memang dapat diklik.
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Dua')).toBeInTheDocument();
    expect(itemVisible()).toBeInTheDocument();
  });

  test('menekan kartu atau fokus pindah ke kartu tidak menutup menu', async () => {
    render(<Page />);
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Kartu' })]));
    const text = await screen.findByText('Kartu');
    await userEvent.click(text);
    (text.closest('[tabindex="-1"]') as HTMLElement).focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(itemVisible()).toBeInTheDocument();
  });

  test('langkah berikutnya tanpa buka menutup menu', async () => {
    render(<Page />);
    start(
      entryOf([
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Terbuka' }),
        step({ target: 'notification-bell', text: 'Tanpa menu' }),
      ]),
    );
    await screen.findByText('Terbuka');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Tanpa menu')).toBeInTheDocument();
    await waitFor(() => expect(itemVisible()).toBeNull());
  });

  test('menu ditutup tur saat langkah berganti: fokus tidak dicuri kembali ke tombol pemicu', async () => {
    render(<Page />);
    start(
      entryOf([
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Terbuka' }),
        step({ target: 'notification-bell', text: 'Tanpa menu' }),
      ]),
    );
    await screen.findByText('Terbuka');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    const card = (await screen.findByText('Tanpa menu')).closest('[tabindex="-1"]') as HTMLElement;
    await waitFor(() => expect(itemVisible()).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(card.contains(document.activeElement)).toBe(true);
  });

  test('pindah dari satu menu ke menu lain: yang lama menutup, yang baru terbuka', async () => {
    render(<Page />);
    start(
      entryOf([
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Langkah tema' }),
        step({ buka: 'notification-bell', target: 'notification-menu', text: 'Kabar' }),
      ]),
    );
    await screen.findByText('Langkah tema');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Kabar')).toBeInTheDocument();
    expect(screen.getByText('Daftar kabar')).toBeInTheDocument();
    await waitFor(() => expect(itemVisible()).toBeNull());
  });

  test('Selesai mengembalikan menu ke keadaan semula (tertutup)', async () => {
    render(<Page />);
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Terakhir' })]));
    await screen.findByText('Terakhir');
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    await waitFor(() => expect(itemVisible()).toBeNull());
    expect(state.mark).toHaveBeenCalled();
  });

  test('Esc menutup tur dan menu sekaligus', async () => {
    render(<Page />);
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Esc uji' })]));
    await screen.findByText('Esc uji');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    await waitFor(() => expect(itemVisible()).toBeNull());
  });

  test('tombol Tutup pada kartu menutup tur dan menu', async () => {
    render(<Page />);
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Tutup uji' })]));
    await screen.findByText('Tutup uji');
    await userEvent.click(screen.getByRole('button', { name: 'Tutup panduan' }));
    await waitFor(() => expect(itemVisible()).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('menu yang sudah dibuka pengguna sendiri tetap terbuka setelah tur selesai', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Tema' }));
    expect(await screen.findByRole('menuitem', { name: 'Terang' })).toBeInTheDocument();
    start(entryOf([step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Sudah terbuka' })]));
    await screen.findByText('Sudah terbuka');
    expect(itemVisible()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(itemVisible()).toBeInTheDocument();
  });

  test('pemicu menu tidak ada di layar: langkah dilewati tanpa menunggu', async () => {
    render(<Page withTheme={false} />);
    const t0 = Date.now();
    start(
      entryOf([
        step({ buka: 'theme-toggle', target: 'theme-menu', text: 'Tanpa pemicu' }),
        step({ target: 'notification-bell', text: 'Berikutnya' }),
      ]),
    );
    expect(await screen.findByText('Berikutnya')).toBeInTheDocument();
    expect(screen.queryByText('Tanpa pemicu')).toBeNull();
    // Dilewati segera, bukan setelah menunggu batas waktu target (150 ms pada uji ini).
    expect(Date.now() - t0).toBeLessThan(140);
  });

  test('tanpa tur menu bekerja seperti biasa (dibuka dan ditutup pengguna)', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Tema' }));
    expect(await screen.findByRole('menuitem', { name: 'Terang' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(itemVisible()).toBeNull());
  });
});
