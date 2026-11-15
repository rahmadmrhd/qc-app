import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReloadGate, shouldBlockReloadKey } from './reload-gate';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  let injecting = false;
  const loaded: string[] = [];
  const gate = createReloadGate({
    isInjecting: () => injecting,
    load: (url) => loaded.push(url),
    settleMs: 1500,
  });
  return {
    gate,
    loaded,
    setInjecting: (value: boolean) => {
      injecting = value;
    },
  };
}

describe('createReloadGate (R2-I1)', () => {
  test('tanpa inject: dimuat langsung', () => {
    const { gate, loaded } = setup();
    expect(gate.load('app://qc/country-lock')).toBe('now');
    expect(loaded).toEqual(['app://qc/country-lock']);
  });

  test('saat inject: ditunda, tak dimuat sampai inject selesai dan masa tenang lewat', async () => {
    const { gate, loaded, setInjecting } = setup();
    setInjecting(true);
    expect(gate.load('app://qc/country-lock')).toBe('deferred');
    expect(loaded).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loaded).toEqual([]);

    setInjecting(false);
    gate.notifyIdle();
    // Masa tenang: renderer masih perlu mencatat serial (pending.add) sebelum dimuat ulang.
    await vi.advanceTimersByTimeAsync(1_400);
    expect(loaded).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(loaded).toEqual(['app://qc/country-lock']);
  });

  test('beberapa permintaan saat inject: hanya yang terakhir dimuat, sekali', async () => {
    const { gate, loaded, setInjecting } = setup();
    setInjecting(true);
    gate.load('app://qc/a');
    gate.load('app://qc/b');
    setInjecting(false);
    gate.notifyIdle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loaded).toEqual(['app://qc/b']);
  });

  test('inject baru dimulai di masa tenang: tetap ditahan sampai idle berikutnya', async () => {
    const { gate, loaded, setInjecting } = setup();
    setInjecting(true);
    gate.load('app://qc/a');
    setInjecting(false);
    gate.notifyIdle();
    await vi.advanceTimersByTimeAsync(1_000);
    setInjecting(true); // inject kedua dimulai sebelum masa tenang habis
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loaded).toEqual([]);
    setInjecting(false);
    gate.notifyIdle();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(loaded).toEqual(['app://qc/a']);
  });

  test('notifyIdle tanpa permintaan tertunda tidak memuat apa pun', async () => {
    const { gate, loaded } = setup();
    gate.notifyIdle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loaded).toEqual([]);
  });

  test('permintaan baru di masa tenang saat tak ada inject: dimuat langsung dan tak ada muat ganda', async () => {
    const { gate, loaded, setInjecting } = setup();
    setInjecting(true);
    gate.load('app://qc/a');
    setInjecting(false);
    gate.notifyIdle();
    await vi.advanceTimersByTimeAsync(500);
    expect(gate.load('app://qc/b')).toBe('now');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loaded).toEqual(['app://qc/b']);
  });

  test('isReloadBlocked mengikuti inject', () => {
    const { gate, setInjecting } = setup();
    expect(gate.isReloadBlocked()).toBe(false);
    setInjecting(true);
    expect(gate.isReloadBlocked()).toBe(true);
  });
});

describe('shouldBlockReloadKey', () => {
  const key = (over: Partial<Parameters<typeof shouldBlockReloadKey>[0]>) => ({
    type: 'keyDown',
    key: 'a',
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...over,
  });

  test.each([
    ['F5', { key: 'F5' }],
    ['Ctrl+F5', { key: 'F5', control: true }],
    ['Ctrl+R', { key: 'r', control: true }],
    ['Ctrl+R huruf besar', { key: 'R', control: true }],
    ['Ctrl+Shift+R', { key: 'R', control: true, shift: true }],
    ['Cmd+R', { key: 'r', meta: true }],
    ['Cmd+Shift+R', { key: 'R', meta: true, shift: true }],
  ])('saat inject: %s diblokir', (_name, over) => {
    expect(shouldBlockReloadKey(key(over), true)).toBe(true);
  });

  test('saat tak ada inject: tak ada yang diblokir', () => {
    expect(shouldBlockReloadKey(key({ key: 'F5' }), false)).toBe(false);
    expect(shouldBlockReloadKey(key({ key: 'r', control: true }), false)).toBe(false);
  });

  test('saat inject: tombol lain, R tanpa Ctrl, dan keyUp tidak diblokir', () => {
    expect(shouldBlockReloadKey(key({ key: 'r' }), true)).toBe(false);
    expect(shouldBlockReloadKey(key({ key: 'a', control: true }), true)).toBe(false);
    expect(shouldBlockReloadKey(key({ key: 'F4' }), true)).toBe(false);
    expect(shouldBlockReloadKey(key({ key: 'F5', type: 'keyUp' }), true)).toBe(false);
  });
});
