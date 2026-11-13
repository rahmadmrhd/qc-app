import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
  const paste = (text: string) =>
    fireEvent.change(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' }), {
      target: { value: text },
    });
  const split = async (text: string) => {
    paste(text);
    await userEvent.click(screen.getByRole('button', { name: 'Pecah' }));
  };
  return { onAdd, paste, split };
}

test('empat contoh pemilik langsung ditambahkan 1, 2, 1, 3 task dengan usulan customer', async () => {
  const expected: Array<[string, number, string[]]> = [
    [EX1, 1, ['Orderan Online']],
    [EX2, 2, ['CV.Prisma', 'HND Gemilang']],
    [EX3, 1, ['Orderan Pak OKY']],
    [EX4, 3, ['Lintasmaya', 'Mitra Tower', 'CV. Tepian']],
  ];
  for (const [text, count, names] of expected) {
    const { onAdd, split } = setup();
    await split(text);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0]?.[0] as Array<{ customerName: string }>;
    expect(added).toHaveLength(count);
    expect(added.map((task) => task.customerName)).toEqual(names);
    expect(screen.getByText(`${count} task ditambahkan ke batch.`)).toBeInTheDocument();
    document.body.innerHTML = '';
  }
});

test('Pecah menyerahkan customer usulan dan catatan checklist tanpa langkah tambahan', async () => {
  const { onAdd, split } = setup();
  await split(EX1);
  expect(onAdd).toHaveBeenCalledWith([
    { customerName: 'Orderan Online', note: '- [ ] CRS310 = 1 unt\n- [ ] RB5009UG = 1 unt' },
  ]);
  expect(screen.queryByRole('button', { name: /Tambahkan ke batch/ })).not.toBeInTheDocument();
});

test('tempelan dikosongkan setelah ditambahkan', async () => {
  const { split } = setup();
  await split(EX1);
  expect(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' })).toHaveValue('');
});

test('tempelan kosong tidak menambah task', async () => {
  const { onAdd, split } = setup();
  await split('   ');
  expect(screen.getByText('Tidak ada task yang dikenali dari tempelan.')).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});

test('hasil melebihi sisa slot batch tidak ditambahkan dan tempelan dipertahankan', async () => {
  const { onAdd, split } = setup(2);
  await split(EX4);
  expect(screen.getByRole('alert')).toHaveTextContent(/3 task, melebihi sisa slot batch: 2/);
  expect(onAdd).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' })).toHaveValue(EX4);
});

test('mengubah tempelan menghapus pesan status sebelumnya', async () => {
  const { paste, split } = setup();
  await split(EX1);
  expect(screen.getByText('1 task ditambahkan ke batch.')).toBeInTheDocument();
  paste('baru');
  expect(screen.queryByText('1 task ditambahkan ke batch.')).not.toBeInTheDocument();
});
