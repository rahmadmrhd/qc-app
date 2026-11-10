import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MarkerCanvas, type MarkerCanvasProps } from './marker-canvas';

// Kotak gambar disimulasikan: 400 x 200 piksel di (100, 50).
const RECT = {
  left: 100,
  top: 50,
  width: 400,
  height: 200,
  x: 100,
  y: 50,
  right: 500,
  bottom: 250,
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...RECT,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function setup(props: Partial<MarkerCanvasProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onMove: vi.fn(),
  };
  render(
    <MarkerCanvas
      src="/img/belakang.jpg"
      width={800}
      height={400}
      marks={[
        { x: 500, y: 500 },
        { x: 995, y: 5 },
      ]}
      selected={null}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, frame: screen.getByRole('group', { name: 'Foto dengan penanda' }) };
}

test('menampilkan gambar dan penanda bernomor pada posisinya', () => {
  const { frame } = setup({ selected: 1 });
  expect(frame.querySelector('img')?.getAttribute('src')).toBe('/img/belakang.jpg');
  const first = screen.getByRole('button', { name: 'Penanda 1' });
  expect(first.textContent).toBe('1');
  expect(first.style.left).toBe('50%');
  expect(first.style.top).toBe('50%');
  expect(first.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Penanda 2' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

test('ketuk area kosong menambah penanda pada permil yang benar', () => {
  const { frame, onAdd } = setup();
  fireEvent.click(frame, { clientX: 300, clientY: 150 });
  expect(onAdd).toHaveBeenCalledWith({ x: 500, y: 500 });
  fireEvent.click(frame, { clientX: 9999, clientY: -9999 });
  expect(onAdd).toHaveBeenLastCalledWith({ x: 1000, y: 0 });
});

test('ketuk penanda memilihnya dan tidak menambah penanda baru', () => {
  const { onAdd, onSelect } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Penanda 2' }), {
    clientX: 300,
    clientY: 150,
  });
  expect(onSelect).toHaveBeenCalledWith(1);
  expect(onAdd).not.toHaveBeenCalled();
});

test('seret penanda memanggil onMove, menjepit di tepi, dan berhenti setelah dilepas', () => {
  const { onMove, onSelect } = setup();
  const marker = screen.getByRole('button', { name: 'Penanda 1' });
  // gerak sebelum ditekan diabaikan
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 200, clientY: 100 });
  expect(onMove).not.toHaveBeenCalled();

  fireEvent.pointerDown(marker, { pointerId: 1, clientX: 300, clientY: 150 });
  expect(onSelect).toHaveBeenCalledWith(0);
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 200, clientY: 100 });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 250, y: 250 });
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 9000, clientY: -500 });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 1000, y: 0 });

  fireEvent.pointerUp(marker, { pointerId: 1 });
  onMove.mockClear();
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 200, clientY: 100 });
  expect(onMove).not.toHaveBeenCalled();
});

test('akhir seretan tidak menambah penanda baru', () => {
  const { frame, onAdd } = setup();
  const marker = screen.getByRole('button', { name: 'Penanda 1' });
  fireEvent.pointerDown(marker, { pointerId: 1, clientX: 300, clientY: 150 });
  fireEvent.pointerUp(marker, { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.click(marker, { clientX: 200, clientY: 100 });
  expect(onAdd).not.toHaveBeenCalled();
  expect(frame).toBeTruthy();
});

test('tombol panah menggeser penanda terfokus 10 permil dan menjepit di tepi', () => {
  const { onMove } = setup();
  const first = screen.getByRole('button', { name: 'Penanda 1' });
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 510, y: 500 });
  fireEvent.keyDown(first, { key: 'ArrowLeft' });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 490, y: 500 });
  fireEvent.keyDown(first, { key: 'ArrowUp' });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 500, y: 490 });
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(onMove).toHaveBeenLastCalledWith(0, { x: 500, y: 510 });

  const second = screen.getByRole('button', { name: 'Penanda 2' });
  fireEvent.keyDown(second, { key: 'ArrowRight' });
  expect(onMove).toHaveBeenLastCalledWith(1, { x: 1000, y: 5 });
  fireEvent.keyDown(second, { key: 'ArrowUp' });
  expect(onMove).toHaveBeenLastCalledWith(1, { x: 995, y: 0 });
});

test('tombol lain tidak menggeser; Escape melepas pilihan', () => {
  const { onMove, onSelect } = setup({ selected: 0 });
  const first = screen.getByRole('button', { name: 'Penanda 1' });
  fireEvent.keyDown(first, { key: 'a' });
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(onSelect).toHaveBeenCalledWith(null);
});

test('disabled mematikan ketuk, seret, dan papan ketik', () => {
  const { frame, onAdd, onMove, onSelect } = setup({ disabled: true });
  fireEvent.click(frame, { clientX: 300, clientY: 150 });
  const marker = screen.getByRole('button', { name: 'Penanda 1' });
  expect((marker as HTMLButtonElement).disabled).toBe(true);
  fireEvent.pointerDown(marker, { pointerId: 1, clientX: 300, clientY: 150 });
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.keyDown(marker, { key: 'ArrowRight' });
  fireEvent.click(marker);
  expect(onAdd).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

test('tanpa penanda: hanya gambar dan area ketuk', () => {
  const { frame, onAdd } = setup({ marks: [] });
  expect(screen.queryByRole('button')).toBeNull();
  fireEvent.click(frame, { clientX: 100, clientY: 50 });
  expect(onAdd).toHaveBeenCalledWith({ x: 0, y: 0 });
});

test('dimensi 0: rasio bingkai diukur dari gambar saat dimuat (naturalWidth/Height)', () => {
  const { frame } = setup({ width: 0, height: 0 });
  expect(frame.getAttribute('style')).toContain('4 / 3');
  const img = frame.querySelector('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
  fireEvent.load(img);
  expect(frame.getAttribute('style')).toContain('1200 / 800');
});

test('dimensi dari DTO dipakai apa adanya; onLoad tidak mengubahnya', () => {
  const { frame } = setup({ width: 800, height: 400 });
  const img = frame.querySelector('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
  fireEvent.load(img);
  expect(frame.getAttribute('style')).toContain('800 / 400');
});
