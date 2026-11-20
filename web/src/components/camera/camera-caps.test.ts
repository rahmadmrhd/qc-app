import { expect, test, vi } from 'vitest';
import {
  applyContinuousFocus,
  applyTapFocus,
  applyZoom,
  clampZoom,
  describeCameras,
  formatZoom,
  initialZoom,
  readCameraCaps,
  restoreContinuousFocus,
} from './camera-caps';

function track(caps: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  return {
    getCapabilities: () => caps,
    getSettings: () => settings,
    applyConstraints: vi.fn(async () => undefined),
  } as unknown as MediaStreamTrack & { applyConstraints: ReturnType<typeof vi.fn> };
}

test('readCameraCaps: senter, zoom, dan mode fokus dibaca dengan deteksi fitur', () => {
  expect(readCameraCaps(track({}))).toEqual({
    torch: false,
    zoom: null,
    focusModes: [],
    continuousFocus: false,
    tapFocus: false,
  });
  const caps = readCameraCaps(
    track({
      torch: true,
      zoom: { min: 1, max: 8, step: 0.1 },
      focusMode: ['manual', 'single-shot', 'continuous'],
    }),
  );
  expect(caps).toEqual({
    torch: true,
    zoom: { min: 1, max: 8, step: 0.1 },
    focusModes: ['manual', 'single-shot', 'continuous'],
    continuousFocus: true,
    tapFocus: true,
  });
});

test('readCameraCaps: tanpa getCapabilities, zoom tak valid, atau focusMode bukan larik = tak didukung', () => {
  expect(readCameraCaps({} as MediaStreamTrack).zoom).toBeNull();
  expect(readCameraCaps(track({ zoom: { min: 1, max: 1 } })).zoom).toBeNull();
  expect(readCameraCaps(track({ zoom: { min: 2, max: 1 } })).zoom).toBeNull();
  expect(readCameraCaps(track({ zoom: 3 })).zoom).toBeNull();
  expect(readCameraCaps(track({ focusMode: 'continuous' })).focusModes).toEqual([]);
  // Langkah kosong/0 diberi bawaan 0,1.
  expect(readCameraCaps(track({ zoom: { min: 1, max: 4 } })).zoom).toEqual({
    min: 1,
    max: 4,
    step: 0.1,
  });
  expect(readCameraCaps(track({ zoom: { min: 1, max: 4, step: 0 } })).zoom?.step).toBe(0.1);
  // Hanya continuous: ketuk-fokus tidak ada. Hanya single-shot: continuous tidak ada.
  const onlyContinuous = readCameraCaps(track({ focusMode: ['continuous'] }));
  expect(onlyContinuous.continuousFocus).toBe(true);
  expect(onlyContinuous.tapFocus).toBe(false);
  const onlyShot = readCameraCaps(track({ focusMode: ['single-shot'] }));
  expect(onlyShot.continuousFocus).toBe(false);
  expect(onlyShot.tapFocus).toBe(true);
});

test('clampZoom: dijepit ke rentang dan dibulatkan ke langkah', () => {
  const range = { min: 1, max: 5, step: 0.5 };
  expect(clampZoom(0.2, range)).toBe(1);
  expect(clampZoom(9, range)).toBe(5);
  expect(clampZoom(2.3, range)).toBe(2.5);
  expect(clampZoom(2.2, range)).toBe(2);
  expect(clampZoom(Number.NaN, range)).toBe(1);
  // Hasil tak membawa galat pecahan biner.
  expect(clampZoom(1.3, { min: 1, max: 5, step: 0.1 })).toBe(1.3);
});

test('initialZoom: 1x (dijepit ke rentang), atau nilai trek bila sudah berada di rentang', () => {
  const range = { min: 1, max: 5, step: 0.1 };
  expect(initialZoom(range, undefined)).toBe(1);
  expect(initialZoom(range, 2)).toBe(2);
  expect(initialZoom(range, 99)).toBe(1);
  expect(initialZoom({ min: 2, max: 5, step: 0.1 }, undefined)).toBe(2);
});

test('formatZoom: satu desimal dibuang bila bulat', () => {
  expect(formatZoom(1)).toBe('1x');
  expect(formatZoom(2.5)).toBe('2,5x');
  expect(formatZoom(3.04)).toBe('3x');
});

test('applyContinuousFocus memakai advanced focusMode continuous dan menelan galat', async () => {
  const t = track({ focusMode: ['continuous'] });
  await applyContinuousFocus(t);
  expect(t.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] });
  const bad = track({ focusMode: ['continuous'] });
  bad.applyConstraints.mockRejectedValue(new Error('x'));
  await expect(applyContinuousFocus(bad)).resolves.toBeUndefined();
});

test('applyZoom memakai advanced zoom dan melaporkan berhasil atau tidak', async () => {
  const t = track({ zoom: { min: 1, max: 4, step: 0.1 } });
  expect(await applyZoom(t, 2)).toBe(true);
  expect(t.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
  t.applyConstraints.mockRejectedValue(new Error('x'));
  expect(await applyZoom(t, 3)).toBe(false);
});

test('applyTapFocus: single-shot ke titik 0-1, galat ditelan', async () => {
  const t = track({ focusMode: ['single-shot'] });
  expect(await applyTapFocus(t, { x: 0.25, y: 0.75 })).toBe(true);
  expect(t.applyConstraints).toHaveBeenCalledWith({
    advanced: [
      { focusMode: 'single-shot', pointsOfInterest: [{ x: 0.25, y: 0.75 }] },
      { focusMode: 'single-shot' },
    ],
  });
  t.applyConstraints.mockRejectedValue(new Error('x'));
  expect(await applyTapFocus(t, { x: 0, y: 0 })).toBe(false);
});

test('describeCameras: label Android dijadikan nama mudah dipahami; label lain dipertahankan', () => {
  expect(
    describeCameras([
      { id: 'a', label: 'camera2 0, facing back' },
      { id: 'b', label: 'camera2 1, facing front' },
    ]),
  ).toEqual([
    { id: 'a', label: 'Kamera belakang' },
    { id: 'b', label: 'Kamera depan' },
  ]);
  // Beberapa kamera belakang diberi nomor menurut urutan.
  expect(
    describeCameras([
      { id: 'a', label: 'camera2 0, facing back' },
      { id: 'b', label: 'camera2 1, facing front' },
      { id: 'c', label: 'camera2 2, facing back' },
      { id: 'd', label: 'camera2 3, facing back' },
    ]).map((d) => d.label),
  ).toEqual(['Kamera belakang 1', 'Kamera depan', 'Kamera belakang 2', 'Kamera belakang 3']);
  expect(
    describeCameras([
      { id: 'a', label: 'Integrated Camera (0bda:5634)' },
      { id: 'b', label: 'Kamera 2' },
    ]),
  ).toEqual([
    { id: 'a', label: 'Integrated Camera (0bda:5634)' },
    { id: 'b', label: 'Kamera 2' },
  ]);
});

test('restoreContinuousFocus: continuous + titik tengah, set cadangan tanpa titik; galat ditelan', async () => {
  const t = track({ focusMode: ['continuous'] });
  await restoreContinuousFocus(t);
  expect(t.applyConstraints).toHaveBeenCalledWith({
    advanced: [
      { focusMode: 'continuous', pointsOfInterest: [{ x: 0.5, y: 0.5 }] },
      { focusMode: 'continuous' },
    ],
  });
  t.applyConstraints.mockRejectedValue(new Error('x'));
  await expect(restoreContinuousFocus(t)).resolves.toBeUndefined();
});
