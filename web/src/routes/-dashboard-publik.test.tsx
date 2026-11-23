import { expect, test, vi } from 'vitest';

type RouteOptions = { beforeLoad?: unknown; loader?: unknown; component: unknown };
const captured = vi.hoisted(() => ({ path: '', options: null as RouteOptions | null }));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: (path: string) => (options: RouteOptions) => {
    captured.path = path;
    captured.options = options;
    return { options, useParams: () => ({ token: 't' }), useSearch: () => ({}), fullPath: path };
  },
  useNavigate: () => vi.fn(),
}));
vi.mock('@/modules/dashboard-public/public-page', () => ({
  PublicDashboardPage: () => null,
}));

import './dashboard-publik.$token';

test('route publik /dashboard-publik/$token di luar layout _app: tanpa beforeLoad (auth.me/login) dan tanpa loader', () => {
  expect(captured.path).toBe('/dashboard-publik/$token');
  expect(captured.options?.beforeLoad).toBeUndefined();
  expect(captured.options?.loader).toBeUndefined();
  expect(typeof captured.options?.component).toBe('function');
});
