import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

  let json: string;
  let signature: string;
  try {
    json = await readLimited(join(staticDir, MANIFEST_FILE));
    signature = (await readLimited(join(staticDir, SIGNATURE_FILE))).trim();
  } catch {
    return notFound();
  }
  if (!SIGNATURE_PATTERN.test(signature)) {
    console.warn('Manifest UI ditolak: ui-manifest.sig bukan tanda tangan base64url 64 byte');
    return notFound();
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch {
    console.warn('Manifest UI ditolak: ui-manifest.json bukan JSON');
    return notFound();
  }
  // Bentuk kanonik: desktop memverifikasi `JSON.stringify(manifest)` sebagai byte yang ditandatangani.
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    JSON.stringify(manifest) !== json
  ) {
    console.warn('Manifest UI ditolak: ui-manifest.json bukan objek JSON kanonik');
    return notFound();
  }

  const etag = createHash('sha256').update(`${json}\n${signature}`).digest('hex');
  const headers = { 'cache-control': 'no-cache', etag: formatEtag(etag) };
  if (etagMatches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return c.json({ manifest, signature }, 200, headers);
});

async function readLimited(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('berkas terlalu besar');
  return bytes.toString('utf8');
}
