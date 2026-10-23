import { makeAnchor, noteToPlainText } from '@shared/handover-comments';
import { expect, test } from 'vitest';
import { collectNoteText, rangeForAnchor } from './note-dom-text';

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

test('teks DOM berpemisah blok selaras dengan noteToPlainText', () => {
  const el = root(
    '<p>kirim sore. kirim sore.</p>\n<ul><li><label><input type="checkbox"><span>A = 1</span></label>' +
      '<span data-note-meta>oleh qc · 1 Jan</span></li>\n<li>B = 2</li></ul>',
  );
  const note = 'kirim sore. kirim sore.\n\n- [ ] A = 1\n- [ ] B = 2';
  expect(collectNoteText(el).plain).toBe(noteToPlainText(note));
});

test('kutipan berulang memilih kemunculan yang benar lewat konteks', () => {
  const el = root('<p>kirim sore. kirim sore.</p>');
  const { plain } = collectNoteText(el);
  const start = plain.lastIndexOf('kirim sore');
  const range = rangeForAnchor(el, makeAnchor(plain, start, start + 10));
  expect(range?.toString()).toBe('kirim sore');
  expect(range?.startOffset).toBe(start);
});

test('kutipan lintas butir ditemukan dan rentangnya melintasi dua elemen', () => {
  const el = root('<ul><li>A = 1</li>\n<li>B = 2</li></ul>');
  const { plain } = collectNoteText(el);
  expect(plain).toBe('A = 1\nB = 2');
  const range = rangeForAnchor(el, makeAnchor(plain, 2, 9));
  expect(range).not.toBeNull();
  expect(range?.startContainer).not.toBe(range?.endContainer);
});

test('nbsp dinormalkan dan kutipan yang tidak ada mengembalikan null', () => {
  const el = root('<p>Port a b</p>');
  expect(collectNoteText(el).plain).toBe('Port a b');
  expect(rangeForAnchor(el, { quote: 'tidak ada', before: '', after: '' })).toBeNull();
});
