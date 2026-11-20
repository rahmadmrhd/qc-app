import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

import { useAfterDelete } from './use-after-delete';

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.success.mockClear();
});

test('navigasi ke indeks induk dan toast "Dihapus" dengan aksi Pulihkan bila canRestore', () => {
  const onRestore = vi.fn();
  const { result } = renderHook(() =>
    useAfterDelete({ indexTo: '/item/brands', canRestore: true, onRestore }),
  );
  result.current();
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/item/brands', replace: true });
  const [message, options] = mocks.success.mock.calls[0] as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
  expect(message).toBe('Dihapus');
  expect(options.action.label).toBe('Pulihkan');
  options.action.onClick();
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test('tanpa canRestore toast tidak memuat aksi', () => {
  const { result } = renderHook(() =>
    useAfterDelete({ indexTo: '/item/brands', canRestore: false, onRestore: vi.fn() }),
  );
  result.current();
  expect(mocks.success).toHaveBeenCalledWith('Dihapus', undefined);
});
