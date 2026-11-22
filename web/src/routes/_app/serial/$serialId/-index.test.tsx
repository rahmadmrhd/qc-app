import { isRedirect } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ serialId: 's1', search: {} as Record<string, string> }));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: () => (options: { component: () => unknown }) => ({
    options,
    useParams: () => ({ serialId: state.serialId }),
    useSearch: () => state.search,
  }),
  useNavigate: () => vi.fn(),
  getRouteApi: () => ({ useParams: () => ({ serialId: state.serialId }) }),
}));
vi.mock('@/modules/auth/permissions', () => ({ requireAnyPermission: vi.fn() }));
vi.mock('@/hooks/use-stack-navigation', () => ({
  useStackNavigation: () => ({ push: vi.fn(), replace: vi.fn(), pop: vi.fn() }),
}));
// Halaman detail diganti kerangka dengan state lokal (mewakili pesan yang diketik di komposer).
vi.mock('@/modules/serial/components/serial-detail-page', () => ({
  SerialDetailPage: ({ serialId, tab }: { serialId: string; tab?: string }) => {
    const [draft, setDraft] = useState('');
    return (
      <div>
        <span>serial {serialId}</span>
        <span>tab {tab ?? 'bawaan'}</span>
        <input
          aria-label="Pesan"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));
vi.mock('@/modules/serial/queries', () => ({ serialDetailQueryOptions: vi.fn() }));

import { Route } from './index';

// Komponen rute dipecah otomatis (lazy): dimuat dulu agar render pertama langsung memakai isinya.
const Component = (
  Route as unknown as { options: { component: ComponentType & { preload?: () => Promise<void> } } }
).options.component;
const tree = () => (
  <Suspense fallback={<p>memuat</p>}>
    <Component />
  </Suspense>
);

beforeEach(() => {
  state.serialId = 's1';
  state.search = {};
});

test('berpindah ke serial lain memasang ulang halaman: state komposer tidak terbawa', async () => {
  await Component.preload?.();
  const { rerender } = render(tree());
  await userEvent.type(screen.getByLabelText('Pesan'), 'draf untuk s1');
  expect(screen.getByLabelText('Pesan')).toHaveValue('draf untuk s1');
  state.serialId = 's2';
  rerender(tree());
  expect(screen.getByText('serial s2')).toBeInTheDocument();
  expect(screen.getByLabelText('Pesan')).toHaveValue('');
});

test('?tab eksplisit menentukan tab; tanpa tab memakai bawaan', async () => {
  await Component.preload?.();
  state.search = { tab: 'foto' };
  const first = render(tree());
  expect(screen.getByText('tab foto')).toBeInTheDocument();
  first.unmount();
  state.search = {};
  render(tree());
  expect(screen.getByText('tab bawaan')).toBeInTheDocument();
});

test('?case (tautan lama) dialihkan ke halaman detail laporan; tanpa ?case tidak ada pengalihan', async () => {
  const { beforeLoad } = (
    Route as unknown as {
      options: {
        beforeLoad: (args: { context: unknown; search: { case?: string } }) => Promise<void>;
      };
    }
  ).options;
  const context = { queryClient: {} };
  const thrown = await beforeLoad({ context, search: { case: 'c1' } }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(isRedirect(thrown)).toBe(true);
  expect((thrown as { options: unknown }).options).toMatchObject({
    to: '/serial/reports/$caseId',
    params: { caseId: 'c1' },
    replace: true,
  });
  await expect(beforeLoad({ context, search: {} })).resolves.toBeUndefined();
});
