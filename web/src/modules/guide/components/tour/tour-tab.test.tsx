import type { MeDto } from '@shared/contract';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pathname: '/',
  navigate: vi.fn(),
  mark: vi.fn(),
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
      permissions: { qrcode: 'edit' },
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
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

import { resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { FormTabs } from '@/components/page/form-tabs';
import { ViewPage } from '@/components/page/view-page';
import type { GuideEntry, GuideStep } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';

function entryOf(steps: GuideStep[]): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Panduan tab',
    steps,
  };
}

function Starter({ entry }: { entry: GuideEntry }) {
  const tour = useTour();
  return (
    <button type="button" onClick={() => tour.start(entry)}>
      Mulai tur
    </button>
  );
}

/** Form dengan tiga tab; target `qr-logo` hanya di tab Logo (panel tersembunyi `hidden`, tetap ter-mount). */
function Page({ entry, onTab }: { entry: GuideEntry; onTab?: (id: string) => void }) {
  return (
    <TourProvider targetWaitMs={80}>
      <Starter entry={entry} />
      <FormTabs
        {...(onTab ? { onValueChange: onTab } : {})}
        tabs={[
          { id: 'item', label: 'Item', content: <div data-tour="qr-items">item</div> },
          { id: 'logo', label: 'Logo', content: <div data-tour="qr-logo">logo</div> },
          { id: 'ukuran', label: 'Ukuran', content: <div data-tour="qr-size">ukuran</div> },
        ]}
      />
    </TourProvider>
  );
}

beforeAll(async () => {
  await import('./tour-overlay');
}, 30_000);
beforeEach(() => {
  state.pathname = '/';
  state.navigate.mockReset();
  state.navigate.mockResolvedValue(undefined);
  state.mark.mockReset();
  state.mark.mockResolvedValue(undefined);
});
afterEach(() => resetUnsavedChangesForTests());

async function startTour() {
  await userEvent.click(screen.getByRole('button', { name: 'Mulai tur' }));
  return screen.findByRole('dialog', { name: 'Panduan' });
}

describe('langkah buka: { tab }', () => {
  test('mengaktifkan tab Logo sebelum menyorot qr-logo, lewat jalur pilih tab yang sama', async () => {
    const onTab = vi.fn();
    render(
      <Page
        onTab={onTab}
        entry={entryOf([
          { target: 'qr-logo', text: 'Ini logo', advance: 'next', buka: { tab: 'logo' } },
        ])}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Item' })).toHaveAttribute('aria-selected', 'true');
    await startTour();
    expect(await screen.findByText('Ini logo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Logo' })).toHaveAttribute('aria-selected', 'true');
    expect(onTab).toHaveBeenCalledWith('logo');
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });

  test('target di tab tersembunyi tanpa buka tidak disorot (langkah dilewati), langkah berikutnya tetap jalan', async () => {
    render(
      <Page
        entry={entryOf([
          { target: 'qr-logo', text: 'Logo tersembunyi', advance: 'next' },
          { target: 'qr-items', text: 'Item terlihat', advance: 'next' },
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Item terlihat')).toBeInTheDocument();
    expect(screen.queryByText('Logo tersembunyi')).toBeNull();
    // Tab Logo tidak dibuka diam-diam oleh langkah tanpa `buka`.
    expect(screen.getByRole('tab', { name: 'Item' })).toHaveAttribute('aria-selected', 'true');
  });

  test('tab berpindah antar langkah: Logo lalu Ukuran', async () => {
    render(
      <Page
        entry={entryOf([
          { target: 'qr-logo', text: 'Langkah logo', advance: 'next', buka: { tab: 'logo' } },
          { target: 'qr-size', text: 'Langkah ukuran', advance: 'next', buka: { tab: 'ukuran' } },
        ])}
      />,
    );
    await startTour();
    expect(await screen.findByText('Langkah logo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(await screen.findByText('Langkah ukuran')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Ukuran' })).toHaveAttribute('aria-selected', 'true'),
    );
  });
});

describe('langkah buka: { tab } pada ViewPage (hanya tab aktif ter-mount)', () => {
  function ViewHost({ entry, onTab }: { entry: GuideEntry; onTab: (id: string) => void }) {
    return (
      <TourProvider targetWaitMs={80}>
        <Starter entry={entry} />
        <ViewPage
          title="Serial"
          onTabChange={onTab}
          tabs={[
            { id: 'detail', label: 'Detail', content: <div data-tour="serial-stepper">tahap</div> },
            {
              id: 'riwayat',
              label: 'Riwayat',
              content: <div data-tour="serial-timeline">linimasa</div>,
            },
          ]}
        />
      </TourProvider>
    );
  }

  test('target di tab yang belum ter-mount: tabnya dibuka lewat jalur pilih yang sama, lalu disorot', async () => {
    const onTab = vi.fn();
    render(
      <ViewHost
        onTab={onTab}
        entry={entryOf([
          {
            target: 'serial-timeline',
            text: 'Ini linimasa',
            advance: 'next',
            buka: { tab: 'riwayat' },
          },
        ])}
      />,
    );
    expect(document.querySelector('[data-tour="serial-timeline"]')).toBeNull();
    await startTour();
    expect(await screen.findByText('Ini linimasa')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Riwayat' })).toHaveAttribute('aria-selected', 'true');
    expect(onTab).toHaveBeenCalledWith('riwayat');
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument();
  });
});
