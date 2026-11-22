import { describe, expect, test } from 'vitest';
import { pickNearestCenter, pickNearestCenterCode, SCAN_FRAME, scanCropRect } from './scan-region';

describe('scanCropRect', () => {
  const frame = { width: 0.8, height: 0.5 };

  test('video landscape di kotak persegi: sisi kiri-kanan terpotong cover', () => {
    // skala = 300/720; video tampil 533,3 x 300, offsetX = 116,67; bingkai 240x150 di (30, 75).
    const rect = scanCropRect({ width: 1280, height: 720 }, { width: 300, height: 300 }, frame);
    expect(rect).toEqual({ x: 352, y: 180, width: 576, height: 360 });
  });

  test('video potret di kotak persegi: sisi atas-bawah terpotong cover', () => {
    // skala = 300/720 (lebar menentukan); video tampil 300 x 533,3, offsetY = 116,67.
    const rect = scanCropRect({ width: 720, height: 1280 }, { width: 300, height: 300 }, frame);
    expect(rect).toEqual({ x: 72, y: 460, width: 576, height: 360 });
  });

  test.each([
    ['kotak potret 360x420 (kamera + tabel di layar ponsel), video landscape', 1280, 720, 360, 420],
    ['kotak potret 360x420, video potret', 720, 1280, 360, 420],
    ['kotak lebar 900x330 (desktop), video landscape', 1280, 720, 900, 330],
    ['kotak lebar 900x330, video potret', 720, 1280, 900, 330],
  ])(
    'kotak tidak persegi: %s, potongan sebangun dengan bingkai dan berpusat di tengah video',
    (_name, vw, vh, bw, bh) => {
      const rect = scanCropRect({ width: vw, height: vh }, { width: bw, height: bh }, frame);
      expect(rect).not.toBeNull();
      const r = rect as NonNullable<typeof rect>;
      // Bingkai di layar 0,8bw x 0,5bh; pada piksel video dibagi skala `cover` yang sama di kedua sumbu.
      const scale = Math.max(bw / vw, bh / vh);
      // Pembulatan keluar (mulai ke bawah, ujung ke atas) menambah paling banyak 2 piksel video.
      expect(Math.abs(r.width * scale - bw * 0.8)).toBeLessThanOrEqual(2 * scale);
      expect(Math.abs(r.height * scale - bh * 0.5)).toBeLessThanOrEqual(2 * scale);
      // Video `cover` dipusatkan: pusat bingkai (pusat kotak) = pusat video.
      expect(r.x + r.width / 2).toBeCloseTo(vw / 2, 0);
      expect(r.y + r.height / 2).toBeCloseTo(vh / 2, 0);
      // Tidak pernah keluar dari video.
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(vw);
      expect(r.y + r.height).toBeLessThanOrEqual(vh);
    },
  );

  test('video persegi: bingkai = fraksi langsung', () => {
    expect(scanCropRect({ width: 1000, height: 1000 }, { width: 250, height: 250 }, frame)).toEqual(
      { x: 100, y: 250, width: 800, height: 500 },
    );
  });

  test('fraksi lain dan bawaan SCAN_FRAME', () => {
    expect(
      scanCropRect(
        { width: 1000, height: 1000 },
        { width: 500, height: 500 },
        { width: 1, height: 1 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(SCAN_FRAME).toEqual({ width: 0.8, height: 0.5 });
    expect(scanCropRect({ width: 1000, height: 1000 }, { width: 500, height: 500 })).toEqual(
      scanCropRect({ width: 1000, height: 1000 }, { width: 500, height: 500 }, SCAN_FRAME),
    );
  });

  test('pembulatan: mulai ke bawah, ujung ke atas (kode di tepi tidak terpotong)', () => {
    const rect = scanCropRect({ width: 301, height: 301 }, { width: 100, height: 100 }, frame);
    expect(rect).not.toBeNull();
    const r = rect as NonNullable<typeof rect>;
    expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
    expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
    // Bingkai x 10..90 di kotak 100, skala 1/3,01.
    expect(r.x).toBe(Math.floor(10 * 3.01));
    expect(r.x + r.width).toBe(Math.ceil(90 * 3.01));
  });

  test('dijepit ke batas video dan minimal 1x1', () => {
    expect(
      scanCropRect({ width: 10, height: 10 }, { width: 400, height: 400 }, { width: 5, height: 5 }),
    ).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    const tiny = scanCropRect(
      { width: 1, height: 1 },
      { width: 400, height: 400 },
      { width: 0, height: 0 },
    );
    expect(tiny?.width).toBe(1);
    expect(tiny?.height).toBe(1);
  });

  test.each([
    [
      { width: 0, height: 720 },
      { width: 300, height: 300 },
    ],
    [
      { width: 1280, height: 720 },
      { width: 0, height: 300 },
    ],
    [
      { width: Number.NaN, height: 720 },
      { width: 300, height: 300 },
    ],
  ])('ukuran tidak valid menghasilkan null', (video, box) => {
    expect(scanCropRect(video, box)).toBeNull();
  });
});

describe('pickNearestCenter', () => {
  const center = { x: 100, y: 100 };
  const box = (x: number, y: number) => ({ x, y, width: 20, height: 20 });

  test('memilih kode dengan pusat kotak terdekat ke pusat bingkai', () => {
    expect(
      pickNearestCenter(
        [
          { text: 'A', box: box(0, 0) },
          { text: 'B', box: box(90, 95) },
          { text: 'C', box: box(160, 160) },
        ],
        center,
      ),
    ).toBe('B');
  });

  test('kode tanpa kotak paling jauh; semua tanpa kotak atau tanpa pusat = yang pertama', () => {
    expect(
      pickNearestCenter(
        [
          { text: 'A', box: null },
          { text: 'B', box: box(0, 0) },
        ],
        center,
      ),
    ).toBe('B');
    expect(
      pickNearestCenter(
        [
          { text: 'A', box: null },
          { text: 'B', box: null },
        ],
        center,
      ),
    ).toBe('A');
    expect(
      pickNearestCenter(
        [
          { text: 'A', box: box(0, 0) },
          { text: 'B', box: box(90, 90) },
        ],
        null,
      ),
    ).toBe('A');
  });

  test('kosong atau teks kosong = null; seri = yang lebih dulu', () => {
    expect(pickNearestCenter([], center)).toBeNull();
    expect(pickNearestCenter([{ text: '', box: box(90, 90) }], center)).toBeNull();
    expect(
      pickNearestCenter(
        [
          { text: 'A', box: box(70, 90) },
          { text: 'B', box: box(110, 90) },
        ],
        center,
      ),
    ).toBe('A');
  });
});

describe('pickNearestCenterCode', () => {
  test('mengembalikan kode utuh (teks, format, kotak) yang terdekat pusat', () => {
    const near = { text: 'B', format: 'qr_code', box: { x: 90, y: 95, width: 20, height: 20 } };
    const far = { text: 'A', format: 'code_128', box: { x: 0, y: 0, width: 20, height: 20 } };
    expect(pickNearestCenterCode([far, near], { x: 100, y: 100 })).toBe(near);
    expect(pickNearestCenterCode([], { x: 0, y: 0 })).toBeNull();
    expect(pickNearestCenterCode([{ text: '', box: null }], null)).toBeNull();
  });
});
