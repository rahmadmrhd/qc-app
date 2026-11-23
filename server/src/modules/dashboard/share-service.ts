/**
 * Layanan tautan dashboard publik (spek dashboard bagian 7): membekukan cakupan saat dibagikan, membuat token,
 * mendaftar, dan mencabut. Izin `dashboard: manage` dijaga rute; `url` hanya untuk pembagi dan super admin.
 */
import { writeAudit } from '@server/core/audit';
import { type Env, nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import type { UserContext } from '@server/modules/access/context';
import { widgetMeta } from '@shared/dashboard';
import type { CreateShareInput, DashboardShareDto, ShareScope } from '@shared/dashboard-share';
import { SHARE_LIMITS, shareStatus } from '@shared/dashboard-share';
import { allowedWidgetIds, resolveScope } from './scope';
import { signShareToken } from './share-link';
import {
  countActiveShares,
  insertShareStmt,
  listShares,
  loadShare,
  parseScope,
  revokeShareStmt,
  type ShareRow,
} from './share-repo';
import { assertShareInput } from './share-validate';

const DAY_MS = 86_400_000;

/** URL tautan: disusun server dari `APP_ORIGIN` (tidak pernah dari header permintaan). */
export function shareUrl(env: Env, token: string): string {
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '') ?? '';
  if (origin === '') throw appError('UNAVAILABLE', 'APP_ORIGIN belum dikonfigurasi di server');
  return `${origin}/dashboard-publik/${token}`;
}

/**
 * Membekukan cakupan: BU dan lokasi menjadi himpunan id eksplisit hasil `resolveScope` (hak pembagi saat ini diiris
 * dengan pilihan), BUKAN masukan mentah, sehingga BU yang ditambahkan ke pembagi kemudian tidak ikut. Daftar BU/lokasi
 * kosong dibaca "tanpa filter" (tetap dibatasi hak pembagi), tidak pernah menjadi "semua". Lokasi hanya dibekukan
 * untuk modul yang dipakai widget terpilih (Serah Terima, stok stiker; Serial/Laporan hanya bila `locationFiltered`).
 */
export function freezeScope(user: UserContext, input: CreateShareInput, nowMs: number): ShareScope {
  assertShareInput(input);
  const allowed = new Set(allowedWidgetIds(user));
  if (input.widgets.some((widget) => !allowed.has(widget.id))) {
    throw appError('VALIDATION', 'Ada widget di luar hak akses Anda', {
      widgets: 'Ada widget di luar hak akses Anda',
    });
  }
  const locationFiltered = input.locationFiltered === true;
  const chosenLocations = input.filter.locationIds ?? [];
  if (locationFiltered && chosenLocations.length === 0) {
    throw appError('VALIDATION', 'Pilih minimal satu lokasi untuk membatasi lokasi', {
      'filter.locationIds': 'Pilih minimal satu lokasi',
    });
  }
  const buIds = input.filter.buIds ?? [];
  const resolved = resolveScope(
    user,
    {
      from: input.filter.from,
      to: input.filter.to,
      ...(buIds.length > 0 ? { buIds } : {}),
      ...(locationFiltered ? { locationIds: chosenLocations } : {}),
    },
    nowMs,
  );
  const groups = new Set(input.widgets.map((widget) => widgetMeta(widget.id).group));
  const locationIds = new Set<string>();
  if (groups.has('handover')) for (const id of resolved.handoverLocationIds) locationIds.add(id);
  if (groups.has('sticker')) for (const id of resolved.stockLocationIds) locationIds.add(id);
  if (locationFiltered && (groups.has('serial') || groups.has('report'))) {
    for (const id of resolved.serialLocationIds ?? []) locationIds.add(id);
  }
  return {
    buIds: resolved.buIds,
    locationIds: [...locationIds],
    locationFiltered,
    range: input.range,
    widgets: input.widgets.map((widget) => ({ id: widget.id, filters: widget.filters ?? {} })),
    offers: [...new Set(input.offers)],
  };
}

async function toShareDto(
  env: Env,
  row: ShareRow,
  nowText: string,
  withUrl: boolean,
): Promise<DashboardShareDto> {
  const status = shareStatus(row, nowText);
  const dto: DashboardShareDto = {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status,
    widgetCount: parseScope(row.scope)?.widgets.length ?? 0,
    reportId: row.report_id,
  };
  if (withUrl && status === 'active') {
    const token = await signShareToken(env.SESSION_SECRET, row.id, Date.parse(row.expires_at));
    dto.url = shareUrl(env, token);
  }
  return dto;
}

/** Hanya pembagi (atau super admin) boleh menyalin tautan. */
function mayCopyUrl(user: UserContext, row: ShareRow): boolean {
  return user.isSuperAdmin || row.created_by === user.email;
}

export async function createShare(
  env: Env,
  user: UserContext,
  input: CreateShareInput,
): Promise<DashboardShareDto> {
  const nowMs = nowOf(env);
  const scope = freezeScope(user, input, nowMs);
  if (env.SESSION_SECRET === '') throw appError('UNAVAILABLE', 'Rahasia sesi belum dikonfigurasi');
  shareUrl(env, 'x'); // gagal lebih awal bila APP_ORIGIN kosong
  const now = nowIso(env);
  if ((await countActiveShares(env.DB, user.email, now)) >= SHARE_LIMITS.activePerSharer) {
    throw appError(
      'CONFLICT',
      `Tautan aktif Anda sudah ${SHARE_LIMITS.activePerSharer}; cabut yang tidak dipakai dulu`,
    );
  }
  const id = newId();
  const title = input.title.trim();
  const row: ShareRow = {
    id,
    title,
    created_by: user.email,
    created_at: now,
    expires_at: new Date(nowMs + input.expiresInDays * DAY_MS).toISOString(),
    revoked_at: '',
    revoked_by: '',
    scope: JSON.stringify(scope),
    report_id: '',
  };
  await env.DB.batch([
    insertShareStmt(env.DB, row),
    writeAudit(env.DB, {
      ts: now,
      actor: user.email,
      action: 'dashboard.share_create',
      target: `dashboard_share:${id}`,
      targetId: id,
      after: {
        title,
        expiresAt: row.expires_at,
        range: scope.range,
        widgets: scope.widgets.map((widget) => widget.id),
        buCount: scope.buIds.length,
        locationFiltered: scope.locationFiltered,
      },
    }),
  ]);
  return toShareDto(env, row, now, true);
}

export async function listDashboardShares(
  env: Env,
  user: UserContext,
): Promise<DashboardShareDto[]> {
  const now = nowIso(env);
  const rows = await listShares(env.DB, false);
  return Promise.all(rows.map((row) => toShareDto(env, row, now, mayCopyUrl(user, row))));
}

/** Mencabut tautan (idempoten); pemegang `dashboard: manage` mana pun boleh. Tak dikenal = `NOT_FOUND`. */
export async function revokeShare(env: Env, user: UserContext, id: string): Promise<{ ok: true }> {
  const row = await loadShare(env.DB, id);
  if (!row) throw appError('NOT_FOUND', 'Tautan tidak ditemukan');
  if (row.revoked_at !== '') return { ok: true };
  const now = nowIso(env);
  // Audit hanya bila UPDATE benar-benar mengubah baris (pencabutan serentak tak menulis audit ganda).
  await env.DB.batch([
    revokeShareStmt(env.DB, id, user.email, now),
    env.DB.prepare(
      "INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) SELECT ?, ?, 'dashboard.share_revoke', ?, ?, ?, ? FROM DUAL WHERE ROW_COUNT() > 0",
    ).bind(
      now,
      user.email,
      `dashboard_share:${id}`,
      id,
      JSON.stringify({ revokedAt: '' }),
      JSON.stringify({ revokedAt: now }),
    ),
  ]);
  return { ok: true };
}
