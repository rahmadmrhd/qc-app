import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { type DriveDownload, getBridge } from '@server/core/bridge-client';
import { nowOf } from '@server/core/env';
import { appError, isAppError } from '@server/core/errors';
import { problemResponse, toProblem } from '@server/http/problem';
import { limiterAddress } from '@server/http/proxy';
import { type AppBindings, newRequestId } from '@server/http/security';
import { findActiveFile } from '@server/modules/files/repo';
import { readFile as readAppFile } from '@server/modules/files/service';
import { etagMatches, formatEtag } from '@shared/api';
import { CATALOG_FILE_ID } from '@shared/desktop-catalog';
import { Hono } from 'hono/tiny';
import type { ServedRelease } from './app-release';
import { getServedCatalog } from './catalog';
import { releaseReaderOf } from './release-reader';
import { createTokenGuard } from './token-guard';

/** Rute publik untuk aplikasi desktop (dipasang di `app.route('/api/desktop', desktopApp)`). */
export const desktopApp = new Hono<AppBindings>();

const MANIFEST_FILE = 'ui-manifest.json';
const SIGNATURE_FILE = 'ui-manifest.sig';
/** Manifest sah jauh di bawah ini (ratusan berkas); batas melindungi memori dari berkas salah isi. */
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
/** Berkas `.sig` sah hanya 86 karakter; batas longgar untuk spasi/baris baru ekor. */
const MAX_SIGNATURE_FILE_BYTES = 1024;
/** Tanda tangan Ed25519 = 64 byte = 86 karakter base64url tanpa padding. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

/**
 * Manifest UI bertanda tangan dari `STATIC_DIR` (dibuat `scripts/build-ui-manifest.ts` + `sign-ui-manifest.ts` saat
 * build image). Publik: isinya bukan rahasia, dan desktop memverifikasi tanda tangannya dengan kunci publik tertanam
 * (server tidak memegang kunci apa pun). Semua kegagalan (berkas tak ada/rusak/tak terbaca, belum ditandatangani) =
 * 404 generik tanpa jalur atau penyebab (penyebab hanya di log server).
 */
desktopApp.get('/ui-manifest', async (c) => {
  const notFound = () =>
    problemResponse(toProblem(appError('NOT_FOUND', 'Manifest UI belum tersedia'), newRequestId()));
  const staticDir = c.env.staticDir;
  if (staticDir === undefined) return notFound();

  let served: Served | null;
  try {
    served = await loadManifest(staticDir);
  } catch {
    return notFound();
  }
  if (!served) return notFound();

  const headers = { 'cache-control': 'no-cache', etag: formatEtag(served.etag) };
  if (etagMatches(c.req.header('if-none-match'), served.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return c.json({ manifest: served.manifest, signature: served.signature }, 200, headers);
});

/** Awalan rute berkas bundel UI; sisa jalur = jalur berkas di manifest (tiap segmen di-encode). */
const FILE_PREFIX = '/api/desktop/ui-file/';

/**
 * Berkas bundel UI untuk desktop. Kenapa bukan jalur statis biasa: Cloudflare menyisipkan skrip deteksi bot ke
 * setiap respons `text/html` di tepi, sehingga `index.html` yang diunduh tak lagi cocok dengan ukuran/sha256 di
 * manifest bertanda tangan dan seluruh pembaruan ditolak. Di sini SEMUA berkas disajikan `application/octet-stream`
 * (bukan HTML, jadi tak disentuh) dengan `no-transform`; desktop memverifikasi isinya terhadap manifest.
 * Hanya jalur yang tercantum di manifest bertanda tangan yang dilayani (bukan sembarang berkas di `STATIC_DIR`);
 * selain itu 404 generik. Isinya publik (sama dengan yang disajikan jalur statis).
 */
desktopApp.get('/ui-file/*', async (c) => {
  const notFound = () =>
    problemResponse(toProblem(appError('NOT_FOUND', 'Berkas UI tidak tersedia'), newRequestId()));
  const staticDir = c.env.staticDir;
  const rawPath = new URL(c.req.url).pathname;
  if (staticDir === undefined || !rawPath.startsWith(FILE_PREFIX)) return notFound();

  let relative: string;
  try {
    relative = decodeURIComponent(rawPath.slice(FILE_PREFIX.length));
  } catch {
    return notFound();
  }
  let served: Served | null;
  try {
    served = await loadManifest(staticDir);
  } catch {
    return notFound();
  }
  // Daftar putih = jalur di manifest (tanpa `..`, `\`, atau NUL karena dibuat `build-ui-manifest.ts`); pemeriksaan
  // ulang di bawah menjaga bila manifest dari sumber lain.
  if (!served?.paths.has(relative)) return notFound();
  const root = resolve(staticDir);
  const full = resolve(root, relative);
  if (full === root || !full.startsWith(`${root}${sep}`)) return notFound();
  try {
    if (!(await stat(full)).isFile()) return notFound();
  } catch {
    return notFound();
  }
  return new Response(Bun.file(full), {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
});

interface Served {
  manifest: object;
  signature: string;
  etag: string;
  /** Jalur berkas yang tercantum di manifest (daftar putih rute `ui-file`). */
  paths: Set<string>;
}

/**
 * Memo per proses: kunci = jalur + `mtime`/`size` kedua berkas (`stat` sebelum baca). Berkas hasil build jarang
 * berubah, jadi permintaan publik berulang tak membaca, mem-parse, dan men-hash ulang. Hanya hasil SAH yang
 * dimemo; berkas yang diganti (mtime/size berbeda) membuat memo basi diperbarui.
 */
const memo = new Map<string, { key: string; served: Served }>();
const MEMO_MAX_DIRS = 4;

async function loadManifest(staticDir: string): Promise<Served | null> {
  const manifestPath = join(staticDir, MANIFEST_FILE);
  const signaturePath = join(staticDir, SIGNATURE_FILE);
  const [manifestStat, signatureStat] = await Promise.all([
    stat(manifestPath),
    stat(signaturePath),
  ]);
  // Batas ukuran diperiksa SEBELUM membaca isi.
  if (manifestStat.size > MAX_MANIFEST_BYTES || signatureStat.size > MAX_SIGNATURE_FILE_BYTES) {
    return null;
  }
  const key = `${manifestStat.mtimeMs}:${manifestStat.size}|${signatureStat.mtimeMs}:${signatureStat.size}`;
  const known = memo.get(staticDir);
  if (known?.key === key) return known.served;

  const json = (await readFile(manifestPath)).toString('utf8');
  const signature = (await readFile(signaturePath)).toString('utf8').trim();
  if (!SIGNATURE_PATTERN.test(signature)) {
    console.warn('Manifest UI ditolak: ui-manifest.sig bukan tanda tangan base64url 64 byte');
    return null;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch {
    console.warn('Manifest UI ditolak: ui-manifest.json bukan JSON');
    return null;
  }
  // Bentuk kanonik: desktop memverifikasi `JSON.stringify(manifest)` sebagai byte yang ditandatangani.
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    JSON.stringify(manifest) !== json
  ) {
    console.warn('Manifest UI ditolak: ui-manifest.json bukan objek JSON kanonik');
    return null;
  }
  const etag = createHash('sha256')
    .update(`${json}
${signature}`)
    .digest('hex');
  const files = (manifest as { files?: unknown }).files;
  const paths = new Set<string>();
  if (Array.isArray(files)) {
    for (const entry of files) {
      const entryPath = (entry as { path?: unknown } | null)?.path;
      if (typeof entryPath === 'string') paths.add(entryPath);
    }
  }
  const served: Served = { manifest, signature, etag, paths };
  if (!memo.has(staticDir) && memo.size >= MEMO_MAX_DIRS) memo.clear();
  memo.set(staticDir, { key, served });
  return served;
}

/**
 * Katalog Tipe offline untuk desktop (spek desktop §6.6, keputusan pemilik 2026-11-16): rute baca bertoken bersama,
 * tanpa sesi (Country Lock jalan tanpa login). Penjaga token (waktu-konstan, 404 seragam, batas kegagalan per IP lewat
 * `rate_limits`, `no-store`) ada di `token-guard.ts` dan dipakai bersama rute bundel Country Lock; DTO daftar putih dan
 * token tidak pernah dicatat.
 */
/** Hanya gambar katalog bersama (stiker dan pustaka gambar stiker) yang dapat diunduh lewat rute berkas. */
const CATALOG_FILE_OWNERS = new Set(['sticker', 'stickerguide']);

const catalogGuard = createTokenGuard('desktop-catalog', 'Katalog tidak tersedia');
const catalogNotFound = catalogGuard.notFound;
const rejectCatalog = catalogGuard.reject;

desktopApp.get('/catalog', async (c) => {
  const rejected = await rejectCatalog(c);
  if (rejected) return rejected;
  const served = await getServedCatalog(c.env);
  const headers = { 'cache-control': 'no-store', etag: formatEtag(served.etag) };
  if (etagMatches(c.req.header('if-none-match'), served.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(served.json, {
    status: 200,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
});

desktopApp.get('/catalog/files/:id', async (c) => {
  const rejected = await rejectCatalog(c);
  if (rejected) return rejected;
  const id = c.req.param('id');
  if (!CATALOG_FILE_ID.test(id)) return catalogNotFound();
  const served = await getServedCatalog(c.env);
  if (!served.fileIds.has(id)) return catalogNotFound();
  const record = await findActiveFile(c.env, id);
  if (!record || !CATALOG_FILE_OWNERS.has(record.ownerType)) return catalogNotFound();
  try {
    const file = await readAppFile(
      c.env,
      { id },
      { email: '', itemBuIds: null, canReadStickerFiles: true },
      record,
    );
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') return catalogNotFound();
    throw error;
  }
});

/**
 * Pembaruan aplikasi desktop (spek desktop 5.4, rencana bagian 4): manifest rilis bertanda tangan dan installer dari
 * folder Drive `DESKTOP_RELEASES_FOLDER_ID`. Publik tanpa sesi (Country Lock harus dapat diperbarui tanpa login):
 * integritas dijaga tanda tangan Ed25519 yang diverifikasi aplikasi dengan kunci publik tertanam, bukan kerahasiaan;
 * server tidak memegang kunci apa pun dan TIDAK PERNAH menyebut GitHub (syarat pemilik 2026-11-18). Semua kegagalan
 * (folder belum dikonfigurasi, tak ada rilis, nama tak dikenal, galat Drive) = 404 generik; penyebab hanya di log server.
 */
const releaseNotFound = (): Response =>
  problemResponse(toProblem(appError('NOT_FOUND', 'Pembaruan belum tersedia'), newRequestId()));

desktopApp.get('/app-manifest', async (c) => {
  const arch = c.req.query('arch');
  const reader = releaseReaderOf(c.env);
  if (!reader || (arch !== 'x64' && arch !== 'arm64') || c.req.queries('arch')?.length !== 1) {
    return releaseNotFound();
  }
  let release: ServedRelease | null;
  try {
    release = await reader.latest(arch);
  } catch {
    console.warn('Pembaruan desktop: folder rilis tak terbaca');
    return releaseNotFound();
  }
  if (!release) return releaseNotFound();
  const headers = { 'cache-control': 'no-cache', etag: formatEtag(release.etag) };
  if (etagMatches(c.req.header('if-none-match'), release.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return c.json({ manifest: release.manifest, signature: release.signature }, 200, headers);
});

/** Unduhan installer (~100 MB) dibatasi per IP: 60 permintaan per jam (kantor satu NAT dengan banyak mesin tetap longgar). */
const APP_FILE_LIMIT = 60;
const APP_FILE_WINDOW_MS = 60 * 60 * 1000;
const APP_FILE_PREFIX = '/api/desktop/app-file/';

/** `true` bila IP ini sudah melewati batas (menghitung SETIAP permintaan, bukan hanya yang gagal). */
async function appFileOverLimit(env: AppBindings['Bindings']): Promise<boolean> {
  const key = `desktop-app-file:${limiterAddress(env.clientIp ?? 'unknown')}`;
  const now = nowOf(env);
  const cutoff = now - APP_FILE_WINDOW_MS;
  try {
    await env.DB.prepare(
      'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
    )
      .bind(key, now, cutoff, cutoff, now)
      .run();
    const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE `key` = ?')
      .bind(key)
      .first<{ count: number | string }>();
    return Number(row?.count ?? 0) > APP_FILE_LIMIT;
  } catch {
    return false; // pembatas best-effort
  }
}

desktopApp.get('/app-file/*', async (c) => {
  const reader = releaseReaderOf(c.env);
  if (!reader) return releaseNotFound();
  const rawPath = new URL(c.req.url).pathname;
  if (!rawPath.startsWith(APP_FILE_PREFIX)) return releaseNotFound();
  if (await appFileOverLimit(c.env)) {
    return problemResponse(
      toProblem(appError('FORBIDDEN', 'Terlalu banyak unduhan, coba lagi nanti'), newRequestId(), {
        status: 429,
      }),
    );
  }
  const segments = rawPath.slice(APP_FILE_PREFIX.length).split('/');
  if (segments.length !== 2) return releaseNotFound();
  let version: string;
  let name: string;
  try {
    version = decodeURIComponent(segments[0] as string);
    name = decodeURIComponent(segments[1] as string);
  } catch {
    return releaseNotFound();
  }
  let entry: { id: string; size: number } | null;
  try {
    entry = await reader.file(version, name);
  } catch {
    console.warn('Pembaruan desktop: folder rilis tak terbaca');
    return releaseNotFound();
  }
  if (!entry) return releaseNotFound();
  let download: DriveDownload | null;
  try {
    download = await getBridge(c.env).downloadFile(entry.id, c.env.DESKTOP_RELEASES_FOLDER_ID);
  } catch {
    console.warn('Pembaruan desktop: installer tak terunduh');
    return releaseNotFound();
  }
  if (!download) return releaseNotFound();
  return new Response(download.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(download.size),
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });
});
