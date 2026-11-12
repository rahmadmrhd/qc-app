import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const installMock = vi.hoisted(() => ({
  state: 'unavailable' as 'unavailable' | 'prompt' | 'ios-manual',
  install: vi.fn().mockResolvedValue(undefined),
}));
const logoutMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/pwa/install', () => ({
  useInstall: () => ({ state: installMock.state, install: installMock.install }),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () => ({ name: 'Rina', email: 'rina@qc.local' }),
}));
vi.mock('@/modules/auth/use-logout', () => ({ useLogout: () => logoutMock }));

import { UserMenu } from './user-menu';

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /Rina/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  installMock.state = 'unavailable';
});

test('butir Pasang aplikasi tidak tampil bila tidak tersedia', async () => {
  render(<UserMenu />);
  await openMenu();
  expect(await screen.findByRole('menuitem', { name: 'Keluar' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Pasang aplikasi' })).not.toBeInTheDocument();
});

test('status prompt: memilih Pasang aplikasi memanggil install', async () => {
  installMock.state = 'prompt';
  render(<UserMenu />);
  await openMenu();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pasang aplikasi' }));
  expect(installMock.install).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('status ios-manual: memilih Pasang aplikasi membuka petunjuk Bagikan lalu Tambahkan ke Layar Utama', async () => {
  installMock.state = 'ios-manual';
  render(<UserMenu />);
  await openMenu();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pasang aplikasi' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Bagikan');
  expect(dialog).toHaveTextContent('Tambahkan ke Layar Utama');
  expect(installMock.install).not.toHaveBeenCalled();
});

test('butir Keluar tetap berfungsi', async () => {
  installMock.state = 'prompt';
  render(<UserMenu />);
  await openMenu();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Keluar' }));
  expect(logoutMock).toHaveBeenCalledTimes(1);
});
