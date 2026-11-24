import { expect, test, vi } from 'vitest';
import { completeDesktopLogin } from './complete-desktop-login';

test('login desktop selesai: jendela dimuat ulang agar boot normal menyalakan penyinkron dan pemulihan antrean', () => {
  const reload = vi.fn();
  completeDesktopLogin(reload);
  expect(reload).toHaveBeenCalledTimes(1);
});
