import type { MeDto } from '@shared/contract';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pathname: '/',
  navigate: vi.fn(),
  mark: vi.fn(),
  api: vi.fn(),
  mobile: false,
  permissions: { item: 'view' } as Record<string, string>,
  sidebarEverOpened: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => state.navigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: state.permissions,
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
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => state.mobile }));

import { resetUnsavedChangesForTests, useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import type { GuideEntry, GuideStep } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';

function step(overrides: Partial<GuideStep> = {}): GuideStep {
  return { target: 'a', text: 'Teks langkah', advance: 'next', ...overrides };
}

function entryOf(steps: GuideStep[], overrides: Partial<GuideEntry> = {}): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Panduan uji',
    steps,
    ...overrides,
  };
}

function Starter({ entry }: { entry: GuideEntry }) {
  const tour = useTour();
  return (
    <button type="button" onClick={() => tour.start(entry)}>
      Mulai tur{tour.active ? ' (aktif)' : ''}
    </button>
  );
}

/** Halaman uji: tiga target, satu input yang tak boleh disentuh tur, dan tombol Mulai. */
function Page({ entry, extra }: { entry: GuideEntry; extra?: ReactNode }) {
  return (
    <TourProvider targetWaitMs={80} renderTip={(id) => <div data-testid="demo">demo {id}</div>}>
      <Starter entry={entry} />
      <button type="button" data-tour="a">
        Target A
      </button>
      <button type="button" data-tour="b">
        Target B
      </button>
      <input aria-label="Isian" data-tour="field" defaultValue="" />
      {extra}
    </TourProvider>
  );
}

async function startTour() {
  await userEvent.click(screen.getByRole('button', { name: /Mulai tur/ }));
  return screen.findByRole('dialog', { name: 'Panduan' });
}

// Pemuatan malas pertama (kompilasi modul) bisa lebih lama dari batas findBy bawaan; panaskan dulu.
beforeAll(async () => {
  await import('./tour-overlay');
}, 30_000);

beforeEach(() => {
  state.pathname = '/';
  state.mobile = false;
  state.permissions = { item: 'view' };
  state.sidebarEverOpened = false;
  state.navigate.mockReset();
  state.navigate.mockResolvedValue(undefined);
  state.mark.mockReset();
  state.mark.mockResolvedValue(undefined);
  state.api.mockReset();
});
afterEach(() => {
  resetUnsavedChangesForTests();
  for (const node of document.querySelectorAll('[data-late]')) node.remove();
});

describe('menyorot dan maju', () => {
  test('(a) start menyorot target dan kartu menampilkan teks langkah', async () => {
    render(<Page entry={entryOf([step({ text: 'Ini tombol A' })])} />);
    const dialog = await startTour();
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText('Ini tombol A')).toBeInTheDocument();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });

  test('(b) langkah next maju dengan tombol Lanjut dan berakhir dengan Selesai', async () => {
    render(
      <Page
        entry={entryOf([
          step({ text: 'Langkah satu' }),
          step({ target: 'b', text: 'Langkah dua' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Langkah satu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Langkah dua')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
  });

  test('ArrowRight memajukan langkah next', async () => {
    render(<Page entry={entryOf([step({ text: 'Satu' }), step({ target: 'b', text: 'Dua' })])} />);
    await startTour();
    await screen.findByText('Satu');
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('Dua')).toBeInTheDocument();
  });

  test('(c) langkah click maju otomatis saat target diklik', async () => {
    render(
      <Page
        entry={entryOf([
          step({ text: 'Klik A', advance: 'click' }),
          step({ target: 'b', text: 'Sesudah klik' }),
        ])}
      />,
    );
    await startTour();
    await screen.findByText('Klik A');
    expect(screen.queryByRole('button', { name: 'Lanjut' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Target A' }));
    const next = await screen.findByText('Sesudah klik');
    // Penjaga balapan: kartu langkah berikutnya tidak boleh sempat tampil lalu dibongkar (posisi sorotan lama).
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(next).toBeInTheDocument();
    expect(screen.getAllByText('Sesudah klik')).toHaveLength(1);
  });
});

describe('navigasi dan target', () => {
  test('(d) langkah dengan route berbeda menavigasi lalu menunggu target muncul', async () => {
    state.navigate.mockImplementation(async () => {
      setTimeout(() => {
        const late = document.createElement('button');
        late.dataset.tour = 'late';
        late.dataset.late = '1';
        document.body.append(late);
      }, 20);
    });
    render(
      <Page entry={entryOf([step({ target: 'late', route: '/item', text: 'Di halaman baru' })])} />,
    );
    await startTour();
    expect(await screen.findByText('Di halaman baru')).toBeInTheDocument();
    expect(state.navigate).toHaveBeenCalledWith({ to: '/item' });
  });

  test('StrictMode (efek dipanggil dua kali): tur berlangkah berrute lain tidak tertutup sendiri', async () => {
    state.navigate.mockImplementation(async () => {
      setTimeout(() => {
        const late = document.createElement('button');
        late.dataset.tour = 'late';
        late.dataset.late = '1';
        document.body.append(late);
      }, 20);
    });
    render(
      <StrictMode>
        <Page entry={entryOf([step({ target: 'late', route: '/item', text: 'Lintas halaman' })])} />
      </StrictMode>,
    );
    await startTour();
    expect(await screen.findByText('Lintas halaman')).toBeInTheDocument();
    // Penjaga: pemeriksaan "pengguna pindah halaman" tak boleh menutup tur hanya karena efeknya dijalankan ulang.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Lintas halaman')).toBeInTheDocument();
  });

  test('langkah yang menu pemicunya tak dirender dibuang di awal: nomor langkah tak melompat', async () => {
    render(
      <Page
        entry={entryOf([
          step({ text: 'Satu' }),
          step({ target: 'location-picker', text: 'Pemicu lokasi' }),
          step({ target: 'location-menu', buka: 'location-picker', text: 'Isi menu lokasi' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Satu')).toBeInTheDocument();
    expect(screen.getByText('Langkah 1 dari 1')).toBeInTheDocument();
  });

  test('tidak menavigasi bila sudah berada di route langkah', async () => {
    state.pathname = '/item';
    render(<Page entry={entryOf([step({ route: '/item', text: 'Sudah di sini' })])} />);
    await startTour();
    await screen.findByText('Sudah di sini');
    expect(state.navigate).not.toHaveBeenCalled();
  });

  test('(e) target tidak muncul dalam batas waktu: langkah dilewati dan tur tidak macet', async () => {
    render(
      <Page
        entry={entryOf([
          step({ target: 'hantu', text: 'Langkah hantu' }),
          step({ target: 'b', text: 'Langkah nyata' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Langkah nyata')).toBeInTheDocument();
    expect(screen.queryByText('Langkah hantu')).toBeNull();
  });

  test('semua target hilang: tur berhenti sendiri tanpa menulis penanda', async () => {
    render(<Page entry={entryOf([step({ target: 'hantu' }), step({ target: 'hantu2' })])} />);
    await userEvent.click(screen.getByRole('button', { name: /Mulai tur/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull(), {
      timeout: 2000,
    });
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('(f) langkah dengan izin tidak terpenuhi dilewati seluruhnya', async () => {
    render(
      <Page
        entry={entryOf([
          step({ text: 'Untuk semua' }),
          step({ target: 'b', text: 'Hanya admin', izin: { module: 'access', level: 'manage' } }),
        ])}
      />,
    );
    await startTour();
    await screen.findByText('Untuk semua');
    // Langkah admin gugur: yang pertama sekaligus terakhir.
    expect(screen.getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
    expect(screen.queryByText('Hanya admin')).toBeNull();
  });
});

describe('demo tip', () => {
  test('(g) langkah dengan tip menampilkan adegan demo di kartu', async () => {
    render(<Page entry={entryOf([step({ text: 'Lihat demo', tip: 'tip-handover-tempel-wa' })])} />);
    await startTour();
    expect(await screen.findByTestId('demo')).toHaveTextContent('demo tip-handover-tempel-wa');
  });

  test('langkah tanpa tip tidak menampilkan demo', async () => {
    render(<Page entry={entryOf([step()])} />);
    await startTour();
    await screen.findByText('Teks langkah');
    expect(screen.queryByTestId('demo')).toBeNull();
  });
});

describe('menutup dan menyelesaikan', () => {
  test('(h) Esc menutup tur tanpa menulis penanda', async () => {
    render(<Page entry={entryOf([step(), step({ target: 'b' })])} />);
    await startTour();
    await screen.findByText('Teks langkah');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('(h) tombol Tutup menutup tur tanpa menulis penanda', async () => {
    render(<Page entry={entryOf([step(), step({ target: 'b' })])} />);
    await startTour();
    await screen.findByText('Teks langkah');
    await userEvent.click(screen.getByRole('button', { name: 'Tutup panduan' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('(h) langkah terakhir memanggil mark(id, version, covers) tepat sekali', async () => {
    const entry = entryOf([step(), step({ target: 'b', text: 'Terakhir' })], {
      version: 3,
      covers: ['tip-handover-tempel-wa'],
    });
    render(<Page entry={entry} />);
    await startTour();
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    await screen.findByText('Terakhir');
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).toHaveBeenCalledTimes(1);
    expect(state.mark).toHaveBeenCalledWith('dasar-layout', 3, ['tip-handover-tempel-wa']);
  });

  test('panduan diturunkan tidak menulis penanda saat selesai (tak ada penanda tersimpan)', async () => {
    render(<Page entry={entryOf([step()], { id: 'perangkat-pwa', status: 'diturunkan' })} />);
    await startTour();
    await userEvent.click(await screen.findByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('gagal menulis penanda tidak membuat tur macet', async () => {
    state.mark.mockRejectedValue(new Error('offline'));
    render(<Page entry={entryOf([step()])} />);
    await startTour();
    await userEvent.click(await screen.findByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
  });
});

describe('hanya menyorot', () => {
  test('(i) tur tidak mengubah field dan tidak memanggil api', async () => {
    render(
      <Page
        entry={entryOf([
          step({ target: 'field', text: 'Isian ini', advance: 'next' }),
          step({ target: 'a', text: 'Tombol' }),
        ])}
      />,
    );
    await startTour();
    await screen.findByText('Isian ini');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await screen.findByText('Tombol');
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(screen.getByLabelText('Isian')).toHaveValue('');
    expect(state.api).not.toHaveBeenCalled();
  });

  test('langkah next menahan klik langsung ke target di bawah sorotan', async () => {
    render(<Page entry={entryOf([step({ text: 'Jangan tekan' })])} />);
    await startTour();
    await screen.findByText('Jangan tekan');
    expect(screen.getByTestId('tour-blocker')).toBeInTheDocument();
  });

  test('langkah click tidak memasang penahan klik', async () => {
    render(<Page entry={entryOf([step({ advance: 'click' })])} />);
    await startTour();
    await screen.findByText('Teks langkah');
    expect(screen.queryByTestId('tour-blocker')).toBeNull();
  });
});

describe('sidebar di layar sempit', () => {
  test('menekan kartu tur tidak sampai ke pendengar dokumen (agar Sheet modal tak menutup sendiri)', async () => {
    const onDocumentPointerDown = vi.fn();
    document.addEventListener('pointerdown', onDocumentPointerDown);
    try {
      render(<Page entry={entryOf([step({ text: 'Kartu uji' })])} />);
      await startTour();
      const card = (await screen.findByText('Kartu uji')).closest('[tabindex="-1"]') as HTMLElement;
      onDocumentPointerDown.mockClear();
      fireEvent.pointerDown(card);
      expect(onDocumentPointerDown).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Target B' }));
      expect(onDocumentPointerDown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    }
  });

  function SidebarProbe() {
    const { openMobile } = useSidebar();
    if (openMobile) state.sidebarEverOpened = true;
    return openMobile ? (
      <nav data-sidebar="sidebar">
        <button type="button" data-tour="menu-item">
          Item menu
        </button>
      </nav>
    ) : null;
  }

  test('membuka sidebar lebih dulu bila target menu belum ada di ponsel', async () => {
    state.mobile = true;
    render(
      <SidebarProvider>
        <Page
          entry={entryOf([step({ target: 'menu-item', text: 'Pilih menu ini', inSidebar: true })])}
          extra={<SidebarProbe />}
        />
      </SidebarProvider>,
    );
    await startTour();
    expect(await screen.findByText('Pilih menu ini')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Item menu' })).toBeInTheDocument();
  });

  test('M11: langkah yang bukan menu tidak membuka sidebar walau targetnya hilang', async () => {
    state.mobile = true;
    render(
      <SidebarProvider>
        <Page
          entry={entryOf([
            step({ target: 'hantu', text: 'Bukan menu' }),
            step({ target: 'b', text: 'Sesudah' }),
          ])}
          extra={<SidebarProbe />}
        />
      </SidebarProvider>,
    );
    await startTour();
    expect(await screen.findByText('Sesudah')).toBeInTheDocument();
    expect(state.sidebarEverOpened).toBe(false);
  });
});

describe('ketahanan mesin (putaran perbaikan review)', () => {
  function mountTour(entry: GuideEntry) {
    const view = render(<Page entry={entry} />);
    return { refresh: () => view.rerender(<Page entry={entry} />), view };
  }

  test('I1: pengguna pindah halaman sendiri = tur dibatalkan tanpa penanda dan tanpa navigasi', async () => {
    const { refresh } = mountTour(
      entryOf([
        step({ text: 'Langkah satu' }),
        step({ target: 'b', text: 'Langkah dua', route: '/lain' }),
      ]),
    );
    await startTour();
    await screen.findByText('Langkah satu');
    state.pathname = '/dipilih-pengguna';
    refresh();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('I1: perpindahan halaman yang dimulai mesin tidak membatalkan tur', async () => {
    state.navigate.mockImplementation(async ({ to }: { to: string }) => {
      state.pathname = to;
    });
    const { refresh } = mountTour(
      entryOf([
        step({ text: 'Langkah satu' }),
        step({ target: 'b', text: 'Langkah dua', route: '/lain' }),
      ]),
    );
    await startTour();
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    await screen.findByText('Langkah dua');
    refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Langkah dua')).toBeInTheDocument();
  });

  test('I1: halaman berubah akibat klik pengguna pada langkah click tidak membatalkan tur', async () => {
    state.navigate.mockResolvedValue(undefined);
    const { refresh } = mountTour(
      entryOf([
        step({ text: 'Klik A', advance: 'click' }),
        step({ target: 'b', text: 'Di halaman tujuan', route: '/tujuan' }),
      ]),
    );
    await startTour();
    await screen.findByText('Klik A');
    await userEvent.click(screen.getByRole('button', { name: 'Target A' }));
    state.pathname = '/tujuan';
    refresh();
    expect(await screen.findByText('Di halaman tujuan')).toBeInTheDocument();
  });

  test('M1: daftar langkah dibekukan saat mulai; izin dicabut di tengah tur tidak mengubah kartu', async () => {
    const { refresh } = mountTour(
      entryOf([
        step({ text: 'Langkah satu', izin: { module: 'item', level: 'view' } }),
        step({ target: 'b', text: 'Langkah dua' }),
      ]),
    );
    await startTour();
    await screen.findByText('Langkah satu');
    state.permissions = {};
    refresh();
    expect(screen.getByText('Langkah satu')).toBeInTheDocument();
    expect(screen.getByText('Langkah 1 dari 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Langkah dua')).toBeInTheDocument();
  });

  test('M1: tur tanpa langkah yang berlaku menutup diri (tidak ada active tanpa kartu)', async () => {
    state.permissions = {};
    render(<Page entry={entryOf([step({ izin: { module: 'item', level: 'view' } })])} />);
    await userEvent.click(screen.getByRole('button', { name: /Mulai tur/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Mulai tur' })).toBeInTheDocument();
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('M2: navigasi yang melempar galat melewati langkah, tur tidak macet', async () => {
    state.navigate.mockRejectedValueOnce(new Error('ditolak'));
    mountTour(
      entryOf([
        step({ target: 'a', text: 'Gagal pindah', route: '/rusak' }),
        step({ target: 'b', text: 'Berikutnya' }),
      ]),
    );
    await startTour();
    expect(await screen.findByText('Berikutnya')).toBeInTheDocument();
    expect(screen.queryByText('Gagal pindah')).toBeNull();
  });

  function DirtyForm() {
    useUnsavedChanges(true);
    return null;
  }

  test('M13: formulir berdraf: mulai dari langkah pertama yang ada di halaman ini, tanpa menavigasi keluar', async () => {
    state.pathname = '/form';
    render(
      <Page
        extra={<DirtyForm />}
        entry={entryOf([
          step({ target: 'hantu', text: 'Papan', route: '/' }),
          step({ target: 'a', text: 'Ada di sini' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Ada di sini')).toBeInTheDocument();
    expect(screen.queryByText('Papan')).toBeNull();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  test('M13: formulir berdraf: langkah yang menuntut pindah halaman dilewati (draf tak dibuang)', async () => {
    state.pathname = '/form';
    render(
      <Page
        extra={<DirtyForm />}
        entry={entryOf([
          step({ target: 'a', text: 'Di halaman ini' }),
          step({ target: 'b', text: 'Di halaman lain', route: '/lain' }),
          step({ target: 'field', text: 'Terakhir di sini' }),
        ])}
      />,
    );
    await startTour();
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Terakhir di sini')).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  test('M13: tanpa draf, mulai dari langkah pertama dan menavigasi bila perlu', async () => {
    mountTour(
      entryOf([step({ target: 'a', text: 'Pertama', route: '/mulai' }), step({ target: 'b' })]),
    );
    await startTour();
    await screen.findByText('Pertama');
    expect(state.navigate).toHaveBeenCalledWith({ to: '/mulai' });
  });

  test('M10: fokus kembali ke elemen semula saat tur ditutup', async () => {
    mountTour(entryOf([step(), step({ target: 'b' })]));
    const starter = screen.getByRole('button', { name: /Mulai tur/ });
    await userEvent.click(starter);
    await screen.findByText('Teks langkah');
    expect(document.activeElement).not.toBe(starter);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(document.activeElement).toBe(starter);
  });

  test('M10: ArrowRight diabaikan saat fokus di kolom teks', async () => {
    mountTour(entryOf([step({ text: 'Satu' }), step({ target: 'b', text: 'Dua' })]));
    await startTour();
    await screen.findByText('Satu');
    screen.getByLabelText('Isian').focus();
    await userEvent.keyboard('{ArrowRight}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByText('Satu')).toBeInTheDocument();
    expect(screen.queryByText('Dua')).toBeNull();
  });
});

describe('langkah yang bergantung data jatuh ke kartu contoh (keputusan pemilik 2026-11-14)', () => {
  const missing = (overrides: Partial<GuideStep> = {}) =>
    step({
      target: 'tidak-ada',
      text: 'Teks sorotan',
      teksJikaKosong: 'Papan masih kosong, ini contoh kartunya:',
      tip: 'tip-contoh',
      ...overrides,
    });

  test('target tak muncul: kartu di tengah layar tanpa sorotan, menampilkan demo dan teks pengganti', async () => {
    render(<Page entry={entryOf([missing()])} />);
    await startTour();
    const text = await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    expect(screen.queryByText('Teks sorotan')).toBeNull();
    expect(screen.queryByTestId('tour-highlight')).toBeNull();
    expect(screen.getByTestId('demo')).toHaveTextContent('demo tip-contoh');
    const card = text.closest('[tabindex="-1"]') as HTMLElement;
    expect(card.style.top).toBe('50%');
    expect(card.style.left).toBe('50%');
  });

  test('papan yang baru termuat belakangan: kartu contoh beralih ke sorotan target asli', async () => {
    render(<Page entry={entryOf([missing()])} />);
    await startTour();
    await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    const late = document.createElement('button');
    late.dataset.tour = 'tidak-ada';
    late.dataset.late = '1';
    document.body.append(late);
    expect(await screen.findByText('Teks sorotan')).toBeInTheDocument();
    expect(screen.queryByText('Papan masih kosong, ini contoh kartunya:')).toBeNull();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });

  test('dua langkah berturut-turut bertarget kosong sama: keduanya jatuh ke kartu contoh', async () => {
    render(
      <Page
        entry={entryOf([
          missing({ text: 'Satu' }),
          missing({ text: 'Dua', teksJikaKosong: 'Masih kosong juga:' }),
        ])}
      />,
    );
    await startTour();
    await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Masih kosong juga:')).toBeInTheDocument();
    expect(screen.getByText('Langkah 2 dari 2')).toBeInTheDocument();
  });

  test('langsung: kartu pengganti tampil seketika tanpa menunggu batas waktu target', async () => {
    render(<Page entry={entryOf([missing({ langsung: true })])} />);
    await startTour();
    // Batas tunggu di tes ini 80 ms: tanpa `langsung`, kartu pengganti baru muncul sesudahnya.
    await waitFor(
      () =>
        expect(screen.getByText('Papan masih kosong, ini contoh kartunya:')).toBeInTheDocument(),
      { timeout: 40, interval: 5 },
    );
    expect(screen.queryByTestId('tour-highlight')).toBeNull();
  });

  test('langsung tanpa teksJikaKosong: langkah bersyarat dilewati seketika bila targetnya tak ada', async () => {
    render(
      <Page
        entry={entryOf([
          step({ target: 'tidak-ada', text: 'Bersyarat', langsung: true }),
          step({ target: 'b', text: 'Berikutnya' }),
        ])}
      />,
    );
    await startTour();
    await waitFor(() => expect(screen.getByText('Berikutnya')).toBeInTheDocument(), {
      timeout: 40,
      interval: 5,
    });
    expect(screen.queryByText('Bersyarat')).toBeNull();
  });

  test('langsung dengan target yang ada: tetap disorot seperti biasa', async () => {
    render(<Page entry={entryOf([missing({ target: 'a', langsung: true })])} />);
    await startTour();
    expect(await screen.findByText('Teks sorotan')).toBeInTheDocument();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });

  test('tur tidak macet: Lanjut maju, dan selesai menulis penanda seperti biasa', async () => {
    render(<Page entry={entryOf([missing(), step({ target: 'b', text: 'Sesudahnya' })])} />);
    await startTour();
    await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    expect(screen.getByText('Langkah 1 dari 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Sesudahnya')).toBeInTheDocument();
    expect(screen.getByText('Langkah 2 dari 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).toHaveBeenCalledWith('dasar-layout', 1, undefined);
  });

  test('langkah click tanpa target tetap bisa dimajukan (ArrowRight), tanpa petunjuk klik', async () => {
    render(
      <Page
        entry={entryOf([missing({ advance: 'click' }), step({ target: 'b', text: 'Sesudahnya' })])}
      />,
    );
    await startTour();
    await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    expect(screen.queryByText(/Klik bagian yang disorot/)).toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('Sesudahnya')).toBeInTheDocument();
  });

  test('Esc menutup tur dari kartu contoh tanpa menulis penanda', async () => {
    render(<Page entry={entryOf([missing()])} />);
    await startTour();
    await screen.findByText('Papan masih kosong, ini contoh kartunya:');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).not.toHaveBeenCalled();
  });

  test('target ada: sorotan nyata dipakai dengan teks langkah, bukan teks pengganti', async () => {
    render(<Page entry={entryOf([missing({ target: 'a' })])} />);
    await startTour();
    expect(await screen.findByText('Teks sorotan')).toBeInTheDocument();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
    expect(screen.queryByText('Papan masih kosong, ini contoh kartunya:')).toBeNull();
  });

  test('tanpa teksJikaKosong langkah yang targetnya hilang tetap dilewati diam-diam', async () => {
    render(
      <Page
        entry={entryOf([
          step({ target: 'tidak-ada', text: 'Hilang' }),
          step({ target: 'b', text: 'Berikutnya' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Berikutnya')).toBeInTheDocument();
    expect(screen.queryByText('Hilang')).toBeNull();
  });

  test('langkah yang izinnya gugur dibuang di awal: tak ada kartu contoh', async () => {
    render(
      <Page
        entry={entryOf([
          missing({ izin: { module: 'access', level: 'manage' } }),
          step({ target: 'b', text: 'Berikutnya' }),
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Berikutnya')).toBeInTheDocument();
    expect(screen.getByText('Langkah 1 dari 1')).toBeInTheDocument();
    expect(screen.queryByText('Papan masih kosong, ini contoh kartunya:')).toBeNull();
  });
});

/** Penyedia "pekerjaan pengguna": tombol yang memunculkan/menyembunyikan elemen `gate` (seperti bagian form yang muncul setelah item dipilih). */
function GateToggle({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        Kerjakan
      </button>
      {open ? <div data-tour="gate">Bagian baru</div> : null}
    </>
  );
}

describe('langkah wait: pengguna mengerjakan sendiri, Lanjut aktif setelah waitFor muncul', () => {
  const waiting = (overrides: Partial<GuideStep> = {}) =>
    step({ text: 'Kerjakan dulu', advance: 'wait', waitFor: 'gate', ...overrides });

  test('Lanjut nonaktif sampai elemen waitFor muncul, lalu aktif dan maju', async () => {
    render(
      <Page
        entry={entryOf([waiting(), step({ target: 'b', text: 'Sesudahnya' })])}
        extra={<GateToggle />}
      />,
    );
    await startTour();
    await screen.findByText('Kerjakan dulu');
    const next = screen.getByRole('button', { name: 'Lanjut' });
    expect(next).toBeDisabled();
    expect(screen.getByText(/Kerjakan dulu bagian yang disorot/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kerjakan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled());
    expect(screen.getByText('Sudah beres, tekan Lanjut.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Sesudahnya')).toBeInTheDocument();
  });

  test('target tidak ditutup penahan dan halaman tidak digelapkan (pengguna bekerja di dalamnya)', async () => {
    render(<Page entry={entryOf([waiting(), step({ target: 'b' })])} extra={<GateToggle />} />);
    await startTour();
    await screen.findByText('Kerjakan dulu');
    expect(screen.queryByTestId('tour-blocker')).toBeNull();
    expect(screen.getByTestId('tour-highlight').style.boxShadow).toBe('');
    // Target dapat diklik pengguna (tanpa penahan di atasnya).
    await userEvent.click(screen.getByRole('button', { name: 'Target A' }));
    expect(screen.getByText('Kerjakan dulu')).toBeInTheDocument();
  });

  test('elemen waitFor sudah ada saat langkah mulai: Lanjut langsung aktif', async () => {
    render(
      <Page entry={entryOf([waiting(), step({ target: 'b' })])} extra={<GateToggle initial />} />,
    );
    await startTour();
    await screen.findByText('Kerjakan dulu');
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled();
  });

  test('elemen waitFor hilang lagi (pekerjaan dibatalkan): Lanjut nonaktif lagi', async () => {
    render(
      <Page entry={entryOf([waiting(), step({ target: 'b' })])} extra={<GateToggle initial />} />,
    );
    await startTour();
    await screen.findByText('Kerjakan dulu');
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Kerjakan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled());
  });

  test('ArrowRight hanya memajukan setelah waitFor muncul', async () => {
    render(
      <Page
        entry={entryOf([waiting(), step({ target: 'b', text: 'Sesudahnya' })])}
        extra={<GateToggle />}
      />,
    );
    await startTour();
    await screen.findByText('Kerjakan dulu');
    await userEvent.keyboard('{ArrowRight}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Sesudahnya')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Kerjakan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled());
    // Fokus ada di tombol "Kerjakan" (bukan kolom teks): panah kanan memajukan langkah.
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('Sesudahnya')).toBeInTheDocument();
  });

  test('tur tidak mengisi apa pun dan tidak memanggil api pada langkah wait', async () => {
    render(
      <Page
        entry={entryOf([waiting({ target: 'field' }), step({ target: 'b' })])}
        extra={<GateToggle />}
      />,
    );
    await startTour();
    await screen.findByText('Kerjakan dulu');
    expect(screen.getByLabelText('Isian')).toHaveValue('');
    expect(state.api).not.toHaveBeenCalled();
  });
});
