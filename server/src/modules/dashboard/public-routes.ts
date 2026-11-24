import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { readTextLimited } from '@server/http/body';
import { problemResponse, toProblem } from '@server/http/problem';
import { limiterAddress } from '@server/http/proxy';
import { type AppBindings, newRequestId } from '@server/http/security';
import type { PublicQueryInput } from '@shared/dashboard-public';
import { Hono } from 'hono/tiny';
import { hitLimit } from './public-limits';
import { loadPublicDashboard, validatePublicQuery } from './public-view';
import { verifyShareToken } from './share-link';
import { loadShare, type ShareRow } from './share-repo';
import { recordShareVisit } from './share-visits';

/**
 * Halaman publik dashboard (spek dashboard bagian 7.4): sub-aplikasi `/api/public`, SENGAJA di luar `API_ROUTES` dan
 * OpenAPI (tanpa sesi). Satu-satunya syarat akses adalah token bertanda tangan (`share-link.ts`) yang memuat id tautan,
 * lalu baris tautan (ada, tidak dicabut, belum kedaluwarsa) dan hak pembagi saat ini. SEMUA penolakan dijawab 404
 * problem+json yang SAMA agar tak membocorkan sebabnya. Token tidak pernah dicatat (rute ini tidak mencatat apa pun),
 * respons tidak pernah di-cache, tidak boleh diindeks, dan tidak mengirim Referer.
 */
export const publicDashboardApp = new Hono<AppBindings>();

/** Kegagalan token per IP per jendela: terlampaui = 429 (jendela sama dengan pembersih `rate_limits`, 10 menit). */
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
/** Keberhasilan `POST .../query`: per IP dan per tautan, jendela satu menit (mencegah kueri agregat berulang). */
const VIEW_WINDOW_MS = 60 * 1000;
const VIEW_IP_LIMIT = 30;
const VIEW_TOKEN_LIMIT = 120;
/** Badan filter penonton paling banyak ini; lebih = ditolak tanpa dibaca penuh. */
const BODY_MAX_BYTES = 16 * 1024;
const NOT_FOUND_MESSAGE = 'Tautan tidak ditemukan atau sudah tidak berlaku';

const harden = (response: Response): Response => {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
};

const notFound = (): Response =>
  harden(problemResponse(toProblem(appError('NOT_FOUND', NOT_FOUND_MESSAGE), newRequestId())));

const tooMany = (): Response =>
  harden(
    problemResponse(
      toProblem(
        appError('FORBIDDEN', 'Terlalu banyak permintaan, coba lagi nanti'),
        newRequestId(),
        {
          status: 429,
        },
      ),
    ),
  );

const badRequest = (message: string, status: 400 | 413 = 400): Response =>
  harden(problemResponse(toProblem(appError('VALIDATION', message), newRequestId(), { status })));

const failKey = (ip: string): string => `dashboard-share:${limiterAddress(ip)}`;
const viewIpKey = (ip: string): string => `dashboard-view-ip:${limiterAddress(ip)}`;
const viewTokenKey = (shareId: string): string => `dashboard-view-token:${shareId}`;

type PublicContext = { env: AppBindings['Bindings'] };

async function isBlocked(c: PublicContext): Promise<boolean> {
  const row = await c.env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE `key` = ?')
    .bind(failKey(c.env.clientIp ?? 'unknown'))
    .first<{ count: number | string; window_start: number | string }>();
  if (!row) return false;
  const fresh = Number(row.window_start) >= nowOf(c.env) - FAIL_WINDOW_MS;
  return fresh && Number(row.count) >= FAIL_LIMIT;
}

/** Mencatat satu kegagalan token (jendela baru bila yang lama sudah lewat). Gagal mencatat tak mengubah jawaban. */
async function recordFailure(c: PublicContext): Promise<void> {
  const now = nowOf(c.env);
  const cutoff = now - FAIL_WINDOW_MS;
  try {
    await c.env.DB.prepare(
      'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
    )
      .bind(failKey(c.env.clientIp ?? 'unknown'), now, cutoff, cutoff, now)
      .run();
  } catch {
    // pembatas best-effort
  }
}

/** Jalur kegagalan: 429 bila IP sudah melewati batas, selain itu catat kegagalan dan jawab 404 seragam. */
async function reject(c: PublicContext): Promise<Response> {
  if (await isBlocked(c)) return tooMany();
  await recordFailure(c);
  return notFound();
}

/**
 * Token sah (verifikasi murah, tanpa DB, SEBELUM pembatas) dan tautannya ada, belum dicabut, belum kedaluwarsa: baris
 * tautan; selain itu `null`. Tautan sah tidak pernah diblokir pembatas kegagalan (hanya jalur kegagalan yang dihitung).
 */
async function resolveShare(c: PublicContext, token: string): Promise<ShareRow | null> {
  const verified = await verifyShareToken(c.env.SESSION_SECRET, token, nowOf(c.env));
  if (!verified) return null;
  const row = await loadShare(c.env.DB, verified.shareId);
  if (!row || row.revoked_at !== '') return null;
  if (row.expires_at <= new Date(nowOf(c.env)).toISOString()) return null;
  return row;
}

publicDashboardApp.get('/dashboards/:token', async (c) => {
  try {
    const row = await resolveShare(c, c.req.param('token'));
    if (!row) return await reject(c);
    const dto = await loadPublicDashboard(c.env, row, {}, nowOf(c.env));
    if (dto === null) return await reject(c);
    // Hanya GET yang berhasil dihitung kunjungan; gagal mencatat tidak mengubah jawaban (`recordShareVisit` tak melempar).
    await recordShareVisit(
      c.env,
      row.id,
      {
        ip: c.env.clientIp ?? '',
        userAgent: c.req.header('user-agent') ?? null,
        country: c.env.trustedPeer === true ? (c.req.header('cf-ipcountry') ?? null) : null,
      },
      nowOf(c.env),
    );
    return harden(c.json(dto));
  } catch (error) {
    return harden(problemResponse(toProblem(error, newRequestId())));
  }
});

publicDashboardApp.post('/dashboards/:token/query', async (c) => {
  try {
    const row = await resolveShare(c, c.req.param('token'));
    if (!row) return await reject(c);
    // Pembatas keberhasilan: dihitung SEBELUM badan dibaca dan kueri berjalan (kueri agregat adalah biayanya).
    const ip = c.env.clientIp ?? 'unknown';
    const overIp = await hitLimit(c.env, viewIpKey(ip), VIEW_IP_LIMIT, VIEW_WINDOW_MS);
    const overToken = await hitLimit(c.env, viewTokenKey(row.id), VIEW_TOKEN_LIMIT, VIEW_WINDOW_MS);
    if (overIp || overToken) return tooMany();
    const text = await readTextLimited(c.req.raw, BODY_MAX_BYTES);
    if (text === undefined) return badRequest('Badan permintaan terlalu besar', 413);
    let body: unknown;
    try {
      body = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      return badRequest('Badan harus berupa JSON');
    }
    let viewer: PublicQueryInput;
    try {
      viewer = validatePublicQuery(body);
    } catch (error) {
      return badRequest((error as { message?: string }).message ?? 'Filter tidak valid');
    }
    const dto = await loadPublicDashboard(c.env, row, viewer, nowOf(c.env));
    if (dto === null) return await reject(c);
    return harden(c.json(dto));
  } catch (error) {
    return harden(problemResponse(toProblem(error, newRequestId())));
  }
});
