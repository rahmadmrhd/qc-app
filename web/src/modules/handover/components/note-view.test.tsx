import type { HandoverChecklistItemDto, HandoverCommentDto } from '@shared/contract';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import type { NoteViewProps } from './note-view';
import { NoteView } from './note-view';

const checklist: HandoverChecklistItemDto[] = [
  { index: 0, text: 'A = 1', checked: true, by: 'qc@x.id', at: '2026-10-15T03:00:00.000Z' },
  { index: 1, text: 'B = 2', checked: false, by: '', at: '' },
];

function setup(props: Partial<NoteViewProps> = {}) {
  const onCheck = vi.fn();
  const onComment = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <NoteView
      note={'- [ ] A = 1\n- [ ] B = 2\n\nkirim sore. kirim sore.'}
      checklist={checklist}
      comments={[]}
      canCheck
      canComment
      onCheck={onCheck}
      onComment={onComment}
      {...props}
    />,
  );
  return { onCheck, onComment, ...view };
}

/** Memilih teks sungguhan di jsdom lalu memberi tahu komponen lewat selectionchange. */
function select(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function textNodeOf(text: string): Text {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.includes(text)) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`teks tidak ditemukan: ${text}`);
}

test('mencentang memanggil onCheck dengan index dan text; pelaku/waktu tampil pada butir tercentang', async () => {
  const { onCheck } = setup();
  await userEvent.click(screen.getByRole('checkbox', { name: /B = 2/ }));
  expect(onCheck).toHaveBeenCalledWith({ index: 1, text: 'B = 2' }, true);
  expect(screen.getByRole('checkbox', { name: /A = 1/ })).toBeChecked();
  expect(screen.getByText(/qc@x\.id/)).toBeInTheDocument();
});

test('canCheck false → checkbox disabled', () => {
  setup({ canCheck: false });
  for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
});

test('memilih teks memunculkan tombol Balas; tanpa seleksi tidak ada', () => {
  setup();
  expect(screen.queryByRole('button', { name: 'Balas' })).not.toBeInTheDocument();
  select(textNodeOf('kirim sore. kirim sore.'), 0, 10);
  expect(screen.getByRole('button', { name: 'Balas' })).toBeInTheDocument();
  window.getSelection()?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
  expect(screen.queryByRole('button', { name: 'Balas' })).not.toBeInTheDocument();
});

test('canComment false → tombol Balas tidak muncul', () => {
  setup({ canComment: false });
  select(textNodeOf('kirim sore. kirim sore.'), 0, 10);
  expect(screen.queryByRole('button', { name: 'Balas' })).not.toBeInTheDocument();
});

test('Balas membuka composer dan kirim memanggil onComment dengan quote/before/after (kemunculan kedua)', async () => {
  const { onComment } = setup();
  select(textNodeOf('kirim sore. kirim sore.'), 12, 22);
  await userEvent.click(screen.getByRole('button', { name: 'Balas' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Mohon cek');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(onComment).toHaveBeenCalled());
  const input = onComment.mock.calls[0]?.[0];
  expect(input.quote).toBe('kirim sore');
  expect(input.body).toBe('Mohon cek');
  expect(input.before.endsWith('kirim sore. ')).toBe(true);
  expect(input.before.length).toBeLessThanOrEqual(20);
  expect(input.after).toBe('.');
});

test('kutipan dengan format dan emoji dikirim sesuai teks polos', async () => {
  const { onComment } = setup({
    note: 'Kirim **segera** 😀 ya\n\n- [ ] A = 1',
    checklist: [checklist[0] as HandoverChecklistItemDto],
  });
  select(textNodeOf('segera'), 0, 6);
  await userEvent.click(screen.getByRole('button', { name: 'Balas' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(onComment).toHaveBeenCalled());
  expect(onComment.mock.calls[0]?.[0]).toMatchObject({
    quote: 'segera',
    before: 'Kirim ',
    after: ' 😀 ya\nA = 1',
  });
});

test('tombol Balas dapat dijangkau keyboard', () => {
  setup();
  select(textNodeOf('kirim sore. kirim sore.'), 0, 10);
  const button = screen.getByRole('button', { name: 'Balas' });
  button.focus();
  expect(button).toHaveFocus();
  expect(button.tabIndex).toBe(0);
});

const comment = (over: Partial<HandoverCommentDto>): HandoverCommentDto => ({
  id: 'c1',
  quote: 'kirim sore',
  before: '',
  after: '',
  body: 'Mohon cek',
  author: 'viewer@x.id',
  at: '2026-10-15T03:00:00.000Z',
  stale: false,
  ...over,
});

test('daftar komentar: kutipan, isi, pelaku; komentar usang diberi label', () => {
  setup({
    comments: [comment({}), comment({ id: 'c2', quote: 'hilang', body: 'lama', stale: true })],
  });
  const items = within(screen.getByRole('list', { name: 'Komentar' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0] as HTMLElement).getByText('Mohon cek')).toBeInTheDocument();
  expect(within(items[0] as HTMLElement).queryByText('usang')).not.toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByText('usang')).toBeInTheDocument();
});

test('isi komentar <img onerror> tampil sebagai teks', () => {
  const { container } = setup({
    comments: [comment({ body: '<img src=x onerror="alert(1)">' })],
  });
  expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  expect(container.querySelector('img[onerror]')).toBeNull();
});

test('seleksi triple-klik yang berakhir di luar catatan tetap memunculkan Balas', () => {
  setup();
  const node = textNodeOf('kirim sore. kirim sore.');
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(document.body, document.body.childNodes.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
  expect(screen.getByRole('button', { name: 'Balas' })).toBeInTheDocument();
});

test('seleksi yang runtuh saat tombol Balas ditekan tidak melepas tombol sebelum klik', async () => {
  setup();
  select(textNodeOf('kirim sore. kirim sore.'), 0, 10);
  const button = screen.getByRole('button', { name: 'Balas' });
  fireEvent.pointerDown(button);
  window.getSelection()?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
  expect(screen.getByRole('button', { name: 'Balas' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Balas' }));
  expect(screen.getByRole('textbox', { name: 'Komentar' })).toBeInTheDocument();
});

test('gambar pada catatan tidak dirender (hanya teks alt)', () => {
  const { container } = setup({ note: '![logo](qcfile:abc)\n\nteks', checklist: [] });
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('logo')).toBeInTheDocument();
});

test('Tambah komentar membuka composer tanpa kutipan dan mengirim quote kosong', async () => {
  const { onComment } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  expect(screen.queryByRole('blockquote')).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Umum');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(onComment).toHaveBeenCalled());
  expect(onComment).toHaveBeenCalledWith({ quote: '', before: '', after: '', body: 'Umum' });
});

test('tanpa canComment tidak ada tombol Tambah komentar; komentar umum tampil tanpa blockquote', () => {
  setup({ canComment: false, comments: [comment({ quote: '', body: 'Umum' })] });
  expect(screen.queryByRole('button', { name: 'Tambah komentar' })).not.toBeInTheDocument();
  expect(screen.getByText('Umum')).toBeInTheDocument();
  expect(document.querySelector('blockquote')).toBeNull();
});

test('sorotan kutipan memilih kemunculan yang benar dan melepas sorotan saat dilepas', () => {
  const highlights = new Map<string, unknown>();
  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  const g = globalThis as unknown as Record<string, unknown>;
  const previous = { css: g.CSS, highlight: g.Highlight };
  g.CSS = { highlights };
  g.Highlight = FakeHighlight;
  try {
    const { unmount } = setup({
      comments: [
        comment({ quote: 'kirim sore', before: 'kirim sore. ', after: '.' }),
        comment({ id: 'c2', quote: 'A = 1\nB = 2' }),
      ],
    });
    const ranges = (highlights.get('qc-comment') as FakeHighlight).ranges;
    expect(ranges[0]?.toString()).toBe('kirim sore');
    // kutipan lintas butir: dari "A = 1" sampai "B = 2" (teks meta "oleh …" ikut di antara, bukan di ujung)
    expect(ranges[1]?.toString().startsWith('A = 1')).toBe(true);
    expect(ranges[1]?.toString().endsWith('B = 2')).toBe(true);
    // kemunculan kedua: rentang dimulai setelah "kirim sore. " (offset 12)
    expect(ranges[0]?.startOffset).toBe(12);
    unmount();
    expect(highlights.has('qc-comment')).toBe(false);
  } finally {
    g.CSS = previous.css;
    g.Highlight = previous.highlight;
  }
});

test('M-D: seleksi lintas butir tercentang tidak memuat teks "oleh … · waktu"', async () => {
  const { onComment } = setup({ note: '- [ ] A = 1\n- [ ] B = 2', comments: [] });
  const a = textNodeOf('A = 1');
  const b = textNodeOf('B = 2');
  const range = document.createRange();
  range.setStart(a, 0);
  range.setEnd(b, 5);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
  await userEvent.click(screen.getByRole('button', { name: 'Balas' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(onComment).toHaveBeenCalled());
  expect(onComment.mock.calls[0]?.[0].quote).toBe('A = 1\nB = 2');
});

test('"Belum terkirim" hanya untuk butir berstatus waiting', () => {
  setup({ itemStates: new Map([[1, 'waiting']]) });
  expect(screen.getAllByText('Belum terkirim')).toHaveLength(1);
  const label = screen.getByRole('checkbox', { name: /B = 2/ }).closest('li');
  expect(label?.textContent).toContain('Belum terkirim');
  const first = screen.getByRole('checkbox', { name: /A = 1/ }).closest('li');
  expect(first?.textContent).not.toContain('Belum terkirim');
});

test('"Mengirim…" untuk butir berstatus sending', () => {
  setup({ itemStates: new Map([[0, 'sending']]) });
  expect(screen.getAllByText('Mengirim…')).toHaveLength(1);
  const first = screen.getByRole('checkbox', { name: /A = 1/ }).closest('li');
  expect(first?.textContent).toContain('Mengirim…');
  expect(screen.queryByText('Belum terkirim')).not.toBeInTheDocument();
});

test('tanpa itemStates tidak ada penanda', () => {
  setup();
  expect(screen.queryByText('Belum terkirim')).not.toBeInTheDocument();
  expect(screen.queryByText('Mengirim…')).not.toBeInTheDocument();
});

test('komentar tertunda tampil di AKHIR daftar dengan label status; tanpa komentar server tetap tampil', () => {
  const server: HandoverCommentDto = {
    id: 'c1',
    quote: '',
    before: '',
    after: '',
    body: 'komentar server',
    author: 'wh@x.id',
    at: '2026-10-15T03:00:00.000Z',
    stale: false,
  };
  setup({
    comments: [server],
    pendingComments: [
      { id: 'p1', body: 'masih antre', quote: 'A = 1', at: 1, status: 'waiting' },
      { id: 'p2', body: 'sedang kirim', quote: '', at: 2, status: 'sending' },
    ],
  });
  const list = screen.getByRole('list', { name: 'Komentar' });
  const items = within(list).getAllByRole('listitem');
  expect(items.map((li) => li.textContent)).toEqual([
    expect.stringContaining('komentar server'),
    expect.stringContaining('masih antre'),
    expect.stringContaining('sedang kirim'),
  ]);
  expect(within(items[1] as HTMLElement).getByText('Belum terkirim')).toBeInTheDocument();
  expect(within(items[2] as HTMLElement).getByText('Mengirim…')).toBeInTheDocument();
  expect(within(items[0] as HTMLElement).queryByText('Belum terkirim')).not.toBeInTheDocument();
});

test('hanya komentar tertunda (tanpa komentar server): daftar tetap tampil', () => {
  setup({
    pendingComments: [{ id: 'p1', body: 'antre saja', quote: '', at: 1, status: 'waiting' }],
  });
  expect(screen.getByRole('list', { name: 'Komentar' })).toBeInTheDocument();
  expect(screen.getByText('antre saja')).toBeInTheDocument();
});
