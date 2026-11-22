import { afterEach, expect, test, vi } from 'vitest';
import { currentListRoom, measureListRoom, setListRoom } from './list-room';

const root = document.documentElement;

afterEach(() => {
  root.style.removeProperty('--list-room');
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

test('setListRoom memublikasikan yang terbesar ke --list-room dan melepasnya bila semua ruang dilepas', () => {
  const a = Symbol('a');
  const b = Symbol('b');
  setListRoom(a, 120.2);
  expect(root.style.getPropertyValue('--list-room')).toBe('121px');
  setListRoom(b, 300);
  expect(root.style.getPropertyValue('--list-room')).toBe('300px');
  expect(currentListRoom()).toBe(300);
  setListRoom(b, 0);
  expect(root.style.getPropertyValue('--list-room')).toBe('121px');
  setListRoom(a, 0);
  expect(root.style.getPropertyValue('--list-room')).toBe('');
  expect(currentListRoom()).toBe(0);
});

function rectOf(top: number): DOMRect {
  return {
    top,
    bottom: top + 32,
    left: 0,
    right: 300,
    width: 300,
    height: 32,
    x: 0,
    y: top,
  } as DOMRect;
}

test('halaman: ruang = (posisi field - margin gulir + tinggi layar) - tinggi isi tanpa ruang yang sudah ada', () => {
  const anchor = document.createElement('div');
  document.body.append(anchor);
  // jsdom tidak mengenal `scroll-margin-top`: dipalsukan agar margin gulir (tinggi header menempel) ikut dihitung.
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    scrollMarginTop: '60px',
  } as CSSStyleDeclaration);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rectOf(500));
  Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(root, 'scrollHeight', { value: 1500, configurable: true });
  // top = 500 + 100 = 600; 600 - 60 + 800 = 1340 < 1500 -> tak butuh ruang.
  expect(measureListRoom(anchor, 0)).toBe(0);
  // Isi lebih pendek (1100): 1340 - 1100 = 240.
  Object.defineProperty(root, 'scrollHeight', { value: 1100, configurable: true });
  expect(measureListRoom(anchor, 0)).toBe(240);
  // Ruang yang sudah terpasang (200) dihitung sebagai bagian isi: isi sebenarnya 900 -> 440.
  expect(measureListRoom(anchor, 200)).toBe(440);
  Reflect.deleteProperty(window, 'scrollY');
  Reflect.deleteProperty(root, 'scrollHeight');
});

test('di dalam penggulir dialog: dihitung terhadap penggulir itu, bukan halaman', () => {
  const scroller = document.createElement('div');
  scroller.setAttribute('data-slot', 'dialog-scroll');
  const anchor = document.createElement('div');
  scroller.append(anchor);
  document.body.append(scroller);
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rectOf(100));
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rectOf(400));
  Object.defineProperty(scroller, 'scrollTop', { value: 50, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 700, configurable: true });
  // top = 400 - 100 + 50 = 350; 350 + 500 = 850; 850 - 700 = 150.
  expect(measureListRoom(anchor, 0)).toBe(150);
});
