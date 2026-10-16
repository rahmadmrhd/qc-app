import { expect, test } from 'vitest';
import { crc32, setPngDpi } from './png-dpi';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  return [
    ...u32(data.length),
    ...typeBytes,
    ...data,
    ...u32(crc32(new Uint8Array([...typeBytes, ...data]))),
  ];
}

/** PNG minimal sah: 1×1 piksel (IHDR + IDAT kosong-sah + IEND); isi IDAT tidak didekode di tes ini. */
function tinyPng(extraAfterIhdr: number[] = []): Uint8Array {
  const ihdr = chunk('IHDR', [...u32(1), ...u32(1), 8, 6, 0, 0, 0]);
  const idat = chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]);
  const iend = chunk('IEND', []);
  return new Uint8Array([...SIGNATURE, ...ihdr, ...extraAfterIhdr, ...idat, ...iend]);
}

function readChunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array; crc: number }> {
  const out: Array<{ type: string; data: Uint8Array; crc: number }> = [];
  let at = 8;
  while (at < bytes.length) {
    const length =
      (bytes[at] ?? 0) * 2 ** 24 +
      ((bytes[at + 1] ?? 0) << 16) +
      ((bytes[at + 2] ?? 0) << 8) +
      (bytes[at + 3] ?? 0);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    const data = bytes.slice(at + 8, at + 8 + length);
    const crc =
      ((bytes[at + 8 + length] ?? 0) * 2 ** 24 +
        ((bytes[at + 9 + length] ?? 0) << 16) +
        ((bytes[at + 10 + length] ?? 0) << 8) +
        (bytes[at + 11 + length] ?? 0)) >>>
      0;
    out.push({ type, data, crc });
    at += 12 + length;
  }
  return out;
}

test('crc32: vektor uji baku PNG (CRC chunk IEND = AE426082)', () => {
  expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
});

test('setPngDpi menyisipkan chunk pHYs tepat setelah IHDR: 600 dpi = 23622 piksel/meter, satuan meter, CRC benar', () => {
  const out = setPngDpi(tinyPng(), 600);
  const chunks = readChunks(out);
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
  const phys = chunks[1];
  if (!phys) throw new Error('pHYs hilang');
  expect(phys.data).toHaveLength(9);
  const x =
    ((phys.data[0] ?? 0) << 24) |
    ((phys.data[1] ?? 0) << 16) |
    ((phys.data[2] ?? 0) << 8) |
    (phys.data[3] ?? 0);
  expect(x).toBe(23622);
  expect([...phys.data.slice(4, 8)]).toEqual([...phys.data.slice(0, 4)]);
  expect(phys.data[8]).toBe(1);
  const typeAndData = new Uint8Array(
    [...'pHYs'].map((c) => c.charCodeAt(0)).concat([...phys.data]),
  );
  expect(phys.crc).toBe(crc32(typeAndData));
  // isi lain tidak berubah
  expect(readChunks(out).map((c) => c.data.length)).toEqual([13, 9, 10, 0]);
});

test('pHYs yang sudah ada diganti (tidak ganda); berkas yang bukan PNG dikembalikan apa adanya', () => {
  const existing = chunk('pHYs', [...u32(2835), ...u32(2835), 1]); // 72 dpi
  const out = setPngDpi(tinyPng(existing), 300);
  const physChunks = readChunks(out).filter((c) => c.type === 'pHYs');
  expect(physChunks).toHaveLength(1);
  const x =
    ((physChunks[0]?.data[0] ?? 0) << 24) |
    ((physChunks[0]?.data[1] ?? 0) << 16) |
    ((physChunks[0]?.data[2] ?? 0) << 8) |
    (physChunks[0]?.data[3] ?? 0);
  expect(x).toBe(11811);
  const junk = new Uint8Array([1, 2, 3, 4]);
  expect(setPngDpi(junk, 600)).toBe(junk);
});
