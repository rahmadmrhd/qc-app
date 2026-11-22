import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * Menu "Aksi lainnya" (tombol ⋯) halaman View: aksi di luar tiga aksi utama (`PRIMARY_ACTIONS_MAX`) hanya ada di dalamnya,
 * di desktop maupun ponsel. Membuka menu lalu mengklik butir bernama `name` (butir grup datar berlabel singkat).
 */
export async function clickMoreAction(name: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

/** Nama semua butir menu "Aksi lainnya" (menu dibuka lalu ditutup lagi dengan Escape). */
export async function moreActionNames(): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
  const names = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return names;
}

/** Tidak ada tombol "Aksi lainnya" (semua aksi tampil sebagai aksi utama atau tak ada sisa). */
export function hasNoMoreActions(): boolean {
  return screen.queryByRole('button', { name: 'Aksi lainnya' }) === null;
}
