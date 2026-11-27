import { appError, isAppError } from '@server/core/errors';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import { createTokenGuard, noStore } from '@server/modules/desktop/token-guard';
import { etagMatches, formatEtag } from '@shared/api';
import { Hono } from 'hono/tiny';
import { openBlob } from './blob-store';
import { latestBundle } from './repo';

/**
 * Unduhan bundel Country Lock untuk aplikasi desktop (dipasang di `/api/desktop/countrylock`): manifest bundel terbaru dan
 * berkas menurut sha256. Publik tanpa sesi (Country Lock jalan tanpa login) dengan penjaga token bersama katalog desktop
 * (`DESKTOP_CATALOG_TOKEN`, `token-guard.ts`): semua penolakan 404 problem+json yang sama, kegagalan dibatasi per IP.
 * Desktop memverifikasi sha256 tiap berkas terhadap manifest, jadi integritas tak bergantung pada kerahasiaan.
 */
export const countryLockPublicApp = new Hono<AppBindings>();

const guard = createTokenGuard('desktop-countrylock', 'Bundel tidak tersedia');
const SHA256 = /^[0-9a-f]{64}$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

countryLockPublicApp.get('/manifest', async (c) => {
  const rejected = await guard.reject(c);
  if (rejected) return rejected;
  const bundle = await latestBundle(c.env.DB);
  if (bundle === null) return guard.notFound();
  const etag = `${bundle.number}-${bundle.computerHash.slice(0, 16)}`;
  const headers = { 'cache-control': 'no-store', etag: formatEtag(etag) };
  if (etagMatches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bundle.manifestJson, {
    status: 200,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
});

type ParsedRange = { start: number; end: number } | 'invalid' | null;

/** Satu rentang `bytes=a-b` atau `bytes=a-` (akhir dijepit ke ukuran); bentuk lain atau di luar ukuran = `'invalid'`. */
function parseRange(header: string | undefined, size: number): ParsedRange {
  if (header === undefined) return null;
  const match = /^bytes=(\d{1,15})-(\d{0,15})$/.exec(header.trim());
  if (match === null) return 'invalid';
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

countryLockPublicApp.get('/files/:sha256', async (c) => {
  const rejected = await guard.reject(c);
  if (rejected) return rejected;
  const sha256 = c.req.param('sha256');
  if (!SHA256.test(sha256)) return guard.notFound();
  // Hanya berkas yang dirujuk bundel terbit mana pun (termasuk yang masih dapat diaktifkan ulang).
  const referenced = await c.env.DB.prepare(
    'SELECT size FROM cl_bundle_files WHERE sha256 = ? LIMIT 1',
  )
    .bind(sha256)
    .first<{ size: number | string }>();
  if (referenced === null) return guard.notFound();
  const size = Number(referenced.size);
  const range = parseRange(c.req.header('range'), size);
  if (range === 'invalid') {
    const response = noStore(
      problemResponse(
        toProblem(appError('VALIDATION', 'Rentang tidak dapat dipenuhi'), newRequestId(), {
          status: 416,
        }),
      ),
    );
    response.headers.set('content-range', `bytes */${size}`);
    return response;
  }

  // Berkas teks: isi di `cl_revisions.text_body` (dicari lewat jalur dan sha256 yang dirujuk bundel).
  const text = await c.env.DB.prepare(
    'SELECT r.text_body AS body FROM cl_bundle_files b JOIN cl_files f ON f.path = b.path JOIN cl_revisions r ON r.file_id = f.id AND r.sha256 = b.sha256 WHERE b.sha256 = ? AND r.text_body IS NOT NULL LIMIT 1',
  )
    .bind(sha256)
    .first<{ body: string }>();
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': IMMUTABLE,
    'x-content-type-options': 'nosniff',
  };
  if (text !== null) {
    const bytes = new TextEncoder().encode(text.body);
    if (range === null) {
      return new Response(bytes, {
        status: 200,
        headers: { ...baseHeaders, 'content-length': String(bytes.length) },
      });
    }
    const part = bytes.slice(range.start, range.end + 1);
    return new Response(part, {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(part.length),
        'content-range': `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    });
  }

  try {
    const blob = await openBlob(c.env, sha256, range === null ? undefined : range);
    if (range === null) {
      return new Response(blob.stream, {
        status: 200,
        headers: { ...baseHeaders, 'content-length': String(blob.size) },
      });
    }
    const served = blob.range ?? range;
    return new Response(blob.stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(served.end - served.start + 1),
        'content-range': `bytes ${served.start}-${served.end}/${blob.size}`,
      },
    });
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION')) {
      return guard.notFound();
    }
    throw error;
  }
});
