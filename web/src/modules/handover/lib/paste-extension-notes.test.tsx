import { extractChecklist } from '@shared/handover-checklist';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { NoteEditor } from '../components/note-editor';
import { whatsappPasteExtension } from './paste-extension';

let editor: Editor;
let last = '';

function Harness({ initial = '', maxLength }: { initial?: string; maxLength?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <WysiwygEditor
      id="n"
      mode="note"
      maxLength={maxLength}
      value={value}
      onChange={(next) => {
        last = next;
        setValue(next);
      }}
      onReady={(e) => {
        editor = e;
      }}
      extraExtensions={[whatsappPasteExtension({ maxLength })]}
    />
  );
}

function paste(data: Record<string, string>) {
  fireEvent.paste(editor.view.dom, {
    clipboardData: {
      getData: (type: string) => data[type] ?? '',
      types: Object.keys(data),
      files: [],
    },
  });
}

// M9: jalur editor penuh (tempel → Markdown tersimpan → butir checklist → tampilan).
test.each([
  ['RB_5009_X = 1 unit', 'RB_5009_X = 1 unit'],
  ['2*3 = 6 unit', '2*3 = 6 unit'],
  ['A*B*C = 1 unit', 'A*B*C = 1 unit'],
])('tempel "%s" tetap teks apa adanya (butir kanonis dan tampilan)', async (input, expected) => {
  const { container } = render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  paste({ 'text/plain': input });
  await waitFor(() => expect(extractChecklist(last)).toHaveLength(1));
  expect(extractChecklist(last)[0]?.text).toBe(expected);
  // tampil literal: tanpa huruf miring/tebal tambahan dari tanda * atau _
  expect(container.querySelector('li div p')?.textContent).toBe(expected);
  expect(container.querySelector('em, strong')).toBeNull();
});

test('potong-tempel butir internal (data-pm-slice): butir tanpa "=" tetap checklist dan format utuh', async () => {
  render(<Harness initial={'- [ ] Cek SN\n- [ ] A = 1'} />);
  await waitFor(() => expect(editor).toBeDefined());
  // salinan ProseMirror membawa text/html ber-data-pm-slice dan teks polos tanpa penanda "- [ ]"
  paste({
    'text/plain': 'Cek SN',
    'text/html':
      '<meta charset="utf-8"><ul data-type="taskList" data-pm-slice="2 2 []"><li data-checked="false"><p>Cek SN</p></li></ul>',
  });
  await waitFor(() => expect(extractChecklist(last).length).toBeGreaterThanOrEqual(2));
  expect(extractChecklist(last).map((e) => e.text)).toContain('Cek SN');
  expect(last).not.toContain('\n\nCek SN\n\n');
});

test('NoteEditor: tempelan > 5.000 karakter ditolak dengan pesan jelas dan draf utuh', async () => {
  function Wrapper() {
    const [value, setValue] = useState('draf awal');
    return <NoteEditorWithCapture value={value} onChange={setValue} />;
  }
  function NoteEditorWithCapture(props: { value: string; onChange: (v: string) => void }) {
    return (
      <NoteEditor
        id="x"
        value={props.value}
        onChange={(v) => {
          last = v;
          props.onChange(v);
        }}
      />
    );
  }
  render(<Wrapper />);
  await waitFor(() => expect(document.querySelector('[role="textbox"]')).not.toBeNull());
  const dom = document.querySelector('[role="textbox"]') as HTMLElement;
  fireEvent.paste(dom, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? 'x = 1\n'.repeat(1000) : ''),
      types: ['text/plain'],
      files: [],
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('melebihi batas 5.000 karakter');
  expect(screen.getByText('draf awal')).toBeInTheDocument();
});

test('mengetik melewati batas memunculkan pesan batas tercapai', async () => {
  render(<Harness initial="abcde" maxLength={8} />);
  await waitFor(() => expect(editor).toBeDefined());
  editor.commands.focus('end');
  editor.commands.insertContent('xyzxyzxyz');
  expect(await screen.findByText(/Batas 8 karakter tercapai/)).toBeInTheDocument();
  expect(editor.getMarkdown().trim()).toBe('abcde');
});

test('checkbox di editor Catatan tidak dapat diubah lewat keyboard', async () => {
  render(<Harness initial="- [ ] A = 1" />);
  await waitFor(() => expect(editor).toBeDefined());
  const box = document.querySelector('input[type=checkbox]') as HTMLInputElement;
  expect(box.closest('ul')?.parentElement?.className ?? '').toContain('pointer-events-none');
  box.focus();
  fireEvent.keyDown(box, { key: ' ' });
  expect(last).not.toContain('[x]');
});

test('M-A: klik pada label/kotak checkbox editor Catatan tidak mengubah centang', async () => {
  render(<Harness initial="- [ ] A = 1" />);
  await waitFor(() => expect(editor).toBeDefined());
  const box = document.querySelector('input[type=checkbox]') as HTMLInputElement;
  fireEvent.click(box.closest('label') as HTMLElement);
  fireEvent.click(box);
  expect(box.checked).toBe(false);
  expect(editor.getMarkdown()).not.toContain('[x]');
  expect(last).not.toContain('[x]');
});
