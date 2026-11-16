import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { glyphChars, glyphOf, glyphSource } from './font';
import { decodePngRgba, encodePngRgba, type RgbaImage } from './png';
import {
  fitStampLine,
  foldForStamp,
  PROOF_MAX_PIXELS,
  type ProofSnapshot,
  stampFooterHeight,
  stampLines,
  stampPhoto,
} from './stamp';

const SNAPSHOT: ProofSnapshot = {
  serial: 'ABC123',
  brand: 'Cisco',
  model: 'C9200',
  buCode: 'BU1',
  locationName: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'qc',
  savedAt: '2026-11-16T07:32:00.000Z',
};

/** Gambar uji halus (gradien): aman terhadap kompresi lossy untuk perbandingan sampel. */
function gradient(width: number, height: number): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = Math.round((x / Math.max(1, width - 1)) * 200) + 20;
      rgba[i + 1] = Math.round((y / Math.max(1, height - 1)) * 200) + 20;
      rgba[i + 2] = 120;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

async function decodeAny(bytes: Uint8Array): Promise<RgbaImage> {
  const png = await new Bun.Image(bytes).png().bytes();
  return decodePngRgba(png, 100_000_000);
}

function pixel(image: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.rgba[i] as number, image.rgba[i + 1] as number, image.rgba[i + 2] as number];
}

async function rejectsValidation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect((error as { code?: string } | null)?.code).toBe('VALIDATION');
}

describe('font', () => {
  test('semua glyph 5 x 9 dan ASCII cetak 32-126 lengkap, plus titik tengah dan elipsis', () => {
    const chars = glyphChars();
    for (let code = 32; code <= 126; code++) expect(chars).toContain(String.fromCharCode(code));
    expect(chars).toContain('·');
    expect(chars).toContain('…');
    for (const [char, source] of Object.entries(glyphSource())) {
      const rows = source.split('/');
      expect([char, rows.length]).toEqual([char, 9]);
      for (const row of rows)
        expect([char, row]).toEqual([char, expect.stringMatching(/^[#.]{5}$/)]);
    }
  });

  test('tiap glyph selain spasi menyala dan tak ada dua glyph yang kembar', () => {
    const seen = new Map<string, string>();
    for (const char of glyphChars()) {
      const glyph = glyphOf(char) as readonly number[];
      const key = glyph.join(',');
      if (char === ' ') {
        expect(glyph.every((row) => row === 0)).toBe(true);
        continue;
      }
      expect([char, glyph.some((row) => row !== 0)]).toEqual([char, true]);
      expect([char, seen.get(key)]).toEqual([char, undefined]);
      seen.set(key, char);
    }
  });
});

describe('stampLines', () => {
  test('empat baris persis rancangan, waktu WIB dari ISO UTC', () => {
    expect(stampLines(SNAPSHOT)).toEqual([
      'SN: ABC123',
      'Cisco C9200',
      'BU1 · Surabaya',
      'Disimpan 16 Nov 2026 14:32 WIB · Budi (QC)',
    ]);
  });

  test('label tim servis dan pergantian hari/tahun menurut WIB', () => {
    const lines = stampLines({
      ...SNAPSHOT,
      actorTeam: 'service',
      savedAt: '2026-12-31T20:05:00.000Z',
    });
    expect(lines[3]).toBe('Disimpan 1 Jan 2027 03:05 WIB · Budi (Servis)');
  });

  test('huruf bersandi dilipat, karakter lain jadi ?, kontrol dan pengatur arah dibuang', () => {
    const lines = stampLines({
      ...SNAPSHOT,
      serial: 'Sérialü\u0000\n‮9',
      brand: '日本語',
      model: 'Café 😀',
      locationName: 'Surabaya\t​Barat',
    });
    expect(lines[0]).toBe('SN: Serialu9');
    expect(lines[1]).toBe('??? Cafe ?');
    expect(lines[2]).toBe('BU1 · SurabayaBarat');
    expect(foldForStamp('  a   b  ')).toBe('a b');
  });

  test('fitStampLine memotong dengan elipsis', () => {
    expect(fitStampLine('abcdef', 6)).toBe('abcdef');
    expect(fitStampLine('abcdefg', 6)).toBe('abcde…');
    expect(fitStampLine('abc', 1)).toBe('…');
    expect(fitStampLine('abc', 0)).toBe('');
  });
});

describe('png', () => {
  /** Menyusun PNG dengan filter per baris yang dipilih tes (menyaring sendiri di sini). */
  function filteredPng(image: RgbaImage, filterOf: (y: number) => number): Uint8Array {
    const { width, height, rgba } = image;
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const type = filterOf(y);
      raw[y * (stride + 1)] = type;
      for (let i = 0; i < stride; i++) {
        const x = rgba[y * stride + i] as number;
        const left = i >= 4 ? (rgba[y * stride + i - 4] as number) : 0;
        const up = y > 0 ? (rgba[(y - 1) * stride + i] as number) : 0;
        const upLeft = y > 0 && i >= 4 ? (rgba[(y - 1) * stride + i - 4] as number) : 0;
        let predicted = 0;
        if (type === 1) predicted = left;
        else if (type === 2) predicted = up;
        else if (type === 3) predicted = (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        raw[y * (stride + 1) + 1 + i] = (x - predicted) & 0xff;
      }
    }
    return assemble(width, height, 8, 6, 0, deflateSync(raw));
  }

  function assemble(
    width: number,
    height: number,
    bitDepth: number,
    colorType: number,
    interlace: number,
    idat: Uint8Array,
  ): Uint8Array {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = bitDepth;
    ihdr[9] = colorType;
    ihdr[12] = interlace;
    const chunkOf = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      new DataView(out.buffer).setUint32(0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      return out; // CRC tidak diperiksa pembaca
    };
    const parts = [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunkOf('IHDR', ihdr),
      chunkOf('IDAT', idat),
      chunkOf('IEND', new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function noisy(width: number, height: number): RgbaImage {
    const rgba = new Uint8Array(width * height * 4);
    let seed = 12345;
    for (let i = 0; i < rgba.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      rgba[i] = (seed >> 8) & 0xff;
    }
    return { width, height, rgba };
  }

  for (const [name, filter] of [
    ['None', 0],
    ['Sub', 1],
    ['Up', 2],
    ['Average', 3],
    ['Paeth', 4],
  ] as const) {
    test(`membuka filter ${name} (semua baris)`, async () => {
      const image = noisy(13, 9);
      const decoded = await decodePngRgba(
        filteredPng(image, () => filter),
        1_000_000,
      );
      expect(decoded.width).toBe(13);
      expect(decoded.height).toBe(9);
      expect(Buffer.from(decoded.rgba).equals(Buffer.from(image.rgba))).toBe(true);
    });
  }

  test('membuka campuran kelima filter berganti per baris', async () => {
    const image = noisy(31, 25);
    const decoded = await decodePngRgba(
      filteredPng(image, (y) => y % 5),
      1_000_000,
    );
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(image.rgba))).toBe(true);
  });

  test('encode lalu decode kembali utuh', async () => {
    const image = noisy(17, 11);
    const decoded = await decodePngRgba(await encodePngRgba(image), 1_000_000);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(image.rgba))).toBe(true);
  });

  test('keluaran encode dapat dibaca Bun.Image', async () => {
    const meta = await new Bun.Image(await encodePngRgba(noisy(20, 10))).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([20, 10, 'png']);
  });

  test('menolak bukan-RGBA, interlace, terpotong, sampah, dan jenis filter tak dikenal', async () => {
    const good = deflateSync(new Uint8Array((4 + 1) * 1));
    await rejectsValidation(decodePngRgba(assemble(1, 1, 8, 2, 0, good), 100));
    await rejectsValidation(decodePngRgba(assemble(1, 1, 8, 6, 1, good), 100));
    await rejectsValidation(decodePngRgba(assemble(1, 1, 16, 6, 0, good), 100));
    await rejectsValidation(decodePngRgba(new Uint8Array([1, 2, 3]), 100));
    const full = assemble(1, 1, 8, 6, 0, good);
    await rejectsValidation(decodePngRgba(full.subarray(0, full.length - 20), 100));
    const badFilter = new Uint8Array(5);
    badFilter[0] = 9;
    await rejectsValidation(decodePngRgba(assemble(1, 1, 8, 6, 0, deflateSync(badFilter)), 100));
  });

  test('batas piksel diperiksa dari header sebelum inflate; bom kompresi ditolak', async () => {
    const small = assemble(2, 2, 8, 6, 0, deflateSync(new Uint8Array(2 * (8 + 1))));
    await rejectsValidation(decodePngRgba(small, 3));
    // Header mengaku 1x1 tetapi data hasil inflate jauh lebih besar dari yang diharapkan.
    const bomb = assemble(1, 1, 8, 6, 0, deflateSync(new Uint8Array(10_000_000)));
    await rejectsValidation(decodePngRgba(bomb, 100));
    // Data lebih pendek dari yang diharapkan.
    await rejectsValidation(
      decodePngRgba(assemble(4, 4, 8, 6, 0, deflateSync(new Uint8Array(5))), 100),
    );
  });
});

describe('stampPhoto', () => {
  async function stampOf(image: RgbaImage, convert?: 'jpeg' | 'webp') {
    let bytes: Uint8Array = await encodePngRgba(image);
    if (convert === 'jpeg') bytes = await new Bun.Image(bytes).jpeg({ quality: 92 }).bytes();
    if (convert === 'webp') bytes = await new Bun.Image(bytes).webp({ quality: 92 }).bytes();
    return stampPhoto({ bytes, snapshot: SNAPSHOT });
  }

  /** Rata-rata selisih mutlak per saluran pada wilayah foto asal (tinggi `source.height`, tanpa footer). */
  function photoError(source: RgbaImage, result: RgbaImage): number {
    let sum = 0;
    let count = 0;
    const stepY = Math.max(1, Math.floor(source.height / 40));
    const stepX = Math.max(1, Math.floor(source.width / 40));
    for (let y = 0; y < source.height; y += stepY) {
      for (let x = 0; x < source.width; x += stepX) {
        const a = pixel(source, x, y);
        const b = pixel(result, x, y);
        for (let c = 0; c < 3; c++) sum += Math.abs((a[c] as number) - (b[c] as number));
        count += 3;
      }
    }
    return sum / count;
  }

  function footerStats(result: RgbaImage, top: number) {
    let dark = 0;
    let white = 0;
    let total = 0;
    for (let y = top; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const [r, g, b] = pixel(result, x, y);
        total++;
        if (r < 40 && g < 40 && b < 40) dark++;
        if (r > 215 && g > 215 && b > 215) white++;
      }
    }
    return { dark, white, total };
  }

  test('640x480: footer ditambahkan di bawah, hitam dengan huruf putih, foto di atas tidak berubah', async () => {
    const source = gradient(640, 480);
    const out = await stampOf(source);
    expect(out.mime).toBe('image/webp');
    const footer = stampFooterHeight(640);
    expect(out.width).toBe(640);
    expect(out.height).toBe(480 + footer);
    const decoded = await decodeAny(out.bytes);
    expect([decoded.width, decoded.height]).toEqual([out.width, out.height]);
    expect(photoError(source, decoded)).toBeLessThan(6);
    const stats = footerStats(decoded, 480 + 1);
    expect(stats.white).toBeGreaterThan(100);
    expect(stats.dark / stats.total).toBeGreaterThan(0.7);
    // Bantalan atas footer (di atas teks) benar-benar hitam.
    expect(pixel(decoded, 5, 480 + 1)[0]).toBeLessThan(20);
  });

  test('4000x30 (sangat lebar): huruf berskala menurut lebar dan footer lebih tinggi dari fotonya', async () => {
    const source = gradient(4000, 30);
    const out = await stampOf(source);
    const footer = stampFooterHeight(4000);
    expect(footer).toBeGreaterThan(30);
    expect([out.width, out.height]).toEqual([4000, 30 + footer]);
    const decoded = await decodeAny(out.bytes);
    expect(photoError(source, decoded)).toBeLessThan(8);
    expect(footerStats(decoded, 31).white).toBeGreaterThan(1000);
  });

  test('1x1: tetap menghasilkan gambar bercap tanpa melempar', async () => {
    const out = await stampOf(gradient(1, 1));
    expect(out.width).toBe(1);
    expect(out.height).toBe(1 + stampFooterHeight(1));
    const decoded = await decodeAny(out.bytes);
    expect(decoded.width).toBe(1);
  });

  test('masukan JPEG dan WebP sama-sama diterima', async () => {
    const source = gradient(320, 200);
    for (const convert of ['jpeg', 'webp'] as const) {
      const out = await stampOf(source, convert);
      expect(out.height).toBe(200 + stampFooterHeight(320));
      const decoded = await decodeAny(out.bytes);
      expect(photoError(source, decoded)).toBeLessThan(10);
      expect(footerStats(decoded, 201).white).toBeGreaterThan(50);
    }
  });

  test('baris yang terlalu panjang dipotong dan tidak keluar dari footer', async () => {
    const source = gradient(320, 100);
    const out = await stampPhoto({
      bytes: await encodePngRgba(source),
      snapshot: { ...SNAPSHOT, model: 'M'.repeat(300), locationName: 'L'.repeat(300) },
    });
    expect([out.width, out.height]).toEqual([320, 100 + stampFooterHeight(320)]);
    expect((await decodeAny(out.bytes)).width).toBe(320);
  });

  test('PNG transparan dilebur ke putih, hasil buram', async () => {
    const image = gradient(64, 40);
    for (let i = 3; i < image.rgba.length; i += 4) image.rgba[i] = 0;
    const out = await stampOf(image);
    const decoded = await decodeAny(out.bytes);
    const [r, g, b] = pixel(decoded, 10, 10);
    expect(Math.min(r, g, b)).toBeGreaterThan(235);
  });

  test('masukan sampah dan berkas bukan gambar dilempar VALIDATION', async () => {
    await rejectsValidation(
      stampPhoto({ bytes: new Uint8Array([1, 2, 3, 4, 5]), snapshot: SNAPSHOT }),
    );
    await rejectsValidation(
      stampPhoto({ bytes: new TextEncoder().encode('%PDF-1.4 bukan gambar'), snapshot: SNAPSHOT }),
    );
    await rejectsValidation(stampPhoto({ bytes: new Uint8Array(0), snapshot: SNAPSHOT }));
  });

  test('piksel melebihi PROOF_MAX_PIXELS ditolak dari header tanpa decode atau alokasi', async () => {
    // Header PNG sah yang mengaku 7000 x 7000 (49 juta piksel); data gambar sengaja tak sah/kosong.
    const header = await encodePngRgba(gradient(1, 1));
    const view = new DataView(header.buffer, header.byteOffset);
    view.setUint32(16, 7000);
    view.setUint32(20, 7000);
    expect(7000 * 7000).toBeGreaterThan(PROOF_MAX_PIXELS);
    const before = process.memoryUsage().rss;
    const started = performance.now();
    await rejectsValidation(stampPhoto({ bytes: header, snapshot: SNAPSHOT }));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
  });
});
