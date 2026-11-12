import { render } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { resetPwaUpdateForTests, usePwaUpdateSnapshotForTests } from '@/app/pwa/update';
import { ErrorView } from './error-view';

beforeEach(() => {
  resetPwaUpdateForTests();
});

test('galat muat potongan rute menyalakan status versi baru (spanduk)', () => {
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/qrcode-x.js');
  render(<ErrorView error={error} reset={() => undefined} info={{ componentStack: '' }} />);
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
});

test('galat biasa tidak menyalakan status versi baru', () => {
  render(
    <ErrorView error={new Error('Gagal')} reset={() => undefined} info={{ componentStack: '' }} />,
  );
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
});
