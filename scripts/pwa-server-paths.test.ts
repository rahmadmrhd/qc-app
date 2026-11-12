import { expect, test } from 'bun:test';
import { isServerPath } from '@server/http/static';
import { SERVER_PATH_DENYLIST } from '../web/src/app/pwa/server-paths';

// Kesepakatan: rute yang dianggap milik server oleh `static.ts` HARUS sama dengan yang ditolak service worker
// (navigateFallbackDenylist), supaya navigasi `/auth/callback` dsb. tidak pernah dijawab `index.html` dari cache.
// Berkas berekstensi sengaja hanya ada di sisi service worker (server menjawab 404 untuk berkas tak ada).
const denied = (pathAndQuery: string) =>
  SERVER_PATH_DENYLIST.some((pattern) => pattern.test(pathAndQuery));

test('isServerPath (server) dan denylist service worker sepakat untuk awalan rute server', () => {
  for (const pathname of [
    '/api',
    '/api/x',
    '/api/ping',
    '/api/v1/me',
    '/auth',
    '/auth/login',
    '/auth/callback',
    '/sync',
    '/sync/x',
    '/apiary',
    '/authors',
    '/syncing',
    '/handover',
    '/',
  ]) {
    expect(denied(pathname), pathname).toBe(isServerPath(pathname));
  }
});

test('denylist tetap menolak rute server saat ada query string', () => {
  for (const [pathname, query] of [
    ['/auth/callback', '?code=1&state=2'],
    ['/api/ping', '?x=1'],
    ['/sync', '?x=1'],
  ] as const) {
    expect(isServerPath(pathname)).toBe(true);
    expect(denied(`${pathname}${query}`), `${pathname}${query}`).toBe(true);
  }
});
