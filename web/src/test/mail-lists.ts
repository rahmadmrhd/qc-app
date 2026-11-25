import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Label field pada `MailListsFields` (dipakai tes agar tak menyalin teks). */
export const TO_FIELD = 'Kepada (To)';
export const CC_FIELD = 'Tembusan (CC)';
export const BCC_FIELD = 'Tembusan tersembunyi (BCC)';

/**
 * Menambah alamat ke salah satu daftar penerima dengan cara pengguna: ketik alamat di kolomnya lalu tekan Enter (jadi
 * chip). `field` = label kolom (`TO_FIELD`, `CC_FIELD`, `BCC_FIELD`).
 */
export async function addMailAddress(field: string, address: string) {
  const input = screen.getByRole('combobox', { name: field });
  await userEvent.click(input);
  await userEvent.type(input, `${address}{Enter}`);
}

/** Mengetik di kolom tanpa menekan Enter (untuk menegaskan pesan bantu alamat tak sah). */
export async function typeInMailField(field: string, text: string) {
  const input = screen.getByRole('combobox', { name: field });
  await userEvent.click(input);
  await userEvent.type(input, text);
}
