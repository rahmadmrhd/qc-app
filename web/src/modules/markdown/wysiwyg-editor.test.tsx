import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import type { WysiwygEditorProps } from './wysiwyg-editor';
import { WysiwygEditor } from './wysiwyg-editor';

let editor: Editor;
let lastValue = '';

function Harness({ initial = '', ...rest }: { initial?: string } & Partial<WysiwygEditorProps>) {
  const [value, setValue] = useState(initial);
  return (
    <WysiwygEditor
      id="md"
      value={value}
      onChange={(next) => {
        lastValue = next;
        setValue(next);
      }}
      onReady={(e) => {
        editor = e;
      }}
      {...rest}
    />
  );
}

const png = (name = 'foto.png') => new File(['x'], name, { type: 'image/png' });
const SAMPLE = [
  '## Spesifikasi',
  '',
  '- Port 24',
  '- PoE',
  '',
  '1. satu',
  '2. dua',
  '',
  '| Kolom | Nilai |',
  '| --- | --- |',
  '| A | 1 |',
  '',
  '![foto](qcfile:f1)',
  '',
  '> kutipan',
  '',
  '```',
  'kode blok',
  '```',
  '',
  'teks **tebal** dan _miring_ dengan `kode`',
].join('\n');

beforeEach(() => {
  uploadMock.mockReset();
  lastValue = '';
});

test('memuat dan menyimpan kembali Markdown Detail Item yang ada tanpa mengubah makna', async () => {
  render(<Harness initial={SAMPLE} />);
  await waitFor(() => expect(editor).toBeDefined());
  const out = editor.getMarkdown();
  // Struktur tetap: judul, daftar, daftar bernomor, tabel, gambar, kutipan, blok kode.
  const types = (editor.getJSON().content ?? []).map((n) => n.type);
  expect(() => editor.state.doc.check()).not.toThrow();
  expect(types).toEqual([
    'heading',
    'bulletList',
    'orderedList',
    'table',
    'paragraph',
    'blockquote',
    'codeBlock',
    'paragraph',
  ]);
  expect(out).toContain('## Spesifikasi');
  expect(out).toContain('| Kolom | Nilai |');
  expect(out).toContain('![foto](qcfile:f1)');
  expect(out).toContain('> kutipan');
  expect(out).toContain('kode blok');
  // Serialisasi lalu parse ulang menghasilkan dokumen yang sama (idempoten).
  expect(editor.markdown?.parse(out)).toEqual(editor.markdown?.parse(SAMPLE));
  // Memuat tanpa mengedit tidak memanggil onChange (formulir tidak menjadi kotor).
  expect(lastValue).toBe('');
});

test('tombol checklist menghasilkan "- [ ] "', async () => {
  render(<Harness initial="butir" />);
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await waitFor(() => expect(lastValue).toBe('- [ ] butir'));
});

test('tombol tebal pada seleksi menghasilkan **x**', async () => {
  render(<Harness initial="halo dunia" />);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => {
    editor.commands.setTextSelection({ from: 6, to: 11 });
  });
  await userEvent.click(screen.getByRole('button', { name: 'Tebal' }));
  await waitFor(() => expect(lastValue).toBe('halo **dunia**'));
});

test('maxLength menolak masukan melebihi batas', async () => {
  render(<Harness initial="abc" maxLength={8} />);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => {
    editor.commands.focus('end');
    editor.commands.insertContent('defgh');
  });
  await waitFor(() => expect(lastValue).toBe('abcdefgh'.slice(0, 8)));
  const accepted = lastValue;
  act(() => {
    editor.commands.insertContent('XYZ');
  });
  expect(lastValue).toBe(accepted);
  expect(editor.getMarkdown().length).toBeLessThanOrEqual(8);
  expect(screen.getByText('8/8')).toBeInTheDocument();
});

test('disabled bersifat baca-saja', async () => {
  render(<Harness initial="isi" disabled />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(editor.isEditable).toBe(false);
  expect(screen.getByRole('button', { name: 'Tebal' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Gambar' })).toBeDisabled();
});

test('mode note tidak menampilkan tombol gambar; mode item menampilkannya', () => {
  const { unmount } = render(<Harness mode="note" />);
  expect(screen.queryByRole('button', { name: 'Gambar' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Checklist' })).toBeInTheDocument();
  unmount();
  render(<Harness mode="item" />);
  expect(screen.getByRole('button', { name: 'Gambar' })).toBeInTheDocument();
});

test('mode message menampilkan tombol gambar; tempel gambar memicu unggah dan menyisipkan rujukan', async () => {
  uploadMock.mockResolvedValue('f9');
  render(<Harness mode="message" />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(screen.getByRole('button', { name: 'Gambar' })).toBeInTheDocument();
  expect(screen.getByLabelText('Pilih gambar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Checklist' })).toBeInTheDocument();
  // Toolbar mode message tetap ringkas: tanpa Tautan (khusus item).
  expect(screen.queryByRole('button', { name: 'Tautan' })).not.toBeInTheDocument();
  const file = png('tempel.png');
  const paste = new Event('paste', { cancelable: true });
  Object.assign(paste, { clipboardData: { files: [file], types: ['Files'] } });
  const handled = editor.options.editorProps.handlePaste?.(
    editor.view,
    paste as ClipboardEvent,
    null as never,
  );
  expect(handled).toBe(true);
  await waitFor(() => expect(lastValue).toContain('![tempel](qcfile:f9)'));
  expect(uploadMock).toHaveBeenCalledWith(file);
});

test('maxImages: gambar melebihi batas tidak diunggah dan menampilkan pesan', async () => {
  render(<Harness mode="message" maxImages={1} initial="![a](qcfile:f1)" />);
  await waitFor(() => expect(editor).toBeDefined());
  await userEvent.upload(screen.getByLabelText('Pilih gambar'), png('kedua.png'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 1 gambar');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('centang task list dapat diubah pada mode message, terkunci pada mode note', async () => {
  const { unmount } = render(<Harness mode="message" initial="- [ ] satu" />);
  await waitFor(() => expect(editor).toBeDefined());
  const box = (await screen.findByRole('checkbox')) as HTMLInputElement;
  await userEvent.click(box);
  await waitFor(() => expect(lastValue).toContain('- [x] satu'));
  unmount();
  lastValue = '';
  render(<Harness mode="note" initial="- [ ] satu" />);
  const locked = (await screen.findByRole('checkbox')) as HTMLInputElement;
  await userEvent.click(locked);
  expect(lastValue).toBe('');
});

test('tidak ada HTML mentah di keluaran', async () => {
  const { container } = render(
    <Harness
      initial={'halo <script>window.__xss = 1</script> <img src=x onerror="window.__xss=1">'}
    />,
  );
  await waitFor(() => expect(editor).toBeDefined());
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img[onerror]')).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
});

test('memilih gambar mengunggah lalu menyisipkan rujukan qcfile di kursor', async () => {
  uploadMock.mockResolvedValue('f1');
  render(<Harness initial="awal" />);
  const file = png('foto kucing.png');
  await userEvent.upload(screen.getByLabelText('Pilih gambar'), file);
  await waitFor(() => expect(lastValue).toContain('![foto kucing](qcfile:f1)'));
  expect(uploadMock).toHaveBeenCalledWith(file);
});

test('berkas bukan gambar ditolak dengan pesan dan tidak diunggah', async () => {
  render(<Harness initial="isi" />);
  fireEvent.change(screen.getByLabelText('Pilih gambar'), {
    target: { files: [new File(['x'], 'catatan.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Hanya gambar JPEG, PNG, atau WebP yang dapat disisipkan',
  );
  expect(uploadMock).not.toHaveBeenCalled();
});

test('gagal mengunggah menampilkan pesan dan tidak mengubah isi', async () => {
  uploadMock.mockRejectedValue(
    new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'),
  );
  render(<Harness initial="isi" />);
  fireEvent.change(screen.getByLabelText('Pilih gambar'), { target: { files: [png()] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Gambar masih terlalu besar');
  expect(lastValue).toBe('');
});

test('menempel dan menyeret gambar mengunggahnya', async () => {
  uploadMock.mockResolvedValueOnce('f3').mockResolvedValueOnce('f4');
  render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  // jsdom tidak mendukung hit-testing seret/tempel ProseMirror: panggil penangan editor langsung.
  const paste = new Event('paste', { cancelable: true });
  Object.assign(paste, { clipboardData: { files: [png('tempel.png')], types: ['Files'] } });
  const handledPaste = editor.options.editorProps.handlePaste?.(
    editor.view,
    paste as ClipboardEvent,
    null as never,
  );
  expect(handledPaste).toBe(true);
  await waitFor(() => expect(lastValue).toContain('![tempel](qcfile:f3)'));
  const drop = new Event('drop', { cancelable: true });
  Object.assign(drop, { dataTransfer: { files: [png('seret.png')], types: ['Files'] } });
  const handledDrop = editor.options.editorProps.handleDrop?.(
    editor.view,
    drop as DragEvent,
    null as never,
    false,
  );
  expect(handledDrop).toBe(true);
  await waitFor(() => expect(lastValue).toContain('![seret](qcfile:f4)'));
});

test('menempel gambar bersama teks biasa (Excel/Word) tidak dicegat', () => {
  render(<Harness />);
  const paste = new Event('paste', { cancelable: true });
  Object.assign(paste, {
    clipboardData: { files: [png('tabel.png')], types: ['text/plain', 'text/html', 'Files'] },
  });
  const handled = editor.options.editorProps.handlePaste?.(
    editor.view,
    paste as ClipboardEvent,
    null as never,
  );
  expect(handled).toBeFalsy();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('unggahan yang selesai setelah editor ditutup tidak menyisipkan apa pun', async () => {
  let resolve!: (id: string) => void;
  uploadMock.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  const onChange = vi.fn();
  const { unmount } = render(<WysiwygEditor id="md" value="a" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Pilih gambar'), { target: { files: [png()] } });
  await screen.findByText('Mengunggah gambar…');
  unmount();
  resolve('f1');
  await new Promise((r) => setTimeout(r, 0));
  expect(onChange).not.toHaveBeenCalled();
});

test('penghitung melebihi batas ditandai; aksesibilitas memakai label form induk', () => {
  render(
    <>
      <span id="lbl">Detail</span>
      <WysiwygEditor
        id="md"
        labelledBy="lbl"
        value={'x'.repeat(21)}
        maxLength={20}
        onChange={() => undefined}
      />
    </>,
  );
  expect(screen.getByText('21/20')).toHaveClass('text-destructive');
  const field = screen.getByRole('textbox', { name: 'Detail' });
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveAccessibleDescription('21/20');
});

test('perubahan value dari luar memuat ulang isi editor', async () => {
  const { rerender } = render(<WysiwygEditor id="md" value="satu" onChange={() => undefined} />);
  rerender(<WysiwygEditor id="md" value="dua" onChange={() => undefined} />);
  await waitFor(() => expect(screen.getByText('dua')).toBeInTheDocument());
});

test('mengetik dengan spasi pada editor terkendali tidak kehilangan spasi (gema value tertinggal)', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByRole('textbox'), 'a b c');
  await waitFor(() => expect(lastValue).toBe('a b c'));
  expect(editor.getText()).toBe('a b c');
});
