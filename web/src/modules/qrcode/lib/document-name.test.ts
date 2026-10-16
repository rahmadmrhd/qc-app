import { expect, test } from 'vitest';
import { limitDocumentName } from './document-name';

test('nama dokumen dipotong ke 150 karakter dengan ekstensi .pdf dipertahankan', () => {
  expect(limitDocumentName('manual.pdf')).toBe('manual.pdf');
  const long = `${'a'.repeat(200)}.pdf`;
  const cut = limitDocumentName(long);
  expect(cut.length).toBe(150);
  expect(cut.endsWith('.pdf')).toBe(true);
  expect(limitDocumentName('  spasi.pdf  ')).toBe('spasi.pdf');
  expect(limitDocumentName('')).toBe('dokumen.pdf');
});
