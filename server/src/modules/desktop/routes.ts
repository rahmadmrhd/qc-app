import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { appError } from '@server/core/errors';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import { etagMatches, formatEtag } from '@shared/api';
import { Hono } from 'hono/tiny';

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
