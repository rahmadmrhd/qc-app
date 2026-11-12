import { afterEach, describe, expect, test } from 'vitest';
import { getBridge, isDesktop, shouldRegisterServiceWorker } from './platform';

type WithBridge = { qcBridge?: unknown };
const win = window as unknown as WithBridge;

afterEach(() => {
  delete win.qcBridge;
});

describe('platform', () => {
  test('tanpa window.qcBridge → null dan isDesktop false', () => {
    expect(getBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });

  test('versi di bawah minimum → null', () => {
    win.qcBridge = { version: 0 };
    expect(getBridge()).toBeNull();
  });

  test('versi tak berupa angka → null', () => {
    win.qcBridge = { version: '1' };
    expect(getBridge()).toBeNull();
  });

  test('versi 1 (tanpa bridge.auth) ditolak getBridge tetapi tetap desktop', () => {
    win.qcBridge = { version: 1 };
    expect(getBridge()).toBeNull();
    expect(isDesktop()).toBe(true);
  });

  test('versi cukup → bridge dikembalikan dan isDesktop true', () => {
    const bridge = { version: 2 };
    win.qcBridge = bridge;
    expect(getBridge()).toBe(bridge);
    expect(isDesktop()).toBe(true);
  });

  test('jembatan versi usang tetap dihitung desktop (bukan peramban)', () => {
    win.qcBridge = { version: 0 };
    expect(isDesktop()).toBe(true);
  });

  test('service worker hanya didaftarkan di peramban', () => {
    expect(shouldRegisterServiceWorker()).toBe(true);
    win.qcBridge = { version: 1 };
    expect(shouldRegisterServiceWorker()).toBe(false);
  });
});
