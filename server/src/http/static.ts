import { statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Aset berhash (Vite menaruhnya di `/assets/`): isi tak berubah untuk nama yang sama. */
const IMMUTABLE_PREFIX = '/assets/';
/** Rute klien yang segmen terakhirnya boleh memuat titik (token tautan laporan rusak dan dashboard publik). */
const CLIENT_TOKEN_PREFIXES = ['/laporan/', '/dashboard-publik/'];
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Berkas lain (terutama `index.html`) selalu divalidasi ulang agar rilis baru langsung terlihat. */
const REVALIDATE_CACHE = 'no-cache';
/** Awalan rute server; tidak pernah dijawab dengan `index.html` (fallback SPA). */
const SERVER_PREFIXES = ['/api', '/auth', '/sync'];

/** True bila `pathname` milik rute server (`/api`, `/auth`, `/sync` dan turunannya). */
export function isServerPath(pathname: string): boolean {
  return SERVER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function fileIn(root: string, relative: string): string | null {
  const full = resolve(root, `.${relative}`);
  if (full !== root && !full.startsWith(`${root}${sep}`)) return null; // keluar dari direktori statis
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

function fileResponse(path: string, cache: string, extra: Record<string, string> = {}): Response {
  const file = Bun.file(path);
  return new Response(file, {
    headers: { 'content-type': file.type, 'cache-control': cache, ...extra },
  });
}

/**
 * Pelayan berkas statis web (hasil `bun run build`) dengan fallback SPA: jalur tanpa ekstensi yang tidak cocok
 * dengan berkas dijawab `index.html` (router sisi klien); jalur berekstensi yang tidak ada = 404. Hanya GET/HEAD.
 * Mengembalikan `null` untuk jalur milik server atau metode lain sehingga pemanggil menjawab 404 sendiri.
 */
export function serveStatic(staticDir: string, method: string, pathname: string): Response | null {
  if ((method !== 'GET' && method !== 'HEAD') || isServerPath(pathname)) return null;
  const root = resolve(staticDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response('Permintaan tidak valid', { status: 400 });
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return new Response('Permintaan tidak valid', { status: 400 });
  }
  const direct = decoded === '/' ? null : fileIn(root, decoded);
  if (direct !== null) {
    return fileResponse(
      direct,
      pathname.startsWith(IMMUTABLE_PREFIX) ? IMMUTABLE_CACHE : REVALIDATE_CACHE,
    );
  }
  const last = decoded.split('/').pop() ?? '';
  // `/laporan/<token>` (tautan surel laporan rusak) dan `/dashboard-publik/<token>` memuat titik di tokennya
  // (`v1.<id>.<exp>.<sig>`): itu rute klien, bukan berkas, jadi tetap dijawab cangkang SPA.
  const clientRoute = CLIENT_TOKEN_PREFIXES.some((prefix) => decoded.startsWith(prefix));
  if (last.includes('.') && decoded !== '/' && !clientRoute) {
    return new Response('Not Found', { status: 404 });
  }
  const index = fileIn(root, '/index.html');
  if (index === null) {
    return new Response('Aplikasi web belum dibangun: jalankan `bun run build`.', { status: 404 });
  }
  // Cangkang halaman bertoken (`/laporan/`, `/dashboard-publik/`): tak boleh diindeks, juga sebelum JavaScript jalan
  // (meta `robots` dipasang klien lewat efek, terlalu lambat bagi perayap yang tak menjalankan skrip).
  return fileResponse(index, REVALIDATE_CACHE, clientRoute ? { 'x-robots-tag': 'noindex' } : {});
}
