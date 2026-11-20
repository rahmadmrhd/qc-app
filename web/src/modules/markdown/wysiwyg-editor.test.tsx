import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/file-source', () => ({
  itemFileSource: {
    key: 'item-files',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    upload: uploadMock,
  },
}));
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
const item = (id: string, name: string) => ({
  id,
  name,
  size: 1,
  width: 1,
  height: 1,
  uploadedBy: '',
  createdAt: '',
  usageCount: 0,
  canRename: false,
  canRemove: false,
  thumbUrl: '',
  previewUrl: '',
});
/** Unggahan sukses: id berurutan dari `ids`, nama = nama antrean (nama berkas tanpa ekstensi). */
function uploadsAs(...ids: string[]) {
  const queue = [...ids];
  uploadMock.mockImplementation(async (_file: File, name: string) =>
    item(queue.shift() ?? 'fx', name),
  );
}
const onBusyChange = vi.fn();

/** Membuka dialog lewat tombol Gambar toolbar, memilih berkas lewat Telusuri, lalu menekan Sisipkan. */
async function insertViaDialog(...files: File[]) {
  await userEvent.click(screen.getByRole('button', { name: 'Gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Sisipkan gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  await userEvent.click(
    await within(dialog).findByRole('button', { name: `Sisipkan (${files.length})` }),
  );
}

function pasteFiles(files: File[]) {
  const paste = new Event('paste', { cancelable: true });
  Object.assign(paste, { clipboardData: { files, types: ['Files'] } });
  return editor.options.editorProps.handlePaste?.(
    editor.view,
    paste as ClipboardEvent,
    null as never,
  );
}
function dropFiles(files: File[]) {
  const drop = new Event('drop', { cancelable: true });
  Object.assign(drop, { dataTransfer: { files, types: ['Files'] } });
  return editor.options.editorProps.handleDrop?.(
    editor.view,
    drop as DragEvent,
    null as never,
    false,
  );
}
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
  onBusyChange.mockReset();
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
  uploadsAs('f9');
  render(<Harness mode="message" />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(screen.getByRole('button', { name: 'Gambar' })).toBeInTheDocument();
  // Tanpa input file tersembunyi: memilih gambar lewat dialog lampiran.
  expect(screen.queryByLabelText('Pilih gambar')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Checklist' })).toBeInTheDocument();
  // Toolbar mode message tetap ringkas: tanpa Tautan (khusus item).
  expect(screen.queryByRole('button', { name: 'Tautan' })).not.toBeInTheDocument();
  const file = png('tempel.png');
  expect(pasteFiles([file])).toBe(true);
  await waitFor(() => expect(lastValue).toContain('![tempel](qcfile:f9)'));
  expect(uploadMock.mock.calls[0]?.[0]).toBe(file);
});

test('maxImages: tombol Gambar saat sudah penuh menampilkan pesan tanpa dialog', async () => {
  render(<Harness mode="message" maxImages={1} initial="![a](qcfile:f1)" />);
  await waitFor(() => expect(editor).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Gambar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 1 gambar');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('maxImages: tempel melebihi sisa hanya mengunggah yang muat dan menampilkan pesan', async () => {
  uploadsAs('f2');
  render(<Harness mode="message" maxImages={2} initial="![a](qcfile:f1)" />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(pasteFiles([png('b.png'), png('c.png')])).toBe(true);
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 2 gambar');
  await waitFor(() => expect(lastValue).toContain('qcfile:f2'));
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

test('dialog: maxFiles = sisa maxImages', async () => {
  render(<Harness mode="message" maxImages={3} initial="![a](qcfile:f1)" />);
  await waitFor(() => expect(editor).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Sisipkan gambar' });
  expect(within(dialog).getByText(/hingga 2 berkas sekali unggah/)).toBeInTheDocument();
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

test('toolbar membuka dialog; Sisipkan mengunggah lalu menyisipkan rujukan qcfile di kursor', async () => {
  uploadsAs('f1');
  render(<Harness initial="awal" onBusyChange={onBusyChange} />);
  await waitFor(() => expect(editor).toBeDefined());
  const file = png('foto kucing.png');
  await insertViaDialog(file);
  await waitFor(() => expect(lastValue).toContain('![foto kucing](qcfile:f1)'));
  expect(uploadMock.mock.calls[0]?.[0]).toBe(file);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('onBusyChange true selama unggahan berjalan dan false setelah selesai; progres di baris status', async () => {
  let finish: (value: ReturnType<typeof item>) => void = () => undefined;
  uploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness initial="awal" onBusyChange={onBusyChange} />);
  await waitFor(() => expect(editor).toBeDefined());
  await insertViaDialog(png('a.png'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(await screen.findByText('Mengunggah gambar…')).toBeInTheDocument();
  expect(screen.getByTestId('attachment-pending')).toBeInTheDocument();
  finish(item('f1', 'a'));
  await waitFor(() => expect(lastValue).toContain('![a](qcfile:f1)'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
});

test('F1: unggahan gambar gagal tetap menahan (true) sampai Ulangi berhasil atau dibuang', async () => {
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  render(<Harness initial="awal" onBusyChange={onBusyChange} />);
  await waitFor(() => expect(editor).toBeDefined());
  await insertViaDialog(png('a.png'));
  expect(await screen.findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  uploadMock.mockResolvedValueOnce(item('f1', 'a'));
  await userEvent.click(screen.getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(lastValue).toContain('![a](qcfile:f1)'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  await insertViaDialog(png('b.png'));
  await userEvent.click(await screen.findByRole('button', { name: /^Buang / }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});

test('berkas bukan gambar (PDF) ditolak dengan pesan seragam dan tidak diunggah', async () => {
  render(<Harness initial="isi" />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(pasteFiles([new File(['x'], 'catatan.pdf', { type: 'application/pdf' })])).toBe(true);
  expect(await screen.findByText(/Format PDF tidak didukung/)).toBeInTheDocument();
  expect(screen.getByText('catatan.pdf')).toBeInTheDocument();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('berkas melebihi 10 MB ditolak dengan kalimat seragam', async () => {
  render(<Harness initial="isi" />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(
    dropFiles([new File([new Uint8Array(10_485_761)], 'besar.png', { type: 'image/png' })]),
  ).toBe(true);
  expect(await screen.findByText(/Ukuran melebihi 10 MB/)).toBeInTheDocument();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('gagal mengunggah menampilkan pesan pada entri dan tidak mengubah isi', async () => {
  uploadMock.mockRejectedValue(
    new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'),
  );
  render(<Harness initial="isi" />);
  await waitFor(() => expect(editor).toBeDefined());
  await insertViaDialog(png());
  expect(await screen.findByText(/Gambar masih terlalu besar/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ulangi foto' })).toBeInTheDocument();
  expect(lastValue).toBe('');
});

test('menempel dan menyeret gambar mengunggahnya', async () => {
  uploadsAs('f3', 'f4');
  render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  // jsdom tidak mendukung hit-testing seret/tempel ProseMirror: panggil penangan editor langsung.
  expect(pasteFiles([png('tempel.png')])).toBe(true);
  await waitFor(() => expect(lastValue).toContain('![tempel](qcfile:f3)'));
  expect(dropFiles([png('seret.png')])).toBe(true);
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

test('unggahan yang berjalan saat editor ditutup dibatalkan dan tidak menyisipkan apa pun', async () => {
  let aborted = 0;
  let resolve: (value: ReturnType<typeof item>) => void = () => undefined;
  uploadMock.mockImplementation(
    (_file: File, _name: string, ctx?: { signal?: AbortSignal }) =>
      new Promise((r) => {
        resolve = r;
        ctx?.signal?.addEventListener('abort', () => {
          aborted += 1;
        });
      }),
  );
  const onChange = vi.fn();
  const { unmount } = render(<WysiwygEditor id="md" value="a" onChange={onChange} />);
  await insertViaDialog(png());
  await screen.findByText('Mengunggah gambar…');
  unmount();
  expect(aborted).toBe(1);
  resolve(item('f1', 'foto'));
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
