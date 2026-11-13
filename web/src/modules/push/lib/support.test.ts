import { describe, expect, test } from 'vitest';
import { devicePermission, platformOf, pushAvailable, pushSupported } from './support';

function win(parts: { sw?: boolean; push?: boolean; notification?: string | null }): Window {
  const w: Record<string, unknown> = { navigator: parts.sw === false ? {} : { serviceWorker: {} } };
  if (parts.push !== false) w.PushManager = class {};
  if (parts.notification !== null) w.Notification = { permission: parts.notification ?? 'default' };
  return w as unknown as Window;
}

describe('pushSupported / devicePermission', () => {
  test('didukung hanya bila service worker, PushManager, dan Notification semuanya ada', () => {
    expect(pushSupported(win({}))).toBe(true);
    expect(pushSupported(win({ sw: false }))).toBe(false);
    expect(pushSupported(win({ push: false }))).toBe(false);
    expect(pushSupported(win({ notification: null }))).toBe(false);
  });

  test('izin mengikuti Notification.permission; tidak didukung = unsupported', () => {
    expect(devicePermission(win({ notification: 'granted' }))).toBe('granted');
    expect(devicePermission(win({ notification: 'denied' }))).toBe('denied');
    expect(devicePermission(win({ notification: 'default' }))).toBe('default');
    expect(devicePermission(win({ sw: false }))).toBe('unsupported');
  });
});

describe('pushAvailable', () => {
  test('hanya bila konfigurasi termuat dan enabled, dan perangkat mendukung push', () => {
    expect(pushAvailable({ enabled: true }, 'default')).toBe(true);
    expect(pushAvailable({ enabled: true }, 'granted')).toBe(true);
    expect(pushAvailable({ enabled: true }, 'denied')).toBe(true);
  });

  test('false bila konfigurasi belum termuat, dimatikan server, atau perangkat tak mendukung', () => {
    expect(pushAvailable(undefined, 'default')).toBe(false);
    expect(pushAvailable({ enabled: false }, 'default')).toBe(false);
    expect(pushAvailable({ enabled: true }, 'unsupported')).toBe(false);
  });
});

describe('platformOf', () => {
  const nav = (userAgent: string, platform = 'Win32', maxTouchPoints = 0) => ({
    userAgent,
    platform,
    maxTouchPoints,
  });

  test('iPhone dan iPadOS (MacIntel bersentuh) = ios; Android = android; sisanya desktop', () => {
    expect(platformOf(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'))).toBe('ios');
    expect(platformOf(nav('Mozilla/5.0 (Macintosh)', 'MacIntel', 5))).toBe('ios');
    expect(platformOf(nav('Mozilla/5.0 (Macintosh)', 'MacIntel', 0))).toBe('desktop');
    expect(platformOf(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8)'))).toBe('android');
    expect(platformOf(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'))).toBe('desktop');
  });
});
