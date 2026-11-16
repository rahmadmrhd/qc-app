import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
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
import { getServedCatalog } from './catalog';

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
 * tanpa sesi (Country Lock jalan tanpa login). Aturan rute publik bertoken: token dibandingkan waktu-konstan, SEMUA
 * penolakan = 404 problem+json yang sama (termasuk rute dinonaktifkan karena token belum diisi), kegagalan dibatasi per
 * IP lewat `rate_limits`, DTO daftar putih, `no-store`, dan token tidak pernah dicatat. Token yang sah tidak pernah
 * diblokir pembatas (hanya jalur kegagalan), seperti rute publik laporan serial.
 */
const CATALOG_FAIL_LIMIT = 20;
const CATALOG_FAIL_WINDOW_MS = 10 * 60 * 1000;
/** Hanya gambar katalog bersama (stiker dan pustaka gambar stiker) yang dapat diunduh lewat rute berkas. */
const CATALOG_FILE_OWNERS = new Set(['sticker', 'stickerguide']);

const catalogLimiterKey = (ip: string): string => `desktop-catalog:${limiterAddress(ip)}`;

const noStore = (response: Response): Response => {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
};

const catalogNotFound = (): Response =>
  noStore(
    problemResponse(toProblem(appError('NOT_FOUND', 'Katalog tidak tersedia'), newRequestId())),
  );

const catalogTooMany = (): Response =>
  noStore(
    problemResponse(
      toProblem(
        appError('FORBIDDEN', 'Terlalu banyak percobaan, coba lagi nanti'),
        newRequestId(),
        {
          status: 429,
        },
      ),
    ),
  );

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

function tokenMatches(expected: string, header: string | undefined): boolean {
  const match = /^Bearer (\S{1,512})$/.exec(header ?? '');
  const presented = match?.[1] ?? '';
  // Dibandingkan lewat sha256 agar panjang tetap sama; hasilnya tak bergantung pada awalan yang cocok.
  return timingSafeEqual(digest(expected), digest(presented)) && presented !== '';
}

type CatalogContext = {
  env: AppBindings['Bindings'];
  req: { header(name: string): string | undefined };
};

/** `null` = diizinkan; selain itu respons penolakan (404 seragam, atau 429 untuk IP yang sudah melewati batas). */
async function rejectCatalog(c: CatalogContext): Promise<Response | null> {
  const expected = c.env.DESKTOP_CATALOG_TOKEN ?? '';
  if (expected === '') return catalogNotFound();
  if (tokenMatches(expected, c.req.header('authorization'))) return null;
  const key = catalogLimiterKey(c.env.clientIp ?? 'unknown');
  const now = nowOf(c.env);
  const cutoff = now - CATALOG_FAIL_WINDOW_MS;
  const row = await c.env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE `key` = ?')
    .bind(key)
    .first<{ count: number | string; window_start: number | string }>();
  if (row && Number(row.window_start) >= cutoff && Number(row.count) >= CATALOG_FAIL_LIMIT) {
    return catalogTooMany();
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
    )
      .bind(key, now, cutoff, cutoff, now)
      .run();
  } catch {
    // pembatas best-effort
  }
  return catalogNotFound();
}

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
