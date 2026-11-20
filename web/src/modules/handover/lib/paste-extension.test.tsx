import { fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { whatsappPasteExtension } from './paste-extension';

let editor: Editor;
let last = '';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <WysiwygEditor
      id="n"
      mode="note"
      value={value}
      onChange={(next) => {
        last = next;
        setValue(next);
      }}
      onReady={(e) => {
        editor = e;
      }}
      extraExtensions={[whatsappPasteExtension()]}
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

test('menempel teks WhatsApp menghasilkan butir checklist dan paragraf', async () => {
  render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  paste({ 'text/plain': 'Orderan Online :\nCRS310 = 1 unt\nRB5009UG = 1 unt' });
  await waitFor(() =>
    expect(last).toBe('Orderan Online :\n\n- [ ] CRS310 = 1 unt\n- [ ] RB5009UG = 1 unt'),
  );
});

test('menempel di tengah teks mempertahankan teks sebelum/sesudah dan undo mengembalikannya', async () => {
  render(<Harness initial="awal akhir" />);
  await waitFor(() => expect(editor).toBeDefined());
  editor.commands.setTextSelection(6);
  paste({ 'text/plain': 'A = 1 unit' });
  await waitFor(() => expect(last).toContain('- [ ] A = 1 unit'));
  expect(last).toContain('awal');
  expect(last).toContain('akhir');
  editor.commands.undo();
  await waitFor(() => expect(editor.getMarkdown().trim()).toBe('awal akhir'));
});

test('tempelan HTML/rich dibersihkan: hanya teks biasa dipakai, tanpa script', async () => {
  const { container } = render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  paste({
    'text/plain': 'A = 1 unit',
    'text/html': '<b>A</b> = 1 unit<script>window.__x = 1</script>',
  });
  await waitFor(() => expect(last).toBe('- [ ] A = 1 unit'));
  expect(container.querySelector('script')).toBeNull();
});

test('format WhatsApp pada tempelan satu baris diubah menjadi format editor', async () => {
  render(<Harness />);
  await waitFor(() => expect(editor).toBeDefined());
  paste({ 'text/plain': '*Penting*' });
  await waitFor(() => expect(last).toBe('**Penting**'));
});
