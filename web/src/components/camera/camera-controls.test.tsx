import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clampZoom, type ZoomRange } from '@/modules/serial/lib/camera-controls';
import type { UseCameraScanner } from '@/modules/serial/lib/use-camera-scanner';
import { ScanCameraControls } from './camera-controls';

const RANGE: ZoomRange = { min: 1, max: 2, step: 0.25 };

/** Kamera palsa berstatus: hanya bagian yang dipakai kontrol. */
function Harness({
  range = RANGE,
  initial = 1,
  log,
}: {
  range?: ZoomRange | null;
  initial?: number;
  log: number[];
}) {
  const [zoom, setZoomState] = useState(initial);
  const camera = {
    devices: [],
    torchSupported: false,
    torchOn: false,
    setTorch: async () => {},
    zoom,
    zoomRange: range,
    setZoom: async (value: number) => {
      const next = range ? clampZoom(value, range) : value;
      log.push(next);
      setZoomState(next);
    },
  } as unknown as UseCameraScanner;
  return <ScanCameraControls camera={camera} onSwitchCamera={() => {}} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const plus = () => screen.getByRole('button', { name: 'Perbesar' });
const minus = () => screen.getByRole('button', { name: 'Perkecil' });

test('tombol + dan - nyata (<button>), 44 px, berlabel, satu langkah per tekan', () => {
  const log: number[] = [];
  render(<Harness log={log} />);
  expect(plus().tagName).toBe('BUTTON');
  expect(plus().className).toContain('size-11');
  expect(minus().className).toContain('size-11');

  fireEvent.pointerDown(plus(), { pointerId: 1, button: 0 });
  fireEvent.pointerUp(plus(), { pointerId: 1 });
  expect(log).toEqual([1.25]);
  fireEvent.pointerDown(minus(), { pointerId: 1, button: 0 });
  fireEvent.pointerUp(minus(), { pointerId: 1 });
  expect(log).toEqual([1.25, 1]);
});

test('tombol nonaktif di batas rentang (min menonaktifkan -, max menonaktifkan +)', () => {
  const log: number[] = [];
  const { rerender } = render(<Harness log={log} initial={1} />);
  expect(minus()).toBeDisabled();
  expect(plus()).toBeEnabled();
  rerender(<Harness log={log} initial={2} key="max" />);
  expect(plus()).toBeDisabled();
  expect(minus()).toBeEnabled();
});

test('langkah minimal 0,1x walau langkah perangkat lebih kecil; tanpa rentang kontrol zoom tak dirender', () => {
  const log: number[] = [];
  const { unmount } = render(<Harness log={log} range={{ min: 1, max: 5, step: 0.01 }} />);
  fireEvent.pointerDown(plus(), { pointerId: 1, button: 0 });
  fireEvent.pointerUp(plus(), { pointerId: 1 });
  expect(log).toEqual([1.1]);
  unmount();

  render(<Harness log={log} range={null} />);
  expect(screen.queryByRole('button', { name: 'Perbesar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});

test('papan ketik: Enter/Spasi pada tombol (klik tanpa pointer) menggeser satu langkah, tidak dua kali', () => {
  const log: number[] = [];
  render(<Harness log={log} />);
  // Klik dari papan ketik: detail 0, tanpa pointerdown.
  fireEvent.click(plus(), { detail: 0 });
  expect(log).toEqual([1.25]);
  // Klik dari pointer (detail 1) sudah dihitung pointerdown: tak digandakan.
  fireEvent.pointerDown(plus(), { pointerId: 1, button: 0 });
  fireEvent.pointerUp(plus(), { pointerId: 1 });
  fireEvent.click(plus(), { detail: 1 });
  expect(log).toEqual([1.25, 1.5]);
});

test('menahan tombol: berulang setelah jeda sampai dilepas', () => {
  const log: number[] = [];
  render(<Harness log={log} range={{ min: 1, max: 5, step: 0.1 }} />);
  fireEvent.pointerDown(plus(), { pointerId: 1, button: 0 });
  expect(log).toHaveLength(1);
  // Sebelum jeda 400 ms: belum berulang.
  act(() => {
    vi.advanceTimersByTime(399);
  });
  expect(log).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(1 + 80 * 3);
  });
  expect(log.length).toBeGreaterThanOrEqual(4);
  const atRelease = log.length;
  fireEvent.pointerUp(plus(), { pointerId: 1 });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(log).toHaveLength(atRelease);
  // Tiap pengulangan memakai nilai terbaru (naik bertahap, bukan nilai basi).
  expect(log).toEqual([...log].sort((a, b) => a - b));
  expect(new Set(log).size).toBe(log.length);
});

test('menahan berhenti sendiri di batas (tombol nonaktif) dan saat pointer keluar', () => {
  const log: number[] = [];
  render(<Harness log={log} initial={1.75} />);
  fireEvent.pointerDown(plus(), { pointerId: 1, button: 0 });
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  // 1,75 -> 2 (batas); sesudah itu tak ada panggilan lagi.
  expect(log.at(-1)).toBe(2);
  const count = log.length;
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(log).toHaveLength(count);
  expect(plus()).toBeDisabled();

  const second: number[] = [];
  render(<Harness log={second} range={{ min: 1, max: 5, step: 0.1 }} />);
  const buttons = screen.getAllByRole('button', { name: 'Perbesar' });
  const fresh = buttons.at(-1) as HTMLElement;
  fireEvent.pointerDown(fresh, { pointerId: 1, button: 0 });
  fireEvent.pointerLeave(fresh, { pointerId: 1 });
  const before = second.length;
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(second).toHaveLength(before);
});

test('label zoom: ketuk kembali ke 1x', () => {
  const log: number[] = [];
  render(<Harness log={log} initial={1.5} />);
  fireEvent.click(screen.getByTestId('zoom-value'));
  expect(log).toEqual([1]);
});
