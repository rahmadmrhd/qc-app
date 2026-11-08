import type { ItemStickerDto } from '@shared/contract';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));

import { StickerListField } from './sticker-list-field';

function Harness({
  initial = [] as ItemStickerDto[],
  spy,
}: {
  initial?: ItemStickerDto[];
  spy?: (v: ItemStickerDto[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StickerListField
      value={value}
      onChange={(next) => {
        setValue(next);
        spy?.(next);
      }}
    />
  );
}

beforeEach(() => {
  uploadMock.mockReset();
});

test('menambah, mengisi, dan menghapus stiker', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.type(screen.getByLabelText('Nama stiker 1'), 'Label SNI');
  await userEvent.type(screen.getByLabelText('Catatan stiker 1'), 'Belakang');
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Label SNI', note: 'Belakang', fileId: null }]);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus stiker 1' }));
  expect(screen.queryByLabelText('Nama stiker 1')).not.toBeInTheDocument();
});

test('gambar contoh stiker: memilih mengunggah dan menampilkannya; dapat dihapus', async () => {
  uploadMock.mockResolvedValue('img1');
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Label', note: '', fileId: null }]} spy={spy} />);
  fireEvent.change(screen.getByLabelText('Gambar contoh stiker 1'), {
    target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] },
  });
  await waitFor(() =>
    expect(spy).toHaveBeenLastCalledWith([{ name: 'Label', note: '', fileId: 'img1' }]),
  );
  expect(document.querySelector('img')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus gambar contoh stiker 1' }));
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Label', note: '', fileId: null }]);
});

test('tombol tambah dinonaktifkan pada batas 30 stiker', () => {
  const thirty = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, note: '', fileId: null }));
  render(<Harness initial={thirty} />);
  expect(screen.getByRole('button', { name: 'Tambah stiker' })).toBeDisabled();
});

test('mengetik atau menghapus baris lain selama unggah tidak tertimpa; gambar jatuh ke baris yang benar', async () => {
  let resolveUpload: (id: string) => void = () => {};
  uploadMock.mockReturnValue(
    new Promise<string>((resolve) => {
      resolveUpload = resolve;
    }),
  );
  const spy = vi.fn();
  render(
    <Harness
      initial={[
        { name: 'A', note: '', fileId: null },
        { name: 'B', note: '', fileId: null },
      ]}
      spy={spy}
    />,
  );
  fireEvent.change(screen.getByLabelText('Gambar contoh stiker 2'), {
    target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] },
  });
  await userEvent.type(screen.getByLabelText('Catatan stiker 2'), 'kanan');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus stiker 1' }));
  resolveUpload('img9');
  await waitFor(() =>
    expect(spy).toHaveBeenLastCalledWith([{ name: 'B', note: 'kanan', fileId: 'img9' }]),
  );
});

test('baris stiker yang bermasalah menurut pesan galat diberi aria-invalid', () => {
  render(
    <StickerListField
      value={[
        { name: 'A', note: '', fileId: null },
        { name: '', note: '', fileId: null },
      ]}
      onChange={() => undefined}
      error="Stiker 2: nama wajib diisi"
    />,
  );
  expect(screen.getByLabelText('Nama stiker 2')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nama stiker 1')).not.toHaveAttribute('aria-invalid', 'true');
});
