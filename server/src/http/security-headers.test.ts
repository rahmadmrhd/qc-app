import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { securityHeaders } from './security';

/**
 * Pemindai kamera Serial Number (`getUserMedia` + cadangan WASM `zxing-wasm`, berkas `.wasm` same-origin dari
 * `/assets/`) membutuhkan dua hal dari header: `Permissions-Policy` tidak melarang kamera untuk origin sendiri, dan
 * tidak ada CSP yang memblokir kompilasi WASM. Server sengaja TIDAK mengirim keduanya (bawaan peramban: kamera
 * diizinkan untuk origin sendiri, WASM tak dibatasi). Bila kelak CSP/Permissions-Policy ditambahkan, tes ini
 * memaksa menyertakan `camera=(self)` dan `'wasm-unsafe-eval'` pada `script-src`.
 */
test('header keamanan tidak menghalangi kamera maupun WASM', async () => {
  const app = new Hono();
  app.use('*', securityHeaders);
  app.get('/', (c) => c.text('ok'));
  const response = await app.request('/');
  const permissions = response.headers.get('permissions-policy');
  if (permissions !== null) expect(permissions).toMatch(/camera=\([^)]*self[^)]*\)/);
  const csp = response.headers.get('content-security-policy');
  if (csp !== null) {
    expect(csp).toContain("'wasm-unsafe-eval'");
  }
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
