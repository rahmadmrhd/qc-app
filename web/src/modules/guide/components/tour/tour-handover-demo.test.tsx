import type { LocationAccessDto, MeDto } from '@shared/contract';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Mesin tur + katalog Serah Terima NYATA + adegan demo NYATA (dimuat malas): papan kosong = kartu contoh.
const state = vi.hoisted(() => ({ mark: vi.fn(), withCard: false }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/handover' } }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: {},
      locations: [
        {
          id: 'L1',
          code: 'L1',
          name: 'L1',
          permissions: { handover: 'view', qc: 'edit' },
        } as unknown as LocationAccessDto,
      ],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: ['L1'], toggle: () => undefined }),
}));
vi.mock('../../lib/use-guide-store', () => ({
  useGuideStore: () => ({ ready: true, done: new Map(), mark: state.mark, reset: vi.fn() }),
}));

import { HANDOVER_DASAR } from '../../catalog/handover';
import '../../catalog'; // mendaftarkan pemuat adegan tip
import type { GuideEntry } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';
import { renderTourTip } from './tour-tip';

function Starter({ entry }: { entry: GuideEntry }) {
  const tour = useTour();
  return (
    <button type="button" onClick={() => tour.start(entry)}>
      Mulai tur
    </button>
  );
}

// Hanya tiga langkah yang bergantung data kartu task (checklist umum, komentar, centang QC).
const ENTRY: GuideEntry = {
  ...HANDOVER_DASAR,
  steps: HANDOVER_DASAR.steps.filter((step) => step.target === 'handover-checklist'),
};

function Page() {
  return (
    <TourProvider targetWaitMs={100} renderTip={renderTourTip}>
      <Starter entry={ENTRY} />
      {state.withCard ? <div data-tour="handover-checklist">Kartu task asli</div> : null}
    </TourProvider>
  );
}

beforeAll(async () => {
  await import('./tour-overlay');
}, 30_000);

beforeEach(() => {
  state.withCard = false;
  state.mark.mockReset().mockResolvedValue(undefined);
});

const find = (text: string | RegExp) => screen.findByText(text, {}, { timeout: 8000 });

describe('papan kosong: tiga langkah checklist/komentar jatuh ke kartu contoh dengan demo', () => {
  test('tiga langkah, masing-masing kartu tengah layar dengan demo tip-nya; tak melompat; penanda ditulis', async () => {
    expect(ENTRY.steps).toHaveLength(3);
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Mulai tur' }));

    // 1) checklist
    expect(await find(/Papan masih kosong.*checklist seperti contoh ini/)).toBeInTheDocument();
    expect(screen.queryByTestId('tour-highlight')).toBeNull();
    expect(screen.getByText('Langkah 1 dari 3')).toBeInTheDocument();
    expect(
      await find('Isi catatan task berupa checklist, satu butir per barang.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));

    // 2) komentar
    expect(
      await find(/memilih sepotong teks di catatan lalu memberi komentar/),
    ).toBeInTheDocument();
    expect(screen.getByText('Langkah 2 dari 3')).toBeInTheDocument();
    expect(
      await find('Pilih sepotong teks di catatan, nanti muncul tombol Balas.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));

    // 3) centang sisi QC
    expect(await find(/sisi QC mencentang butir/)).toBeInTheDocument();
    expect(screen.getByText('Langkah 3 dari 3')).toBeInTheDocument();
    expect(
      await find('Isi catatan task berupa checklist, satu butir per barang.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull());
    expect(state.mark).toHaveBeenCalledWith('handover-dasar', 1, undefined);
  }, 40_000);

  test('papan berisi: sorotan nyata dipakai dengan teks langkah, bukan teks pengganti', async () => {
    state.withCard = true;
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Mulai tur' }));
    expect(
      await find(/Isi catatan task berupa checklist: satu butir per baris/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
    expect(screen.queryByText(/Papan masih kosong/)).toBeNull();
  });
});
