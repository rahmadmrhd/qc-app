import { describe, expect, test } from 'bun:test';
import { addPending, isRegistered, normalizeSerial, type PendingEntry } from './pending';

function entry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    serial: 'E1D80FB1B4DE',
    brand: 'ubiquiti',
    tipe: 'WA',
    date: '2026-11-12',
    timestamp: '2026-11-12T08:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeSerial', () => {
  test('normalizeSerial: trim dan huruf besar; format bertitik dua tidak digabung dengan tanpa titik dua', () => {
    expect(normalizeSerial(' 58d61f ')).toBe('58D61F');
    expect(normalizeSerial('58:D6')).not.toBe(normalizeSerial('58D6'));
    expect(normalizeSerial('58:d6')).toBe('58:D6');
  });
});

describe('addPending', () => {
  test('serial baru ditambahkan dengan result success', () => {
    const first = entry();
    const { list, result } = addPending([], first);
    expect(result).toBe('success');
    expect(list).toEqual([first]);
  });

  test('serial dinormalkan saat disimpan', () => {
    const { list } = addPending([], entry({ serial: ' e1d80fb1b4de ' }));
    expect(list[0]?.serial).toBe('E1D80FB1B4DE');
  });

  test('serial ganda tidak menimpa entri pertama, menambah reinjectedAt, result duplicated, panjang daftar tetap', () => {
    const first = entry();
    const { list: one } = addPending([], first);
    const second = entry({
      serial: ' e1d80fb1b4de',
      tipe: 'XC',
      date: '2026-11-13',
      timestamp: '2026-11-13T09:30:00.000Z',
    });
    const { list, result } = addPending(one, second);
    expect(result).toBe('duplicated');
    expect(list.length).toBe(1);
    // Isi entri pertama tidak berubah; hanya reinjectedAt yang bertambah.
    expect(list[0]).toEqual({ ...first, reinjectedAt: '2026-11-13T09:30:00.000Z' });
    expect(list[0]?.tipe).toBe('WA');
    expect(list[0]?.date).toBe('2026-11-12');
    // Tidak ada mutasi pada masukan.
    expect(one[0]).toEqual(first);
    expect(one[0]?.reinjectedAt).toBeUndefined();

    // Duplikat berikutnya memperbarui reinjectedAt ke yang terbaru.
    const third = entry({ timestamp: '2026-11-14T10:00:00.000Z' });
    const again = addPending(list, third);
    expect(again.result).toBe('duplicated');
    expect(again.list.length).toBe(1);
    expect(again.list[0]?.reinjectedAt).toBe('2026-11-14T10:00:00.000Z');
  });

  test('daftar masukan tidak dimutasi dan entri lain tidak tersentuh', () => {
    const a = entry({ serial: 'AAA' });
    const b = entry({ serial: 'BBB' });
    const input: readonly PendingEntry[] = [a, b];
    const { list } = addPending(input, entry({ serial: 'ccc' }));
    expect(input.length).toBe(2);
    expect(list.map((e) => e.serial)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(list[0]).toBe(a);
  });

  test('serial berformat titik dua dan tanpa titik dua dianggap berbeda', () => {
    const { list, result } = addPending([entry({ serial: '58D6' })], entry({ serial: '58:D6' }));
    expect(result).toBe('success');
    expect(list.length).toBe(2);
  });
});

describe('isRegistered', () => {
  test('isRegistered memakai serial ternormalisasi', () => {
    const list = [entry({ serial: 'E1D80FB1B4DE' })];
    expect(isRegistered(list, ' e1d80fb1b4de ')).toBe(true);
    expect(isRegistered(list, 'E1D80FB1B4DF')).toBe(false);
    expect(isRegistered([], 'E1D80FB1B4DE')).toBe(false);
  });
});
