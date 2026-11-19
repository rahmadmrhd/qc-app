import { describe, expect, test } from 'vitest';
import {
  fractionOfZoom,
  keyboardZoom,
  pinchZoom,
  pointerDistance,
  zoomFromTrackY,
  zoomStepOf,
} from './zoom-math';

const range = { min: 1, max: 5, step: 0.1 };

describe('zoomStepOf', () => {
  test('memakai step rentang, tidak lebih kecil dari 0,1x; tanpa rentang 0,5x', () => {
    expect(zoomStepOf({ min: 1, max: 5, step: 0.25 })).toBe(0.25);
    expect(zoomStepOf({ min: 1, max: 5, step: 0.01 })).toBe(0.1);
    expect(zoomStepOf(null)).toBe(0.5);
  });
});

describe('fractionOfZoom', () => {
  test('0 di min, 1 di max, dijepit', () => {
    expect(fractionOfZoom(1, range)).toBe(0);
    expect(fractionOfZoom(5, range)).toBe(1);
    expect(fractionOfZoom(3, range)).toBe(0.5);
    expect(fractionOfZoom(9, range)).toBe(1);
    expect(fractionOfZoom(-1, range)).toBe(0);
  });
  test('rentang tanpa lebar = 0', () => {
    expect(fractionOfZoom(1, { min: 1, max: 1, step: 0.1 })).toBe(0);
  });
});

describe('zoomFromTrackY', () => {
  // Trek setinggi 200 px mulai y=100; bantalan 20 px di tiap ujung (pusat thumb bergerak di y 120..280).
  const track = { top: 100, height: 200, pad: 20 };

  test('ujung atas = zoom maksimum, ujung bawah = minimum (vertikal: atas besar)', () => {
    expect(zoomFromTrackY(120, track, range)).toBe(5);
    expect(zoomFromTrackY(280, track, range)).toBe(1);
  });

  test('proporsional terhadap posisi dan dibulatkan ke langkah', () => {
    expect(zoomFromTrackY(200, track, range)).toBe(3);
    // 1/4 dari bawah: 1 + 0,25 x 4 = 2 (dari y=240).
    expect(zoomFromTrackY(240, track, range)).toBe(2);
  });

  test('di luar trek dijepit ke ujung; tinggi tak valid = null', () => {
    expect(zoomFromTrackY(0, track, range)).toBe(5);
    expect(zoomFromTrackY(999, track, range)).toBe(1);
    expect(zoomFromTrackY(150, { top: 0, height: 0, pad: 0 }, range)).toBeNull();
    expect(zoomFromTrackY(150, { top: 0, height: 30, pad: 20 }, range)).toBeNull();
  });
});

describe('keyboardZoom', () => {
  test('panah naik/kanan menambah, turun/kiri mengurangi satu langkah', () => {
    expect(keyboardZoom('ArrowUp', 2, range)).toBe(2.1);
    expect(keyboardZoom('ArrowRight', 2, range)).toBe(2.1);
    expect(keyboardZoom('ArrowDown', 2, range)).toBe(1.9);
    expect(keyboardZoom('ArrowLeft', 2, range)).toBe(1.9);
  });
  test('PageUp/PageDown melompat 10 langkah; Home/End ke ujung', () => {
    expect(keyboardZoom('PageUp', 2, range)).toBe(3);
    expect(keyboardZoom('PageDown', 2, range)).toBe(1);
    expect(keyboardZoom('Home', 3, range)).toBe(1);
    expect(keyboardZoom('End', 3, range)).toBe(5);
  });
  test('dijepit ke rentang; tombol lain = null', () => {
    expect(keyboardZoom('ArrowUp', 5, range)).toBe(5);
    expect(keyboardZoom('ArrowDown', 1, range)).toBe(1);
    expect(keyboardZoom('a', 2, range)).toBeNull();
  });
});

describe('pointerDistance', () => {
  test('jarak Euclid antara dua titik', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('pinchZoom', () => {
  test('rasio jarak x zoom awal, dibulatkan ke langkah rentang', () => {
    expect(pinchZoom(2, 100, 150, range)).toBe(3);
    expect(pinchZoom(2, 100, 50, range)).toBe(1);
    expect(pinchZoom(2, 100, 100, range)).toBe(2);
  });
  test('dijepit ke min/max rentang', () => {
    expect(pinchZoom(2, 100, 1000, range)).toBe(5);
    expect(pinchZoom(2, 100, 1, range)).toBe(1);
  });
  test('jarak awal nol atau tak valid: zoom awal dipertahankan', () => {
    expect(pinchZoom(2, 0, 50, range)).toBe(2);
    expect(pinchZoom(2, Number.NaN, 50, range)).toBe(2);
  });
});
