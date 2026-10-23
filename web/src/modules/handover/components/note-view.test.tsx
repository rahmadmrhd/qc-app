import type { HandoverChecklistItemDto, HandoverCommentDto } from '@shared/rpc';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
