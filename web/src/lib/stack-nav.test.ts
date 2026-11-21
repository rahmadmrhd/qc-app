import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openOverlay, resetOverlayManager } from './nav-stack';
import {
  popTo,
  previousPath,
  pushTo,
  recordLocation,
  replaceTo,
  resetTrail,
  type StackNavigator,
} from './stack-nav';

function at(index: number, path: string) {
  window.history.replaceState({ __TSR_key: `k${index}`, __TSR_index: index }, '', path);
  recordLocation(path);
}

const go = vi.fn();
const nav: StackNavigator<string> = { go, pathOf: (target) => target.split('?')[0] ?? target };

beforeEach(() => {
  go.mockClear();
  resetOverlayManager();
  resetTrail();
  at(1, '/item');
  at(2, '/item/1');
});
afterEach(() => vi.restoreAllMocks());

test('previousPath membaca jejak entri sebelumnya; tanpa jejak = null', () => {
  expect(previousPath()).toBe('/item');
  resetTrail();
  expect(previousPath()).toBeNull();
});

test('replaceTo dan pushTo meneruskan opsi replace yang sesuai', () => {
  replaceTo(nav, '/x');
  pushTo(nav, '/y');
  expect(go).toHaveBeenNthCalledWith(1, '/x', { replace: true });
  expect(go).toHaveBeenNthCalledWith(2, '/y', { replace: false });
});

test('popTo: entri sebelumnya adalah tujuan = history.back tanpa navigasi baru', () => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  popTo(nav, '/item?status=active');
  expect(back).toHaveBeenCalledTimes(1);
  expect(go).not.toHaveBeenCalled();
});

test('popTo: entri sebelumnya bukan tujuan (atau tak diketahui) = replace ke tujuan', () => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  popTo(nav, '/lain');
  expect(go).toHaveBeenCalledWith('/lain', { replace: true });
  resetTrail();
  popTo(nav, '/item');
  expect(go).toHaveBeenCalledTimes(2);
  expect(back).not.toHaveBeenCalled();
});

test('dengan overlay terbuka: navigasi menunggu overlay dilepas dulu', async () => {
  window.innerWidth = 360;
  openOverlay(
    () => undefined,
    () => true,
  );
  replaceTo(nav, '/x');
  expect(go).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/x', { replace: true }));
});
