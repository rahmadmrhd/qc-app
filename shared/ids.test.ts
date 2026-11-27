import { describe, expect, test } from 'bun:test';
import { formatUlid, isUlid, nextUlidState, ULID_ALPHABET, ULID_TIME_MAX, ulidTime } from './ids';

const bytes = (fill: number) => new Uint8Array(10).fill(fill);

describe('isUlid', () => {
  test('menerima ULID huruf kecil 26 karakter', () => {
    expect(isUlid('01arz3ndektsv4rrffq69g5fav')).toBe(true);
    expect(isUlid('7zzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(true);
    expect(isUlid('00000000000000000000000000')).toBe(true);
  });

  test('menolak huruf besar, panjang salah, huruf terlarang, dan melebihi 128 bit', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(false);
    expect(isUlid('01arz3ndektsv4rrffq69g5fa')).toBe(false);
    expect(isUlid('01arz3ndektsv4rrffq69g5favv')).toBe(false);
    expect(isUlid('01arz3ndektsv4rrffq69g5fiu')).toBe(false);
    expect(isUlid('81arz3ndektsv4rrffq69g5fav')).toBe(false);
    expect(isUlid('b0bf565f-1fc9-4fbb-8b9c-1dd7a36e80ca')).toBe(false);
    expect(isUlid(undefined)).toBe(false);
    expect(isUlid(123)).toBe(false);
  });

  test('tiap huruf terlarang (i, l, o, u; kecil dan besar) ditolak di posisi mana pun', () => {
    const base = '01arz3ndektsv4rrffq69g5fav';
    for (const letter of ['i', 'l', 'o', 'u', 'I', 'L', 'O', 'U']) {
      expect(isUlid(letter + base.slice(1))).toBe(false);
      expect(isUlid(base.slice(0, 12) + letter + base.slice(13))).toBe(false);
      expect(isUlid(base.slice(0, 25) + letter)).toBe(false);
    }
  });

  test('UUID lama bukan ULID', () => {
    expect(isUlid('fa8af035-9bb2-59fb-a104-c89f8cfef4ca')).toBe(false);
  });
});

describe('formatUlid dan ulidTime', () => {
  test('waktu 0 dan acak 0 menjadi 26 nol; maksimum menjadi 7 diikuti z', () => {
    expect(formatUlid({ time: 0, random: 0n })).toBe('0'.repeat(26));
    expect(formatUlid({ time: ULID_TIME_MAX, random: (1n << 80n) - 1n })).toBe(
      `7${'z'.repeat(25)}`,
    );
  });

  test('vektor ULID kanonik: waktu dan bagian acak ditulis persis dan terbaca kembali', () => {
    // Vektor spesifikasi ULID (`01ARZ3NDEKTSV4RRFFQ69G5FAV`) dalam huruf kecil.
    const time = 1469922850259; // 2016-07-30T23:54:10.259Z (hasil dekode independen "01arz3ndek")
    const randomText = 'tsv4rrffq69g5fav';
    // Dekode base32 Crockford dibuat sendiri di sini (bukan memakai kode yang diuji), big-endian ke 10 byte.
    const crockford = '0123456789abcdefghjkmnpqrstvwxyz';
    let value = 0n;
    for (const ch of randomText) value = value * 32n + BigInt(crockford.indexOf(ch));
    const random = new Uint8Array(10);
    for (let i = 9; i >= 0; i--) {
      random[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    expect(value).toBe(0n);
    // Byte tidak boleh seragam supaya urutan byte (endianness) ikut teruji.
    expect(new Set(random).size).toBeGreaterThan(1);

    const state = nextUlidState(null, time, random);
    expect(state.time).toBe(time);
    expect(formatUlid(state)).toBe('01arz3ndektsv4rrffq69g5fav');
    expect(ulidTime('01arz3ndektsv4rrffq69g5fav')).toBe(time);
  });

  test('waktu yang ditulis dapat dibaca kembali dan hasilnya selalu ULID sah', () => {
    const t = Date.UTC(2026, 10, 22, 3, 4, 5, 678);
    const id = formatUlid(nextUlidState(null, t, bytes(0xab)));
    expect(isUlid(id)).toBe(true);
    expect(id).toHaveLength(26);
    expect(ulidTime(id)).toBe(t);
    expect(ulidTime('bukan ulid')).toBeNull();
  });

  test('urutan teks sama dengan urutan waktu (pembanding byte)', () => {
    const times = [0, 1, 31, 32, 1000, Date.UTC(2022, 0, 3), Date.UTC(2026, 10, 22), ULID_TIME_MAX];
    const ids = times.map((time) => formatUlid({ time, random: 0n }));
    expect([...ids].sort()).toEqual(ids);
  });

  test('alfabet berurutan menurut byte', () => {
    expect([...ULID_ALPHABET].sort().join('')).toBe(ULID_ALPHABET);
    expect(ULID_ALPHABET).toHaveLength(32);
  });
});

describe('nextUlidState (monotonik)', () => {
  test('milidetik sama menaikkan bagian acak 1 sehingga urutan menaik', () => {
    const a = nextUlidState(null, 5000, bytes(1));
    const b = nextUlidState(a, 5000, bytes(9));
    const c = nextUlidState(b, 5000, bytes(9));
    expect(b.time).toBe(5000);
    expect(b.random).toBe(a.random + 1n);
    expect(c.random).toBe(a.random + 2n);
    expect(formatUlid(a) < formatUlid(b)).toBe(true);
    expect(formatUlid(b) < formatUlid(c)).toBe(true);
  });

  test('jam mundur menahan waktu terakhir dan tetap menaik', () => {
    const a = nextUlidState(null, 9000, bytes(1));
    const b = nextUlidState(a, 100, bytes(2));
    expect(b.time).toBe(9000);
    expect(formatUlid(a) < formatUlid(b)).toBe(true);
  });

  test('waktu lebih baru memakai acak baru', () => {
    const a = nextUlidState(null, 1000, bytes(1));
    const b = nextUlidState(a, 1001, bytes(7));
    expect(b.time).toBe(1001);
    expect(b.random).not.toBe(a.random + 1n);
  });

  test('acak yang meluap memajukan waktu 1 ms dengan acak baru', () => {
    const full = { time: 4000, random: (1n << 80n) - 1n };
    const next = nextUlidState(full, 4000, bytes(3));
    expect(next.time).toBe(4001);
    expect(formatUlid(full) < formatUlid(next)).toBe(true);
  });

  test('waktu di luar rentang 48 bit atau bukan bilangan bulat ditolak', () => {
    expect(() => nextUlidState(null, -1, bytes(1))).toThrow(RangeError);
    expect(() => nextUlidState(null, 1.5, bytes(1))).toThrow(RangeError);
    expect(() => nextUlidState(null, ULID_TIME_MAX + 1, bytes(1))).toThrow(RangeError);
    expect(() => nextUlidState(null, 1, new Uint8Array(3))).toThrow(RangeError);
  });

  test('waktu NaN dan Infinity ditolak', () => {
    expect(() => nextUlidState(null, Number.NaN, bytes(1))).toThrow(RangeError);
    expect(() => nextUlidState(null, Number.POSITIVE_INFINITY, bytes(1))).toThrow(RangeError);
    expect(() => nextUlidState(null, Number.NEGATIVE_INFINITY, bytes(1))).toThrow(RangeError);
  });

  test('waktu maksimum 48 bit diterima dan terbaca kembali sama', () => {
    const state = nextUlidState(null, ULID_TIME_MAX, bytes(0x5a));
    expect(state.time).toBe(ULID_TIME_MAX);
    const id = formatUlid(state);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBe(ULID_TIME_MAX);
  });

  test('keadaan penuh pada waktu maksimum dan waktu sama melempar RangeError', () => {
    const full = { time: ULID_TIME_MAX, random: (1n << 80n) - 1n };
    expect(() => nextUlidState(full, ULID_TIME_MAX, bytes(1))).toThrow(RangeError);
  });
});
