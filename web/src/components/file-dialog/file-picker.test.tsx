import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FilePicker } from './file-picker';

const ACCEPT = ['image/png', 'application/pdf'];
const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

test('memilih berkas: yang sah dan yang ditolak dipisah menurut tipe', async () => {
  const onFiles = vi.fn();
  render(
    <FilePicker accept={ACCEPT} multiple onFiles={onFiles}>
      Telusuri
    </FilePicker>,
  );
  const input = screen.getByTestId('file-picker-input') as HTMLInputElement;
  expect(input.accept).toBe('image/png,application/pdf');
  expect(input.multiple).toBe(true);
  await userEvent.upload(input, [file('a.png', 'image/png'), file('b.gif', 'image/gif')], {
    applyAccept: false,
  });
  expect(onFiles).toHaveBeenCalledTimes(1);
  const [files, rejected] = onFiles.mock.calls[0] ?? [];
  expect(files.map((f: File) => f.name)).toEqual(['a.png']);
  expect(rejected).toEqual([
    { name: 'b.gif', reason: 'Format GIF tidak didukung (hanya PNG, PDF)' },
  ]);
});

test('tombol memakai children sebagai label dan nonaktif bila disabled', () => {
  render(
    <FilePicker accept={ACCEPT} disabled onFiles={vi.fn()} className="x">
      Pilih PDF
    </FilePicker>,
  );
  expect(screen.getByRole('button', { name: 'Pilih PDF' })).toBeDisabled();
});

test('anyType: berkas jenis apa pun diteruskan tanpa pemisahan dan input tanpa atribut accept', async () => {
  const onFiles = vi.fn();
  render(
    <FilePicker accept={[]} anyType onFiles={onFiles}>
      Pilih berkas
    </FilePicker>,
  );
  const input = screen.getByTestId('file-picker-input') as HTMLInputElement;
  expect(input.hasAttribute('accept')).toBe(false);
  await userEvent.upload(input, [file('system.npk', 'application/octet-stream')]);
  expect(onFiles).toHaveBeenCalledTimes(1);
  const [files, rejected] = onFiles.mock.calls[0] ?? [];
  expect(files.map((f: File) => f.name)).toEqual(['system.npk']);
  expect(rejected).toEqual([]);
});
