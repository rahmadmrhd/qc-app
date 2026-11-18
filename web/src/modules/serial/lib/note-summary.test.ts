import { expect, test } from 'vitest';
import { noteSummary } from './note-summary';

test('catatan teks biasa tidak berubah', () => {
  expect(noteSummary('Port 3 mati')).toBe('Port 3 mati');
  expect(noteSummary('')).toBe('');
});

test('sintaks Markdown dibuang dan baris digabung menjadi satu baris', () => {
  expect(noteSummary('**Penting**: cek _kabel_\n\n- port 1\n- port 2')).toBe(
    'Penting: cek kabel - port 1 - port 2',
  );
  expect(noteSummary('## Judul\n\n[tautan](https://contoh.id)')).toBe(
    'Judul tautan (https://contoh.id)',
  );
});
