import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ActionButton } from './action-button';

describe('ActionButton', () => {
  it('aksi hapus: label, warna, gaya, ikon bawaan', () => {
    render(<ActionButton action="delete" />);
    const b = screen.getByRole('button', { name: 'Hapus' });
    expect(b).toHaveAttribute('data-color', 'destructive');
    expect(b).toHaveAttribute('data-variant', 'soft');
    expect(b.querySelector('svg')).not.toBeNull();
  });

  it('compact: ikon saja, nama aksesibel dari label, tooltip saat hover', async () => {
    render(<ActionButton action="edit" compact label="Ubah Asus RT-AX55" />);
    const b = screen.getByRole('button', { name: 'Ubah Asus RT-AX55' });
    expect(b).toHaveTextContent('');
    expect(b).toHaveAttribute('data-variant', 'ghost');
    await userEvent.hover(b);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Ubah Asus RT-AX55');
  });

  it('busy: nonaktif dan berlabel Menyimpan…', () => {
    render(<ActionButton action="save" busy />);
    const b = screen.getByRole('button', { name: /Menyimpan…/ });
    expect(b).toBeDisabled();
  });

  it('label menimpa teks bawaan', () => {
    render(<ActionButton action="create" label="Tambah item" />);
    expect(screen.getByRole('button', { name: 'Tambah item' })).toBeInTheDocument();
  });
});
