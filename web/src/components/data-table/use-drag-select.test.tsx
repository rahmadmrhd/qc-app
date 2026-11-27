import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useDragSelect } from './use-drag-select';
import { useRowSelection } from './use-row-selection';

const IDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];

/** Baris i berada di y = i * 100 (r1 = 100). */
let rows: HTMLElement[] = [];
let frames: FrameRequestCallback[] = [];
const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  rows = IDS.map((id) => {
    const el = document.createElement('div');
    el.setAttribute('data-select-id', id);
    document.body.append(el);
    return el;
  });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  document.elementFromPoint = (_x: number, y: number) => {
    const index = Math.round(y / 100) - 1;
    return rows[index] ?? null;
  };
});
afterEach(() => {
  for (const el of rows) el.remove();
  document.elementFromPoint = originalElementFromPoint;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  return renderHook(() => {
    const selection = useRowSelection('t');
    const drag = useDragSelect({ selection, ids: IDS });
    return { selection, drag };
  });
}
const sorted = (set: ReadonlySet<string>) => [...set].sort();
const at = (n: number) => ({ x: 10, y: n * 100, id: 1 });

test('seret dari baris 2 ke baris 5 memilih 2-5; kembali ke baris 3 menyisakan 2-3', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r2', at(2), true));
  act(() => result.current.drag.move(10, 500));
  expect(sorted(result.current.selection.selected)).toEqual(['r2', 'r3', 'r4', 'r5']);
  act(() => result.current.drag.move(10, 300));
  expect(sorted(result.current.selection.selected)).toEqual(['r2', 'r3']);
  act(() => result.current.drag.end());
  expect(result.current.drag.dragging).toBe(false);
});

test('seret mundur ke atas juga memilih rentang', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r5', at(5), true));
  act(() => result.current.drag.move(10, 300));
  expect(sorted(result.current.selection.selected)).toEqual(['r3', 'r4', 'r5']);
});

test('on=false dari baris terpilih melepas rentang dan menjaga pilihan awal di luar rentang', () => {
  const { result } = setup();
  act(() => result.current.selection.setAll(['r1', 'r2', 'r3', 'r4', 'r5'], true));
  act(() => result.current.drag.begin('r2', at(2), false));
  act(() => result.current.drag.move(10, 400));
  expect(sorted(result.current.selection.selected)).toEqual(['r1', 'r5']);
});

test('target di luar daftar tidak mengubah apa pun dan tidak melempar', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r2', at(2), true));
  act(() => result.current.drag.move(10, 900));
  expect(result.current.selection.count).toBe(0);
});

test('tanpa pindah ke baris lain (ketukan) tidak menerapkan apa pun', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r2', at(2), true));
  act(() => result.current.drag.move(10, 205));
  expect(result.current.selection.count).toBe(0);
});

test('gulir otomatis: ke atas dekat tepi atas, ke bawah dekat tepi bawah, berhenti setelah end', () => {
  const scrollBy = vi.fn();
  vi.stubGlobal('scrollBy', scrollBy);
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  const { result } = setup();
  act(() => result.current.drag.begin('r3', { x: 10, y: 300, id: 1 }, true));
  act(() => result.current.drag.move(10, 10));
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect(scrollBy).toHaveBeenCalled();
  expect((scrollBy.mock.calls[0] as number[])[1]).toBeLessThan(0);

  scrollBy.mockClear();
  act(() => result.current.drag.move(10, window.innerHeight - 5));
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect((scrollBy.mock.calls[0] as number[])[1]).toBeGreaterThan(0);

  scrollBy.mockClear();
  act(() => result.current.drag.end());
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect(scrollBy).not.toHaveBeenCalled();
});

test('tekan lama di zona tepi tanpa menarik tidak menggulir otomatis', () => {
  const scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  const { result } = setup();
  act(() => result.current.drag.begin('r3', { x: 10, y: 10, id: 1 }, true));
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect(frames).toHaveLength(0);
  expect(scrollBy).not.toHaveBeenCalled();
  // Gerak kecil di bawah toleransi pun belum menggulir.
  act(() => result.current.drag.move(12, 12));
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect(scrollBy).not.toHaveBeenCalled();
});

test('unmount di tengah seret menghentikan rAF dan mencabut pendengar sentuh', () => {
  const removed = vi.spyOn(document, 'removeEventListener');
  const { result, unmount } = setup();
  act(() => result.current.drag.begin('r3', { x: 10, y: 300, id: 1 }, true));
  act(() => result.current.drag.move(10, 10));
  expect(frames.length).toBeGreaterThan(0);
  unmount();
  expect(frames).toHaveLength(0);
  expect(removed.mock.calls.some(([type]) => type === 'touchmove')).toBe(true);
});

test('active jadi false mengakhiri seret: gerakan berikutnya tidak mengubah pilihan', () => {
  const { result, rerender } = renderHook(
    ({ active }: { active: boolean }) => {
      const selection = useRowSelection('t');
      const drag = useDragSelect({ selection, ids: IDS, active });
      return { selection, drag };
    },
    { initialProps: { active: true } },
  );
  act(() => result.current.drag.begin('r2', at(2), true));
  rerender({ active: false });
  expect(result.current.drag.isActive()).toBe(false);
  act(() => result.current.drag.move(10, 500));
  expect(result.current.selection.count).toBe(0);
});

test('pointerup di window (di luar kartu) mengakhiri seret', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r2', at(2), true));
  expect(result.current.drag.isActive()).toBe(true);
  act(() => {
    window.dispatchEvent(new Event('pointerup'));
  });
  expect(result.current.drag.isActive()).toBe(false);
  act(() => result.current.drag.move(10, 500));
  expect(result.current.selection.count).toBe(0);
});

test('touchmove tak-pasif terpasang permanen dan hanya dibatalkan saat seret hidup', () => {
  const { result } = setup();
  const idle = new Event('touchmove', { cancelable: true });
  document.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  act(() => result.current.drag.begin('r2', at(2), true));
  const live = new Event('touchmove', { cancelable: true });
  document.dispatchEvent(live);
  expect(live.defaultPrevented).toBe(true);
});

test('kartu awal hilang dari DOM mengakhiri seret pada frame berikutnya', () => {
  const { result } = setup();
  act(() => result.current.drag.begin('r3', { x: 10, y: 300, id: 1 }, true));
  act(() => result.current.drag.move(10, 10));
  rows[2]?.remove();
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
  expect(result.current.drag.isActive()).toBe(false);
});

test('touchstart tak didengar (ketukan tetap menghasilkan click); touchmove dibatalkan saat seret hidup', () => {
  const { result } = setup();
  const add = vi.spyOn(document, 'addEventListener');
  act(() => result.current.drag.begin('r2', at(2), true));
  expect(add.mock.calls.some(([type]) => type === 'touchstart')).toBe(false);
  add.mockRestore();
  const start = new Event('touchstart', { cancelable: true });
  document.dispatchEvent(start);
  expect(start.defaultPrevented).toBe(false);
  const move = new Event('touchmove', { cancelable: true });
  document.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(true);
});
