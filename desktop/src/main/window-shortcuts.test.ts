import { describe, expect, test } from 'vitest';
import {
  applyWindowShortcut,
  nextZoomLevel,
  type ShortcutInput,
  type ShortcutTarget,
  windowShortcutAction,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from './window-shortcuts';

const input = (key: string, extra: Partial<ShortcutInput> = {}): ShortcutInput => ({
  type: 'keyDown',
  key,
  control: false,
  meta: false,
  alt: false,
  ...extra,
});

describe('windowShortcutAction', () => {
  test('Ctrl+= dan Ctrl++ (Shift+=) memperbesar', () => {
    expect(windowShortcutAction(input('=', { control: true }))).toBe('zoomIn');
    expect(windowShortcutAction(input('+', { control: true }))).toBe('zoomIn');
  });

  test('Ctrl+- memperkecil, Ctrl+0 mengembalikan', () => {
    expect(windowShortcutAction(input('-', { control: true }))).toBe('zoomOut');
    expect(windowShortcutAction(input('_', { control: true }))).toBe('zoomOut');
    expect(windowShortcutAction(input('0', { control: true }))).toBe('zoomReset');
  });

  test('Cmd (meta) di macOS setara Ctrl', () => {
    expect(windowShortcutAction(input('=', { meta: true }))).toBe('zoomIn');
    expect(windowShortcutAction(input('-', { meta: true }))).toBe('zoomOut');
    expect(windowShortcutAction(input('0', { meta: true }))).toBe('zoomReset');
  });

  test('F11 = layar penuh, hanya tanpa modifier dan bukan pengulangan tombol', () => {
    expect(windowShortcutAction(input('F11'))).toBe('toggleFullscreen');
    expect(windowShortcutAction(input('F11', { control: true }))).toBeNull();
    expect(windowShortcutAction(input('F11', { meta: true }))).toBeNull();
    expect(windowShortcutAction(input('F11', { alt: true }))).toBeNull();
    expect(windowShortcutAction(input('F11', { isAutoRepeat: true }))).toBeNull();
  });

  test('tanpa Ctrl/Cmd, tombol zoom diteruskan ke halaman (mengetik = , -, 0)', () => {
    for (const key of ['=', '+', '-', '_', '0']) {
      expect(windowShortcutAction(input(key))).toBeNull();
    }
  });

  test('Alt aktif (termasuk AltGr = Ctrl+Alt) bukan pintasan', () => {
    for (const key of ['=', '+', '-', '0']) {
      expect(windowShortcutAction(input(key, { control: true, alt: true }))).toBeNull();
    }
  });

  test('hanya keyDown: keyUp dan char diabaikan', () => {
    expect(windowShortcutAction(input('=', { control: true, type: 'keyUp' }))).toBeNull();
    expect(windowShortcutAction(input('F11', { type: 'keyUp' }))).toBeNull();
    expect(windowShortcutAction(input('0', { control: true, type: 'char' }))).toBeNull();
  });

  test('tombol lain tak dikenali (F5, Ctrl+R, Ctrl+1, F12, Ctrl+I)', () => {
    const cases: [string, Partial<ShortcutInput>][] = [
      ['F5', {}],
      ['r', { control: true }],
      ['1', { control: true }],
      ['F12', {}],
      ['I', { control: true }],
      ['a', { control: true }],
      ['F10', {}],
    ];
    for (const [key, extra] of cases) {
      expect(windowShortcutAction(input(key, extra))).toBeNull();
    }
  });
});

describe('nextZoomLevel', () => {
  test('langkah 0,5 dan jepit ke [-3, 3]', () => {
    expect(ZOOM_STEP).toBe(0.5);
    expect(nextZoomLevel(0, 'zoomIn')).toBe(0.5);
    expect(nextZoomLevel(0, 'zoomOut')).toBe(-0.5);
    expect(nextZoomLevel(2.5, 'zoomIn')).toBe(ZOOM_MAX);
    expect(nextZoomLevel(ZOOM_MAX, 'zoomIn')).toBe(ZOOM_MAX);
    expect(nextZoomLevel(-2.5, 'zoomOut')).toBe(ZOOM_MIN);
    expect(nextZoomLevel(ZOOM_MIN, 'zoomOut')).toBe(ZOOM_MIN);
  });

  test('reset selalu ke 0; aksi layar penuh tak mengubah tingkat', () => {
    expect(nextZoomLevel(2, 'zoomReset')).toBe(0);
    expect(nextZoomLevel(-3, 'zoomReset')).toBe(0);
    expect(nextZoomLevel(1.5, 'toggleFullscreen')).toBe(1.5);
  });

  test('tingkat di luar rentang atau tak valid dijepit/dianggap 0', () => {
    expect(nextZoomLevel(9, 'zoomIn')).toBe(ZOOM_MAX);
    expect(nextZoomLevel(-9, 'zoomOut')).toBe(ZOOM_MIN);
    expect(nextZoomLevel(Number.NaN, 'zoomIn')).toBe(0.5);
  });
});

describe('applyWindowShortcut', () => {
  function target(zoom = 0, full = false) {
    const state = { zoom, full };
    const t: ShortcutTarget = {
      getZoomLevel: () => state.zoom,
      setZoomLevel: (level) => {
        state.zoom = level;
      },
      isFullScreen: () => state.full,
      setFullScreen: (flag) => {
        state.full = flag;
      },
    };
    return { state, t };
  }

  test('zoom memakai tingkat saat ini', () => {
    const { state, t } = target(1);
    applyWindowShortcut('zoomIn', t);
    expect(state.zoom).toBe(1.5);
    applyWindowShortcut('zoomOut', t);
    applyWindowShortcut('zoomOut', t);
    expect(state.zoom).toBe(0.5);
    applyWindowShortcut('zoomReset', t);
    expect(state.zoom).toBe(0);
  });

  test('F11 membalik layar penuh dan tidak menyentuh zoom', () => {
    const { state, t } = target(1);
    applyWindowShortcut('toggleFullscreen', t);
    expect(state).toEqual({ zoom: 1, full: true });
    applyWindowShortcut('toggleFullscreen', t);
    expect(state).toEqual({ zoom: 1, full: false });
  });
});
