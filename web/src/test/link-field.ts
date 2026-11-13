import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Scope = Pick<typeof screen, 'getByRole'>;

/**
 * Memilih opsi pada `LinkField`/`LinkMultiField`: buka daftar lewat combobox (dicari di `scope`) lalu klik opsinya.
 * Daftar saran dirender di `document.body` (portal, agar tidak terpotong dialog), jadi opsi dicari di seluruh dokumen.
 */
export async function pickLink(scope: Scope, field: string, option: string | RegExp) {
  await userEvent.click(scope.getByRole('combobox', { name: field }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** Memilih opsi pada `Select`/`MultiSelect` (komponen yang sama dasarnya dengan `LinkField`). */
export const pickSelect = pickLink;

/** Nama semua opsi yang tampil setelah combobox dibuka (untuk menegaskan opsi mana yang ditawarkan). */
export async function linkOptionNames(scope: Scope, field: string): Promise<string[]> {
  await userEvent.click(scope.getByRole('combobox', { name: field }));
  const listbox = await screen.findByRole('listbox', { name: field });
  return within(listbox)
    .queryAllByRole('option')
    .map((option) => option.textContent ?? '');
}

/** Alias `linkOptionNames` untuk `Select`. */
export const selectOptionNames = linkOptionNames;
