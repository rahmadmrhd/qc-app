import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ZoomSlider } from './zoom-slider';

const range = { min: 1, max: 5, step: 0.1 };
/** Area tekan: y 100..332 (tinggi 232); pusat thumb bergerak di y 116..316 (bantalan 16 px). */
const TOP = 100;
const HEIGHT = 232;

/** Koordinat Y untuk zoom `value` (atas = besar). */
function yOf(value: number): number {
  const fraction = (value - range.min) / (range.max - range.min);
  return TOP + HEIGHT - 16 - fraction * (HEIGHT - 32);
}

let frames: FrameRequestCallback[] = [];
const flushFrame = () => {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    // id = indeks 1-berbasis pada antrean saat itu.
    frames.splice(id - 1, 1);
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Pembungkus terkendali seperti pemakaian nyata: nilai baru dari `onChange` kembali sebagai prop `value`. */
function Controlled({ initial, onChange }: { initial: number; onChange: (value: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ZoomSlider
      value={value}
      range={range}
      length="232px"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function setup(value = 1, onChange = vi.fn()) {
  const view = render(<Controlled initial={value} onChange={onChange} />);
  const slider = screen.getByRole('slider', { name: 'Zoom' });
  slider.getBoundingClientRect = () =>
    ({ top: TOP, height: HEIGHT, left: 0, width: 44, right: 44, bottom: TOP + HEIGHT }) as DOMRect;
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  return { slider, onChange, ...view };
}

test('aksesibel: role slider vertikal dengan min, max, nilai, dan teks nilai', () => {
  const { slider } = setup(1.5);
  expect(slider).toHaveAttribute('aria-orientation', 'vertical');
  expect(slider).toHaveAttribute('aria-valuemin', '1');
  expect(slider).toHaveAttribute('aria-valuemax', '5');
  expect(slider).toHaveAttribute('aria-valuenow', '1.5');
  expect(slider).toHaveAttribute('aria-valuetext', '1,5x');
  expect(slider).toHaveAttribute('tabindex', '0');
});

test('area tekan selebar 44 px dan tanpa gestur gulir bawaan; trek yang terlihat tipis', () => {
  const { slider } = setup();
  expect(slider.className).toContain('w-11');
  expect(slider.className).toContain('touch-none');
  const thumb = screen.getByTestId('zoom-thumb');
  expect(thumb.className).toContain('size-8');
});

test('menekan trek melompat ke posisi itu dan menangkap pointer (atas = besar)', () => {
  const { slider, onChange } = setup();
  fireEvent.pointerDown(slider, { pointerId: 1, clientY: yOf(5), button: 0 });
  expect(slider.setPointerCapture).toHaveBeenCalledWith(1);
  expect(onChange).toHaveBeenLastCalledWith(5);
  fireEvent.pointerUp(slider, { pointerId: 1, clientY: yOf(3) });
  expect(onChange).toHaveBeenLastCalledWith(3);
  expect(slider.releasePointerCapture).toHaveBeenCalledWith(1);
});

test('menggeser mengikuti jari secara proporsional, satu pembaruan per bingkai layar', () => {
  const { slider, onChange } = setup();
  fireEvent.pointerDown(slider, { pointerId: 1, clientY: yOf(1), button: 0 });
  // Posisi awal = nilai sekarang: tak ada perubahan yang dikirim.
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(2) });
  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(2.5) });
  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(4) });
  // Belum ada bingkai: belum ada panggilan; satu bingkai = satu panggilan memakai posisi TERAKHIR.
  expect(onChange).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  flushFrame();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(4);

  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(2) });
  flushFrame();
  expect(onChange).toHaveBeenLastCalledWith(2);
});

test('di luar trek dijepit ke ujung', () => {
  const { slider, onChange } = setup(3);
  fireEvent.pointerDown(slider, { pointerId: 1, clientY: TOP - 500, button: 0 });
  expect(onChange).toHaveBeenLastCalledWith(5);
  fireEvent.pointerMove(slider, { pointerId: 1, clientY: TOP + HEIGHT + 500 });
  flushFrame();
  expect(onChange).toHaveBeenLastCalledWith(1);
});

test('mengangkat jari berhenti menggeser; bingkai tertunda dibatalkan; pointercancel juga berhenti', () => {
  const { slider, onChange } = setup();
  fireEvent.pointerDown(slider, { pointerId: 1, clientY: yOf(1), button: 0 });
  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(3) });
  fireEvent.pointerUp(slider, { pointerId: 1, clientY: yOf(3) });
  expect(frames).toHaveLength(0);
  expect(onChange).toHaveBeenCalledTimes(1);
  // Setelah lepas, gerakan pointer tak menggeser lagi.
  fireEvent.pointerMove(slider, { pointerId: 1, clientY: yOf(5) });
  expect(frames).toHaveLength(0);

  fireEvent.pointerDown(slider, { pointerId: 2, clientY: yOf(2), button: 0 });
  fireEvent.pointerCancel(slider, { pointerId: 2 });
  fireEvent.pointerMove(slider, { pointerId: 2, clientY: yOf(5) });
  expect(frames).toHaveLength(0);
});

test('tombol kanan mouse diabaikan', () => {
  const { slider, onChange } = setup();
  fireEvent.pointerDown(slider, { pointerId: 1, clientY: yOf(5), button: 2, pointerType: 'mouse' });
  expect(onChange).not.toHaveBeenCalled();
});

test('papan ketik: panah satu langkah, PageUp/PageDown 10 langkah, Home/End ke ujung', () => {
  const { slider, onChange } = setup(2);
  fireEvent.keyDown(slider, { key: 'ArrowUp' });
  expect(onChange).toHaveBeenLastCalledWith(2.1);
  fireEvent.keyDown(slider, { key: 'ArrowDown' });
  expect(onChange).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(slider, { key: 'PageUp' });
  expect(onChange).toHaveBeenLastCalledWith(3);
  fireEvent.keyDown(slider, { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith(5);
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith(1);
});

test('papan ketik: di ujung tak ada panggilan baru; tombol lain tak dihiraukan', () => {
  const { slider, onChange } = setup(5);
  fireEvent.keyDown(slider, { key: 'ArrowUp' });
  fireEvent.keyDown(slider, { key: 'a' });
  expect(onChange).not.toHaveBeenCalled();
});

test('posisi thumb mengikuti nilai (0 di bawah, 1 di atas)', () => {
  const { slider } = setup(1);
  const bottom = () => (screen.getByTestId('zoom-thumb') as HTMLElement).style.bottom;
  expect(bottom()).toContain('+ 0 *');
  fireEvent.keyDown(slider, { key: 'End' });
  expect(bottom()).toContain('+ 1 *');
  fireEvent.keyDown(slider, { key: 'PageDown' });
  expect(bottom()).toContain('+ 0.75 *');
  expect(slider).toHaveAttribute('aria-valuenow', '4');
});
