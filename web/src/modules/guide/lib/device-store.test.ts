import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearOne, readDone, writeDone } from './device-store';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('device-store', () => {
  test('kosong bila belum ada tulisan', () => {
    expect(readDone('a@qc.local').size).toBe(0);
  });

  test('menulis lalu membaca; tulis berikutnya menggabung dan versi tak turun', () => {
    writeDone('a@qc.local', { 'dasar-layout': 1 });
    writeDone('a@qc.local', { 'handover-dasar': 2, 'dasar-layout': 0 });
    expect(Object.fromEntries(readDone('a@qc.local'))).toEqual({
      'dasar-layout': 1,
      'handover-dasar': 2,
    });
  });

  test('kunci per email: email lain tidak saling melihat', () => {
    writeDone('a@qc.local', { x: 1 });
    expect(readDone('b@qc.local').size).toBe(0);
  });

  test('huruf besar dan spasi pinggir disamakan', () => {
    writeDone('  A@QC.local ', { x: 1 });
    expect(readDone('a@qc.local').get('x')).toBe(1);
    expect(localStorage.getItem('qc.guide.done:a@qc.local')).not.toBeNull();
  });

  test('clearOne menghapus satu id saja', () => {
    writeDone('a@qc.local', { x: 1, y: 1 });
    clearOne('a@qc.local', 'x');
    expect(Object.fromEntries(readDone('a@qc.local'))).toEqual({ y: 1 });
  });

  test('JSON rusak, bukan objek, atau nilai bukan bilangan bulat positif diabaikan', () => {
    localStorage.setItem('qc.guide.done:a@qc.local', '{rusak');
    expect(readDone('a@qc.local').size).toBe(0);
    localStorage.setItem('qc.guide.done:a@qc.local', '[1,2]');
    expect(readDone('a@qc.local').size).toBe(0);
    localStorage.setItem(
      'qc.guide.done:a@qc.local',
      JSON.stringify({ ok: 1, nol: 0, pecah: 1.5, teks: '1', neg: -1 }),
    );
    expect(Object.fromEntries(readDone('a@qc.local'))).toEqual({ ok: 1 });
  });

  test('Review Focus 2: getItem melempar galat = peta kosong', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('terblokir');
    });
    expect(readDone('a@qc.local').size).toBe(0);
  });

  test('Review Focus 2: setItem melempar galat = tidak melempar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('penuh');
    });
    expect(() => writeDone('a@qc.local', { x: 1 })).not.toThrow();
    expect(() => clearOne('a@qc.local', 'x')).not.toThrow();
  });
});
