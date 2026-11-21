import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

// Rute daftar Serah Terima: filter (status, customer, tampilan) = replace; membuka View/form/Tambah = push.
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerNavigate: vi.fn(),
  props: undefined as undefined | Record<string, (...args: never[]) => void>,
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  useNavigate: () => state.navigate,
  useRouter: () => ({ navigate: state.routerNavigate }),
}));
vi.mock('@/modules/handover/components/handover-board-page', () => ({
  HandoverBoardPage: (props: Record<string, (...args: never[]) => void>) => {
    state.props = props;
    return (
      <div>
        <button type="button" onClick={() => props.onStatusChange?.('done' as never)}>
          status
        </button>
        <button type="button" onClick={() => props.onDeletedChange?.(true as never)}>
          terhapus
        </button>
        <button type="button" onClick={() => props.onClearCustomer?.()}>
          hapus-customer
        </button>
        <button type="button" onClick={() => props.onOpen?.('h1' as never)}>
          buka
        </button>
        <button type="button" onClick={() => props.onEdit?.('h1' as never)}>
          ubah
        </button>
        <button type="button" onClick={() => props.onCreate?.()}>
          tambah
        </button>
      </div>
    );
  },
}));

import { Route } from './index';

const mount = async (search: Record<string, unknown>) => {
  vi.spyOn(Route, 'useSearch').mockReturnValue(search as never);
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  render(
    <Suspense fallback={<p>memuat</p>}>
      <Component />
    </Suspense>,
  );
  await screen.findByRole('button', { name: 'status' });
};

beforeEach(() => {
  state.navigate.mockReset();
  state.routerNavigate.mockReset();
  state.props = undefined;
});

test('filter status dan tampilan Terhapus mengganti entri riwayat dan membawa filter lain', async () => {
  await mount({ loc: 'loc-b', customer: 'c1' });
  await userEvent.click(screen.getByRole('button', { name: 'status' }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: '/handover',
    search: { status: 'done', loc: 'loc-b', customer: 'c1' },
    replace: true,
  });
  await userEvent.click(screen.getByRole('button', { name: 'terhapus' }));
  expect(state.navigate).toHaveBeenLastCalledWith({
    to: '/handover',
    search: { loc: 'loc-b', customer: 'c1', deleted: true },
    replace: true,
  });
  await userEvent.click(screen.getByRole('button', { name: 'hapus-customer' }));
  expect(state.navigate).toHaveBeenLastCalledWith({
    to: '/handover',
    search: { loc: 'loc-b' },
    replace: true,
  });
});

test('membuka View, form ubah, dan form tambah memakai push (bukan replace) dan membawa filter papan', async () => {
  await mount({ status: 'done', deleted: true });
  await userEvent.click(screen.getByRole('button', { name: 'buka' }));
  await waitFor(() =>
    expect(state.routerNavigate).toHaveBeenCalledWith({
      to: '/handover/$handoverId',
      params: { handoverId: 'h1' },
      search: { status: 'done', deleted: true },
      replace: false,
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'ubah' }));
  await waitFor(() =>
    expect(state.routerNavigate).toHaveBeenCalledWith({
      to: '/handover/$handoverId/edit',
      params: { handoverId: 'h1' },
      search: { status: 'done', deleted: true },
      replace: false,
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'tambah' }));
  await waitFor(() =>
    expect(state.routerNavigate).toHaveBeenCalledWith({ to: '/handover/new', replace: false }),
  );
  expect(state.navigate).not.toHaveBeenCalled();
});

test('papan menerima deleted dari search param', async () => {
  await mount({ deleted: true });
  expect(state.props?.deleted).toBe(true);
  expect(state.props?.status).toBe('all');
});
