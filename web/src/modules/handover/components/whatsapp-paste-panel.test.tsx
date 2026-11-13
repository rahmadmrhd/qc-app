import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

// Editor catatan (Tiptap) menarik modul unggah gambar; tidak dipakai di mode catatan.
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { WhatsappPastePanel } from './whatsapp-paste-panel';

const EX1 = 'Orderan Online :\nCRS310 = 1 unt\nRB5009UG = 1 unt';
const EX2 = [
  '[22/10, 10.57] Mas_Aden JH: CV.Prisma :',
  'V1600GS-ZF = 200 unit',
  '[22/10, 11.01] Mas_Aden JH: HND Gemilang :',
  'VT-861 = 1 unit',
].join('\n');
const EX3 = [
  'Orderan Pak OKY - ',
  'CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)',
  'kirim via J&T Merah kalo bisa',
  '',
  'Mintol foto SN - Foto Unit sebelum packing & setelah packing',
].join('\n');
const EX4 = [
  'Lintasmaya :',
  'AF 5XHD = 16 unt',
  '',
  'Mitra Tower :',
  'RD-5G34 = 8 unt',
  '',
  'CV. Tepian :',
  'RD-5G34 = 5 unt',
  'POE 24-12W = 50 unt',
].join('\n');

function setup(remaining = 30) {
  const onAdd = vi.fn();
  render(<WhatsappPastePanel remaining={remaining} onAdd={onAdd} />);
  const split = async (text: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' }), {
      target: { value: text },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Pecah' }));
  };
  return { onAdd, split };
}

test('empat contoh pemilik terpecah 1, 2, 1, 3 task dengan usulan customer', async () => {
  const expected: Array<[string, number, string[]]> = [
    [EX1, 1, ['Orderan Online']],
    [EX2, 2, ['CV.Prisma', 'HND Gemilang']],
    [EX3, 1, ['Orderan Pak OKY']],
    [EX4, 3, ['Lintasmaya', 'Mitra Tower', 'CV. Tepian']],
  ];
  for (const [text, count, names] of expected) {
    const { split } = setup();
    await split(text);
    // Butir checklist di editor juga `listitem`, jadi baris dihitung lewat field customer tiap task.
    const customers = screen.getAllByLabelText(/^Customer task \d+$/);
    expect(customers).toHaveLength(count);
    names.forEach((name, i) => {
      expect(customers[i]).toHaveValue(name);
    });
    document.body.innerHTML = '';
  }
});

test('usulan customer dapat diganti sebelum ditambahkan', async () => {
  const { onAdd, split } = setup();
  await split(EX1);
  const input = screen.getByLabelText('Customer task 1');
  await userEvent.clear(input);
  await userEvent.type(input, 'PT Pengganti');
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan ke batch (1)' }));
  expect(onAdd).toHaveBeenCalledWith([
    { customerName: 'PT Pengganti', note: '- [ ] CRS310 = 1 unt\n- [ ] RB5009UG = 1 unt' },
  ]);
});

test('catatan hasil pecah tampil di editor Tiptap, bukan textarea mentah', async () => {
  const { split } = setup();
  await split(EX1);
  const note = await screen.findByRole('textbox', { name: 'Catatan task 1' });
  expect(note).toHaveAttribute('contenteditable', 'true');
  expect(note.tagName).not.toBe('TEXTAREA');
  // Markdown `- [ ]` dirender sebagai checklist, bukan teks mentah.
  await waitFor(() => expect(note).toHaveTextContent('CRS310 = 1 unt'));
  expect(note).not.toHaveTextContent('- [ ]');
});

test('catatan hasil pecah dapat disunting di editor sebelum ditambahkan', async () => {
  const { onAdd, split } = setup();
  await split(EX1);
  const note = await screen.findByRole('textbox', { name: 'Catatan task 1' });
  await userEvent.type(note, ' diganti');
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan ke batch (1)' }));
  const added = onAdd.mock.calls[0]?.[0][0];
  expect(added.note).toContain('diganti');
  expect(added.note).toContain('CRS310 = 1 unt');
});

test('tempelan kosong tidak menambah task', async () => {
  const { onAdd, split } = setup();
  await split('   ');
  expect(screen.queryByRole('button', { name: /Tambahkan ke batch/ })).not.toBeInTheDocument();
  expect(screen.getByText('Tidak ada task yang dikenali dari tempelan.')).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});

test('hasil melebihi sisa slot batch tidak dapat ditambahkan', async () => {
  const { onAdd, split } = setup(2);
  await split(EX4);
  expect(screen.getByRole('button', { name: 'Tambahkan ke batch (3)' })).toBeDisabled();
  expect(screen.getByText(/sisa slot batch: 2/)).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});
