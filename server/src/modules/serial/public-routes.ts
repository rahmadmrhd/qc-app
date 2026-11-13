import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { SESSION_COOKIE, verifySessionToken } from '@server/core/session';
import { problemResponse, toProblem } from '@server/http/problem';
import { limiterAddress } from '@server/http/proxy';
import { type AppBindings, newRequestId } from '@server/http/security';
import { loadUserContext } from '@server/modules/access/context';
import { findActiveFile } from '@server/modules/files/repo';
import { readFile } from '@server/modules/files/service';
import { extractFileRefs } from '@shared/items';
import { wibDateIso } from '@shared/postel';
import type { SerialPublicEventDto, SerialPublicReportDto } from '@shared/serial-public';
import { reportLinkExpiresAt } from '@shared/serials';
import { getCookie } from 'hono/cookie';
import { Hono } from 'hono/tiny';
import { readableBuIds } from './access';
import { loadCase } from './case-repo';
import { verifyReportToken } from './public-link';
import { loadSerialRow, type SerialEventRow } from './repo';
import { toEvent, toSummary } from './service';

/**
 * Halaman publik laporan rusak (rancangan 2026-11-14 §4.8, §5a): sub-aplikasi `/api/public`, SENGAJA di luar
 * `API_ROUTES` (tanpa sesi, tanpa kontrak `ApiContract`, tidak masuk OpenAPI). Satu-satunya syarat akses adalah token
 * bertanda tangan (`public-link.ts`) yang memuat id laporan; semua penolakan (token salah, kedaluwarsa, laporan atau
 * berkas tak ada) dijawab 404 problem+json yang SAMA agar tak membocorkan apa pun. Token tidak pernah dicatat di log
 * (rute ini tidak mencatat apa pun) dan respons tidak pernah di-cache.
 */
export const publicSerialApp = new Hono<AppBindings>();

/** Kegagalan token per IP per jendela: terlampaui = 429 (jendela sama dengan pembersih `rate_limits`, 10 menit). */
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const NOT_FOUND_MESSAGE = 'Laporan tidak ditemukan atau tautan sudah tidak berlaku';
const EVENTS_MAX = 500;

const noStore = (response: Response): Response => {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
};

const notFound = (): Response =>
  noStore(problemResponse(toProblem(appError('NOT_FOUND', NOT_FOUND_MESSAGE), newRequestId())));

const tooMany = (): Response =>
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

const limiterKey = (ip: string): string => `serial-report:${limiterAddress(ip)}`;

type PublicContext = { env: AppBindings['Bindings'] };

async function isBlocked(c: PublicContext): Promise<boolean> {
  const row = await c.env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE `key` = ?')
    .bind(limiterKey(c.env.clientIp ?? 'unknown'))
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
      .bind(limiterKey(c.env.clientIp ?? 'unknown'), now, cutoff, cutoff, now)
      .run();
  } catch {
    // pembatas best-effort
  }
}

/** Token sah dan laporannya ada: baris laporan; selain itu `null` (kegagalan dihitung oleh pemanggil). */
async function resolveToken(c: PublicContext, token: string) {
  const verified = await verifyReportToken(c.env.SESSION_SECRET, token, nowOf(c.env));
  if (!verified) return null;
  return loadCase(c.env.DB, verified.caseId);
}

async function viewerCanOpen(
  c: PublicContext & { cookie: string | undefined },
  buId: string,
): Promise<boolean> {
  try {
    const session = await verifySessionToken(c.env, c.cookie, nowOf(c.env));
    if (!session) return false;
    const user = await loadUserContext(c.env, session.email);
    return user !== null && readableBuIds(user).includes(buId);
  } catch {
    return false;
  }
}

publicSerialApp.get('/serial-reports/:token', async (c) => {
  try {
    if (await isBlocked(c)) return tooMany();
    const found = await resolveToken(c, c.req.param('token'));
    if (!found) {
      await recordFailure(c);
      return notFound();
    }
    const [serialRow, bu, events] = await Promise.all([
      loadSerialRow(c.env.DB, found.serial_id),
      c.env.DB.prepare('SELECT name FROM business_units WHERE id = ?')
        .bind(found.bu_id)
        .first<{ name: string }>(),
      c.env.DB.prepare(
        'SELECT id, case_id, seq, type, occurred_on, created_at, actor_name, actor_team, message, changes_json, data_json FROM serial_events WHERE case_id = ? ORDER BY seq ASC LIMIT ?',
      )
        .bind(found.id, EVENTS_MAX)
        .all<SerialEventRow>(),
    ]);
    if (!serialRow) {
      await recordFailure(c);
      return notFound();
    }
    const unit = toSummary(serialRow);
    const closedOn = found.closed_on.trim();
    const expiresAt = reportLinkExpiresAt(closedOn);
    const outcome = found.outcome.trim();
    // Daftar putih field: tanpa `data` kejadian, id aktor, atau alamat surel; stok tak pernah ada di kejadian.
    const publicEvents = events.results.map((row): SerialPublicEventDto => {
      const event = toEvent(row);
      return {
        seq: event.seq,
        type: event.type,
        occurredOn: event.occurredOn,
        actorName: event.actorName,
        actorTeam: event.actorTeam,
        message: event.message,
        changes: event.changes.map((change) => ({
          field: change.field,
          from: change.from,
          to: change.to,
        })),
      };
    });
    const body: SerialPublicReportDto = {
      number: found.number,
      openedOn: found.opened_on,
      closedOn: closedOn === '' ? null : closedOn,
      outcome: outcome === 'good' || outcome === 'broken' ? outcome : null,
      expiresOn: Number.isFinite(expiresAt) ? wibDateIso(expiresAt) : '',
      viewerCanOpen: await viewerCanOpen(
        { env: c.env, cookie: getCookie(c, SESSION_COOKIE) },
        found.bu_id.trim(),
      ),
      serialId: found.serial_id.trim(),
      unit: {
        serial: unit.serial,
        itemLabel: unit.itemLabel,
        buCode: unit.buCode,
        buName: bu?.name ?? '',
        locationName: unit.locationName,
        testDate: unit.testDate,
        sample: unit.sample,
        status: unit.status,
      },
      events: publicEvents,
    };
    return noStore(c.json(body));
  } catch (error) {
    return noStore(problemResponse(toProblem(error, newRequestId())));
  }
});

publicSerialApp.get('/serial-reports/:token/files/:fileId', async (c) => {
  try {
    if (await isBlocked(c)) return tooMany();
    const found = await resolveToken(c, c.req.param('token'));
    if (!found) {
      await recordFailure(c);
      return notFound();
    }
    const fileId = c.req.param('fileId');
    // Berkas hanya boleh dilayani bila dirujuk pesan kejadian LAPORAN INI dan milik serial laporan ini.
    const messages = await c.env.DB.prepare('SELECT message FROM serial_events WHERE case_id = ?')
      .bind(found.id)
      .all<{ message: string }>();
    const referenced = new Set(messages.results.flatMap((row) => extractFileRefs(row.message)));
    if (!referenced.has(fileId)) return notFound();
    const record = await findActiveFile(c.env, fileId);
    if (record?.ownerType !== 'serial' || record.ownerId !== found.serial_id) {
      return notFound();
    }
    const content = await readFile(
      c.env,
      { id: fileId },
      {
        email: '',
        itemBuIds: null,
        canReadStickerFiles: false,
        serialBuIds: [found.bu_id.trim()],
      },
      record,
    );
    return noStore(
      new Response(content.bytes, {
        status: 200,
        headers: { 'Content-Type': content.mime, 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'NOT_FOUND') return notFound();
    return noStore(problemResponse(toProblem(error, newRequestId())));
  }
});
