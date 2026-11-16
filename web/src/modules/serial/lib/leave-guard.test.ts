import { afterEach, expect, test, vi } from 'vitest';
import { clearAllDrafts, resumeDraftWrites } from './draft-store';
import { hasProofPhotos, leaveMode, shouldBlockLeave, shouldWarnBeforeUnload } from './leave-guard';

afterEach(() => {
  resumeDraftWrites();
  localStorage.clear();
});

test('tabel kosong tidak menahan navigasi dan tidak bertanya', () => {
  const confirmLeave = vi.fn(() => false);
  expect(shouldBlockLeave(false, confirmLeave)).toBe(false);
  expect(confirmLeave).not.toHaveBeenCalled();
  expect(shouldWarnBeforeUnload(false)).toBe(false);
});

test('tabel berisi: ditahan bila konfirmasi dibatalkan, lolos bila disetujui', () => {
  expect(shouldBlockLeave(true, () => false)).toBe(true);
  expect(shouldBlockLeave(true, () => true)).toBe(false);
  expect(shouldWarnBeforeUnload(true)).toBe(true);
});

test('setelah Keluar (draf dibuang dan penulisan ditahan) navigasi tidak ditahan dan tidak bertanya', () => {
  clearAllDrafts();
  const confirmLeave = vi.fn(() => false);
  expect(shouldBlockLeave(true, confirmLeave)).toBe(false);
  expect(confirmLeave).not.toHaveBeenCalled();
  expect(shouldWarnBeforeUnload(true)).toBe(false);
  // Halaman Catat dibuka lagi: perlindungan kembali.
  resumeDraftWrites();
  expect(shouldBlockLeave(true, () => false)).toBe(true);
});

test('hasProofPhotos: true bila minimal satu baris punya foto bukti', () => {
  expect(hasProofPhotos([])).toBe(false);
  expect(hasProofPhotos([{ proofPhotos: [] }, { proofPhotos: [] }])).toBe(false);
  expect(hasProofPhotos([{ proofPhotos: [] }, { proofPhotos: [{ id: 'p' }] }])).toBe(true);
});

test('leaveMode: kosong none, draft biasa confirm, draft berfoto dialog, keluar dari aplikasi none', () => {
  expect(leaveMode(false, true)).toBe('none');
  expect(leaveMode(true, false)).toBe('confirm');
  expect(leaveMode(true, true)).toBe('dialog');
  clearAllDrafts();
  expect(leaveMode(true, true)).toBe('none');
  expect(leaveMode(true, false)).toBe('none');
  resumeDraftWrites();
  expect(leaveMode(true, true)).toBe('dialog');
});
