import { type screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Scope = Pick<typeof screen, 'getByRole' | 'findByRole'>;

/** Memilih opsi pada `LinkField`/`LinkMultiField`: buka daftar lewat combobox lalu klik opsinya. */
export async function pickLink(scope: Scope, field: string, option: string | RegExp) {
  await userEvent.click(scope.getByRole('combobox', { name: field }));
  await userEvent.click(await scope.findByRole('option', { name: option }));
}

/** Nama semua opsi yang tampil setelah combobox dibuka (untuk menegaskan opsi mana yang ditawarkan). */
export async function linkOptionNames(scope: Scope, field: string): Promise<string[]> {
  await userEvent.click(scope.getByRole('combobox', { name: field }));
  const listbox = await scope.findByRole('listbox', { name: field });
  return within(listbox)
    .queryAllByRole('option')
    .map((option) => option.textContent ?? '');
}
