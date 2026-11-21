import { describe, expect, test } from 'vitest';
import { tapToVideoPoint } from './tap-point';

describe('tapToVideoPoint', () => {
  test('video persegi di kotak persegi: pecahan langsung', () => {
    expect(
      tapToVideoPoint(
        { x: 75, y: 150 },
        { width: 1000, height: 1000 },
        { width: 300, height: 300 },
      ),
    ).toEqual({ x: 0.25, y: 0.5 });
  });

  test('landscape di kotak persegi (cover): sisi kiri-kanan terpotong, pusat tetap 0,5', () => {
    // skala 300/720; video tampil 533,3 lebar, offsetX 116,67.
    const point = tapToVideoPoint(
      { x: 150, y: 150 },
      { width: 1280, height: 720 },
      { width: 300, height: 300 },
    );
    expect(point?.x).toBeCloseTo(0.5, 5);
    expect(point?.y).toBeCloseTo(0.5, 5);
    // Tepi kiri kotak = (116,67 / 533,33) dari lebar video.
    const left = tapToVideoPoint(
      { x: 0, y: 0 },
      { width: 1280, height: 720 },
      { width: 300, height: 300 },
    );
    expect(left?.x).toBeCloseTo(116.6667 / 533.3333, 4);
    expect(left?.y).toBe(0);
  });

  test('potret di kotak persegi (cover): sisi atas-bawah terpotong', () => {
    const top = tapToVideoPoint(
      { x: 150, y: 0 },
      { width: 720, height: 1280 },
      { width: 300, height: 300 },
    );
    expect(top?.x).toBeCloseTo(0.5, 5);
    expect(top?.y).toBeCloseTo(116.6667 / 533.3333, 4);
  });

  test('di luar kotak dijepit 0-1; ukuran atau titik tak valid = null', () => {
    expect(
      tapToVideoPoint({ x: -50, y: 999 }, { width: 100, height: 100 }, { width: 100, height: 100 }),
    ).toEqual({ x: 0, y: 1 });
    expect(
      tapToVideoPoint({ x: 1, y: 1 }, { width: 0, height: 100 }, { width: 100, height: 100 }),
    ).toBeNull();
    expect(
      tapToVideoPoint(
        { x: Number.NaN, y: 1 },
        { width: 100, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toBeNull();
  });
});
