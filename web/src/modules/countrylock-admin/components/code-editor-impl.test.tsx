import { EditorView } from '@codemirror/view';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import CodeEditorImpl from './code-editor-impl';
import DiffViewImpl from './diff-view-impl';

describe('CodeEditorImpl (CodeMirror 6 di jsdom)', () => {
  test('menampilkan isi, memanggil onChange saat disunting, dan mengikuti value dari luar', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CodeEditorImpl value="/ip arp print" onChange={onChange} language="rsc" label="Isi skrip" />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content.textContent).toBe('/ip arp print');
    expect(screen.getByLabelText('Isi skrip')).toBe(content);
    const view = EditorView.findFromDOM(
      container.querySelector('.cm-editor') as HTMLElement,
    ) as EditorView;
    act(() => view.dispatch({ changes: { from: 0, insert: '# ' } }));
    expect(onChange).toHaveBeenLastCalledWith('# /ip arp print');
    // Nilai dari luar menggantikan isi tanpa memanggil onChange lagi.
    onChange.mockClear();
    rerender(<CodeEditorImpl value="baru" onChange={onChange} language="rsc" label="Isi skrip" />);
    expect(content.textContent).toBe('baru');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('readOnly: tidak dapat disunting', () => {
    const { container } = render(
      <CodeEditorImpl value="{}" language="json" label="Isi settings" readOnly />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content.getAttribute('contenteditable')).toBe('false');
  });
});

describe('DiffViewImpl (CodeMirror merge di jsdom)', () => {
  test('merender dua sisi baca-saja', () => {
    const { container } = render(
      <DiffViewImpl
        original="a\nb"
        modified="a\nc"
        language="text"
        originalLabel="Revisi 1"
        modifiedLabel="Revisi 2"
      />,
    );
    expect(screen.getByLabelText('Revisi 1')).toBeTruthy();
    expect(screen.getByLabelText('Revisi 2')).toBeTruthy();
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(2);
  });
});
