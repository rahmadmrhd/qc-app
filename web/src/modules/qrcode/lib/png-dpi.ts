const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

/** CRC-32 (polinomial PNG/zlib) untuk `bytes`. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] ?? 0) * 2 ** 24 +
    ((bytes[at + 1] ?? 0) << 16) +
    ((bytes[at + 2] ?? 0) << 8) +
    (bytes[at + 3] ?? 0)
  );
}

/**
 * Menyisipkan chunk `pHYs` (resolusi dalam piksel per meter) tepat setelah IHDR, menggantikan `pHYs` yang
 * ada. Hasil `canvas.toBlob` tidak membawa resolusi, sehingga aplikasi cetak menganggapnya 96 dpi (label 3 cm
 * tercetak ≈ 18,8 cm). Berkas yang bukan PNG dikembalikan apa adanya.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || !PNG_SIGNATURE.every((byte, index) => png[index] === byte)) return png;
  const perMeter = Math.round(dpi / 0.0254);
  const typeAndData = new Uint8Array([
    0x70,
    0x48,
    0x59,
    0x73, // "pHYs"
    ...u32(perMeter),
    ...u32(perMeter),
    1, // satuan: meter
  ]);
  const phys = [...u32(9), ...typeAndData, ...u32(crc32(typeAndData))];
  const out: number[] = [...PNG_SIGNATURE];
  let at = 8;
  let inserted = false;
  while (at + 12 <= png.length) {
    const length = readU32(png, at);
    const type = String.fromCharCode(...png.slice(at + 4, at + 8));
    const end = at + 12 + length;
    if (type !== 'pHYs') out.push(...png.slice(at, end));
    if (type === 'IHDR' && !inserted) {
      out.push(...phys);
      inserted = true;
    }
    at = end;
  }
  return inserted ? new Uint8Array(out) : png;
}
