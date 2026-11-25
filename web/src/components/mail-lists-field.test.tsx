import { emptyMailLists, type MailLists } from '@shared/mail-lists';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { addMailAddress, BCC_FIELD, CC_FIELD, TO_FIELD, typeInMailField } from '@/test/mail-lists';
import { MailListsFields, type RecipientSuggestion } from './mail-lists-field';

const USERS: RecipientSuggestion[] = [
  { name: 'Ani', email: 'ani@x.id' },
  { name: 'Budi', email: 'budi@x.id' },
  { name: 'Nonaktif', email: 'off@x.id', active: false },
];

let latest: MailLists = emptyMailLists();

function Harness({ initial = emptyMailLists(), max = 20 }: { initial?: MailLists; max?: number }) {
  const [value, setValue] = useState(initial);
  latest = value;
  return (
    <MailListsFields idPrefix="t" value={value} onChange={setValue} suggestions={USERS} max={max} />
  );
}

test('tiga kolom: Kepada, CC, dan BCC', () => {
  render(<Harness />);
  for (const name of [TO_FIELD, CC_FIELD, BCC_FIELD]) {
    expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
  }
});

test('mengetik alamat lalu Enter menjadi chip (huruf kecil) pada daftar yang dipilih', async () => {
  render(<Harness />);
  await addMailAddress(CC_FIELD, 'Orang@Luar.Com');
  expect(latest).toEqual({ recipients: [], cc: ['orang@luar.com'], bcc: [] });
  expect(screen.getByText('orang@luar.com')).toBeInTheDocument();
});

test('alamat tak sah: petunjuk tampil saat mengetik dan Enter tidak membuat chip', async () => {
  render(<Harness />);
  await typeInMailField(TO_FIELD, 'bukan-email');
  expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(latest.recipients).toEqual([]);
});

test('alamat yang sudah ada di daftar lain tidak ditawarkan lagi', async () => {
  render(<Harness initial={{ recipients: ['a@b.co'], cc: [], bcc: [] }} />);
  await typeInMailField(BCC_FIELD, 'a@b.co');
  expect(screen.queryByRole('option', { name: 'a@b.co' })).not.toBeInTheDocument();
});

test('saran pengguna aktif dapat dipilih; akun nonaktif tidak ditawarkan', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
  expect(names).toEqual(['Ani (ani@x.id)', 'Budi (budi@x.id)']);
  await userEvent.click(screen.getByRole('option', { name: 'Budi (budi@x.id)' }));
  expect(latest.recipients).toEqual(['budi@x.id']);
});

test('chip dapat dihapus', async () => {
  render(<Harness initial={{ recipients: [], cc: ['a@b.co'], bcc: [] }} />);
  const chip = screen.getByText('a@b.co').closest('[data-slot="chip"], span, li') as HTMLElement;
  const remove = within(chip.parentElement ?? chip).getByRole('button');
  await userEvent.click(remove);
  expect(latest.cc).toEqual([]);
});

test('batas alamat per daftar', async () => {
  render(<Harness initial={{ recipients: ['a@b.co'], cc: [], bcc: [] }} max={1} />);
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  expect(await screen.findByText(/Maksimal 1 pilihan/)).toBeInTheDocument();
});
