import { describe, expect, test } from 'bun:test';
import { isUlid, ulidTime } from '@shared/ids';
import { createIdGenerator, newId } from './id';

const randomPart = (id: string) => id.slice(10);

describe('newId', () => {
  test('menghasilkan ULID huruf kecil yang sah dengan waktu sekarang', () => {
    const before = Date.now();
    const id = newId();
    expect(isUlid(id)).toBe(true);
    const time = ulidTime(id) as number;
    expect(time).toBeGreaterThanOrEqual(before - 1);
    expect(time).toBeLessThanOrEqual(Date.now() + 1);
  });

  test('puluhan ribu ID berturut-turut unik dan terurut menaik', () => {
    const ids = Array.from({ length: 50_000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      if ((ids[i - 1] as string) >= (ids[i] as string)) throw new Error(`tidak menaik di ${i}`);
    }
  });
});

describe('createIdGenerator', () => {
  test('milidetik berbeda menghasilkan bagian acak 16 karakter yang berbeda dan tidak nol', () => {
    let tick = 0;
    let counter = 0;
    const next = createIdGenerator({
      now: () => 1_700_000_000_000 + tick++,
      random: () => new Uint8Array(10).fill(++counter * 7),
    });
    const a = next();
    const b = next();
    expect(ulidTime(a)).toBe(1_700_000_000_000);
    expect(ulidTime(b)).toBe(1_700_000_000_001);
    expect(randomPart(a)).toHaveLength(16);
    expect(randomPart(a)).not.toBe(randomPart(b));
    expect(randomPart(a)).not.toBe('0'.repeat(16));
    expect(randomPart(b)).not.toBe('0'.repeat(16));
  });

  test('acak disuntik nol: milidetik sama tetap menaik lewat penaikan bagian acak', () => {
    const next = createIdGenerator({ now: () => 5000, random: () => new Uint8Array(10) });
    const a = next();
    const b = next();
    const c = next();
    expect(randomPart(a)).toBe('0'.repeat(16));
    expect(randomPart(b)).toBe(`${'0'.repeat(15)}1`);
    expect(randomPart(c)).toBe(`${'0'.repeat(15)}2`);
    expect(a < b && b < c).toBe(true);
  });

  test('jam mundur tetap menghasilkan ID menaik tanpa duplikat', () => {
    const times = [10_000, 10_000, 500, 200, 10_000, 10_001, 3, 10_002];
    let i = 0;
    const next = createIdGenerator({
      now: () => times[i++] as number,
      random: () => new Uint8Array(10).fill(9),
    });
    const ids = times.map(() => next());
    expect(new Set(ids).size).toBe(ids.length);
    for (let k = 1; k < ids.length; k++) {
      if ((ids[k - 1] as string) >= (ids[k] as string)) throw new Error(`tidak menaik di ${k}`);
    }
    // Waktu yang tertanam tidak pernah mundur.
    const embedded = ids.map((id) => ulidTime(id) as number);
    for (let k = 1; k < embedded.length; k++) {
      expect(embedded[k] as number).toBeGreaterThanOrEqual(embedded[k - 1] as number);
    }
  });

  test('dua pembuat punya keadaan terpisah', () => {
    const deps = () => ({ now: () => 7000, random: () => new Uint8Array(10).fill(4) });
    const a = createIdGenerator(deps());
    const b = createIdGenerator(deps());
    const a1 = a();
    const a2 = a();
    const b1 = b();
    expect(a2).not.toBe(a1);
    // Keadaan A (sudah dua kali dipakai) tidak memengaruhi B: ID pertama B sama dengan ID pertama A.
    expect(b1).toBe(a1);
    expect(b()).toBe(a2);
  });
});
