import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { CustomerCombobox } from './customer-combobox';

const customers = [
  { id: 'c1', name: 'PT Maju Jaya' },
  { id: 'c2', name: 'Budi Santoso' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <CustomerCombobox id="cust" value={value} onChange={setValue} customers={customers} />;
}

test('mengetik menampilkan saran toleran; memilih saran mengisi nama resmi', async () => {
  render(<Harness />);
  const input = screen.getByLabelText('Customer');
  await userEvent.type(input, 'maju');
  const option = await screen.findByRole('option', { name: 'PT Maju Jaya' });
  await userEvent.click(option);
  expect(input).toHaveValue('PT Maju Jaya');
});

test('nama yang belum ada: petunjuk customer baru akan dibuat; tidak memblokir', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'Perusahaan Baru');
  expect(screen.getByText(/Customer baru "Perusahaan Baru" akan dibuat/)).toBeInTheDocument();
});

test('ejaan berbeda dari customer yang ada: petunjuk memakai ejaan resmi', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'pt. maju  jaya');
  expect(screen.getByText(/Memakai customer yang sudah ada: "PT Maju Jaya"/)).toBeInTheDocument();
});

test('nama mirip (bukan sama): "Mirip: X, pakai ini?" dapat diklik', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'Budi Santso');
  const similar = await screen.findByRole('button', { name: 'Pakai Budi Santoso' });
  await userEvent.click(similar);
  expect(screen.getByLabelText('Customer')).toHaveValue('Budi Santoso');
});

test('tanpa ketikan tidak ada saran maupun petunjuk', () => {
  render(<Harness />);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.queryByText(/Customer baru/)).toBeNull();
});

test('Enter di isian customer TIDAK mengirim form; panah + Enter memilih saran', async () => {
  const submitted = vi.fn();
  function InForm() {
    const [value, setValue] = useState('');
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <CustomerCombobox id="cust" value={value} onChange={setValue} customers={customers} />
      </form>
    );
  }
  render(<InForm />);
  const input = screen.getByLabelText('Customer');
  await userEvent.type(input, 'maju{Enter}');
  expect(submitted).not.toHaveBeenCalled();
  expect(input).toHaveValue('maju'); // Enter tanpa panah tidak memilih saran
  await userEvent.keyboard('{ArrowDown}');
  expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('cust-option-0'));
  await userEvent.keyboard('{Enter}');
  expect(input).toHaveValue('PT Maju Jaya');
  expect(submitted).not.toHaveBeenCalled();
});

test('opsi saran tidak ikut urutan Tab (hanya panah) dan Escape menutup daftar', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'maju');
  const option = await screen.findByRole('option', { name: 'PT Maju Jaya' });
  expect(option).toHaveAttribute('tabindex', '-1');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('C.V. dan CV dianggap customer yang sama (ejaan resmi dipakai)', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'p.t. maju jaya');
  expect(screen.getByText(/Memakai customer yang sudah ada: "PT Maju Jaya"/)).toBeInTheDocument();
});

test('customer task saat ini (mungkin nonaktif) tidak disebut "baru akan dibuat" (M3)', async () => {
  function Edit() {
    const [value, setValue] = useState('Customer Lama');
    return (
      <CustomerCombobox
        id="cust"
        value={value}
        onChange={setValue}
        customers={customers}
        currentName="Customer Lama"
      />
    );
  }
  render(<Edit />);
  expect(screen.queryByText(/Customer baru/)).toBeNull();
  expect(screen.getByText(/Customer saat ini/)).toBeInTheDocument();
});
