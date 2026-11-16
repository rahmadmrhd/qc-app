import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { THEME_COLORS } from '../../modules/theme/theme';
import { PRECACHE_MAX_FILE_BYTES, pwaOptions, SERVER_PATH_DENYLIST } from './pwa-config';

/** Cocok bila salah satu regex denylist mengenai path+query (cara Workbox mencocokkan navigasi). */
function denied(pathAndQuery: string): boolean {
  return SERVER_PATH_DENYLIST.some((pattern) => pattern.test(pathAndQuery));
}

test('denylist menolak rute server, berkas berekstensi, sw.js, dan manifest', () => {
  for (const path of [
    '/api/ping',
    '/api/v1/me',
    '/auth/login',
    '/auth/callback?code=1&state=2',
    '/sync',
    '/sync/x',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
  ]) {
    expect(denied(path), path).toBe(true);
  }
});

test('denylist membiarkan rute klien (termasuk awalan yang mirip rute server) dijawab cangkang', () => {
  for (const path of [
    '/',
    '/?authError=x',
    '/handover',
    '/handover?x=1',
    '/handover?q=a/b.c',
    '/item?search=x/y.z',
    '/item/brands/abc',
    '/apiary',
    '/authors',
  ]) {
    expect(denied(path), path).toBe(false);
  }
});

test('manifest memuat semua field FR-P1 dengan warna tema terang', () => {
  const manifest = pwaOptions.manifest;
  if (!manifest) throw new Error('manifest tidak ada');
  expect(manifest).toMatchObject({
    name: 'QC App',
    short_name: 'QC',
    lang: 'id',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLORS.light,
    background_color: THEME_COLORS.light,
  });
});

test('manifest memuat ikon 192 any, 512 any, 512 maskable yang berkasnya ada di web/public', () => {
  const icons = (pwaOptions.manifest ? pwaOptions.manifest.icons : undefined) ?? [];
  const find = (sizes: string, purpose: string) =>
    icons.find((icon) => icon.sizes === sizes && icon.purpose === purpose);
  const expected = [find('192x192', 'any'), find('512x512', 'any'), find('512x512', 'maskable')];
  for (const icon of expected) {
    expect(icon).toBeDefined();
    expect(icon?.type).toBe('image/png');
    // vitest dijalankan dari folder `web/`.
    expect(existsSync(resolve(process.cwd(), 'public', `.${icon?.src}`)), icon?.src).toBe(true);
  }
  expect(icons).toHaveLength(3);
});

test('opsi plugin: generateSW, prompt, tanpa injeksi otomatis, tanpa PWA di dev', () => {
  expect(pwaOptions.strategies).toBe('generateSW');
  expect(pwaOptions.registerType).toBe('prompt');
  expect(pwaOptions.injectRegister).toBe(false);
  expect(pwaOptions.devOptions?.enabled).toBe(false);
});

test('opsi Workbox: fallback navigasi, denylist, pembaruan atas persetujuan, anggaran berkas', () => {
  const workbox = pwaOptions.workbox;
  if (!workbox) throw new Error('workbox tidak ada');
  expect(workbox.navigateFallback).toBe('/index.html');
  expect(workbox.navigateFallbackDenylist).toBe(SERVER_PATH_DENYLIST);
  expect(workbox.skipWaiting).not.toBe(true);
  expect(workbox.clientsClaim).toBe(true);
  expect(workbox.cleanupOutdatedCaches).toBe(true);
  expect(workbox.maximumFileSizeToCacheInBytes).toBe(PRECACHE_MAX_FILE_BYTES);
});

type MatchFn = (options: { url: URL; sameOrigin: boolean }) => boolean;

function ruleMatches(
  rule: { urlPattern: RegExp | string | unknown },
  path: string,
  sameOrigin = true,
): boolean {
  const url = new URL(path, sameOrigin ? 'https://qc.example' : 'https://cdn.example');
  const pattern = rule.urlPattern;
  if (typeof pattern === 'function') return (pattern as MatchFn)({ url, sameOrigin });
  if (pattern instanceof RegExp) return pattern.test(url.href);
  throw new Error('urlPattern tak dikenal');
}

test('runtimeCaching: tepat satu aturan CacheFirst untuk aset berhash same-origin, bukan jalur server', () => {
  const rules = pwaOptions.workbox?.runtimeCaching ?? [];
  expect(rules).toHaveLength(1);
  const rule = rules[0];
  if (!rule) throw new Error('aturan tidak ada');
  expect(rule.handler).toBe('CacheFirst');
  expect(ruleMatches(rule, '/assets/x-abc123.js')).toBe(true);
  // Cadangan WASM pemindai kamera ikut di-cache saat dipakai (tidak dipra-cache: bukan js/css/html/png/svg/woff2).
  expect(ruleMatches(rule, '/assets/zxing_reader-abc123.wasm')).toBe(true);
  expect(pwaOptions.workbox?.globPatterns?.join(',')).not.toContain('wasm');
  for (const path of ['/api/v1/me', '/auth/login', '/sync', '/handover', '/']) {
    expect(ruleMatches(rule, path), path).toBe(false);
  }
  expect(ruleMatches(rule, '/assets/x-abc123.js', false)).toBe(false);
});

test('ambang berkas pra-cache wajar (di atas potongan umum, di bawah anggaran total)', () => {
  expect(PRECACHE_MAX_FILE_BYTES).toBeGreaterThan(0);
  expect(PRECACHE_MAX_FILE_BYTES).toBeLessThan(5_000_000);
});

test('skrip push dan sync diimpor service worker, ada di web/public, dan tidak dipra-cache', () => {
  expect(pwaOptions.workbox?.importScripts).toEqual(['push-sw.js', 'sync-sw.js']);
  expect(pwaOptions.workbox?.globIgnores).toContain('push-sw.js');
  expect(pwaOptions.workbox?.globIgnores).toContain('sync-sw.js');
  expect(existsSync(resolve(process.cwd(), 'public', 'push-sw.js'))).toBe(true);
  expect(existsSync(resolve(process.cwd(), 'public', 'sync-sw.js'))).toBe(true);
});
