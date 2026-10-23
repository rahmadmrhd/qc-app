import { expect, test } from 'vitest';
import { normalizeMarkdown } from './normalize-markdown';

test('meringkas baris kosong beruntun dan membuang baris kosong di ujung', () => {
  expect(normalizeMarkdown('a\n\n\n\nb\n\n')).toBe('a\n\nb');
  expect(normalizeMarkdown('\n\n- [ ] x\n\n')).toBe('- [ ] x');
  expect(normalizeMarkdown('')).toBe('');
});

test('isi blok kode berpagar tidak diubah', () => {
  const code = '```\na\n\n\nb\n```';
  expect(normalizeMarkdown(`teks\n\n\n${code}\n\n\nakhir`)).toBe(`teks\n\n${code}\n\nakhir`);
});
