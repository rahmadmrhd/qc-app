/**
 * Layanan tautan dashboard publik (spek dashboard bagian 7): membekukan cakupan saat dibagikan, membuat token,
 * mendaftar, dan mencabut. Izin minimal `dashboard: edit` dijaga rute; baris menurut `access.ts` (milik sendiri, atau
 * semua bagi `manage`/super admin).
 */
import { writeAudit } from '@server/core/audit';
import { isGuardFailure } from '@server/core/cas';
import { type Env, nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import type { UserContext } from '@server/modules/access/context';
import type { DashboardFilterInput } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { ReportScope } from '@shared/dashboard-report';
import type {
  CreateShareInput,
  DashboardShareDto,
  ShareScope,
  ShareWidgetScope,
} from '@shared/dashboard-share';
import { SHARE_LIMITS, shareExpiry, shareStatus } from '@shared/dashboard-share';
import { dashboardScopeOf, mayManageRow } from './access';
import { allowedWidgetIds, resolveScope } from './scope';
import { signShareToken } from './share-link';
import {
  activeLimitGuardStmts,
  ensureShareLockStmt,
  insertShareStmt,
  listShares,
  loadShare,
  parseScope,
  revokeShareStmt,
  type ShareRow,
} from './share-repo';
import { assertShareInput } from './share-validate';

/** URL tautan: disusun server dari `APP_ORIGIN` (tidak pernah dari header permintaan). */
export function shareUrl(env: Env, token: string): string {
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '') ?? '';
  if (origin === '') throw appError('UNAVAILABLE', 'APP_ORIGIN belum dikonfigurasi di server');
  return `${origin}/dashboard-publik/${token}`;
}

/** Isi yang dibekukan (tanpa rentang): dipakai tautan (`freezeScope`) dan laporan terjadwal (`freezeContent`). */
export interface FreezeContentInput {
  filter: DashboardFilterInput;
  locationFiltered?: boolean;
  widgets: ShareWidgetScope[];
  offers: string[];
}

/**
 * Membekukan cakupan: BU dan lokasi menjadi himpunan id eksplisit hasil `resolveScope` (hak pembagi saat ini diiris
 * dengan pilihan), BUKAN masukan mentah, sehingga BU yang ditambahkan ke pembagi kemudian tidak ikut. Daftar BU/lokasi
 * kosong dibaca "tanpa filter" (tetap dibatasi hak pembagi), tidak pernah menjadi "semua". Lokasi hanya dibekukan
 * untuk modul yang dipakai widget terpilih (Serah Terima, stok stiker; Serial/Laporan hanya bila `locationFiltered`).
 * `filter.from`/`to` hanya dipakai agar `resolveScope` memiliki rentang sah (isi cakupan tidak bergantung padanya).
 * `options.trustedLists`: lewati batas `FILTER_LIST_MAX` pada daftar BU/lokasi (hanya simpan laporan terjadwal).
 * Validasi isi (judul, rentang, batas widget) milik pemanggil; di sini hanya hak: widget di luar hak = `VALIDATION`.
 */
export function freezeContent(
  user: UserContext,
  input: FreezeContentInput,
  nowMs: number,
  options: { trustedLists?: boolean } = {},
): ReportScope {
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
      // Lokasi pilihan membatasi lokasi Serah Terima/stok TERLEPAS dari `locationFiltered`; flag itu hanya mengatur
      // apakah lokasi juga menjadi saringan Serial/Laporan (di bawah).
      ...(chosenLocations.length > 0 ? { locationIds: chosenLocations } : {}),
    },
    nowMs,
    // Hanya penyimpanan laporan yang melonggarkan batas daftar (validator laporan sudah membatasi ke
    // `REPORT_LIMITS.scopeIdsMax`); tautan bagikan tetap memakai `FILTER_LIST_MAX`.
    options.trustedLists === true ? { trustedLists: true } : {},
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
    widgets: input.widgets.map((widget) => ({ id: widget.id, filters: widget.filters ?? {} })),
    offers: [...new Set(input.offers)],
  };
}

/** Membekukan cakupan tautan: validasi isi tautan, lalu `freezeContent` ditambah rentang. */
export function freezeScope(user: UserContext, input: CreateShareInput, nowMs: number): ShareScope {
  assertShareInput(input);
  return { ...freezeContent(user, input, nowMs), range: input.range };
}

export async function toShareDto(
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

/** Pembagi, atau pengelola semua (`manage`/super admin), boleh menyalin tautan dan mengelolanya penuh. */
export function mayCopyUrl(user: UserContext, row: ShareRow): boolean {
  return mayManageRow(user, row.created_by);
}

/**
 * Baris tautan yang BOLEH dikelola pemanggil (SATU gerbang untuk View, pencabutan, dan log aktivitas tautan): tak
 * dikenal atau milik orang lain bagi pemegang `dashboard: edit` = `NOT_FOUND` seragam (termasuk tautan terbitan laporan
 * terjadwal). Izin modul minimal `edit` dijaga pemanggil.
 */
export async function loadReadableShare(
  env: Env,
  user: UserContext,
  id: string,
): Promise<ShareRow> {
  const row = await loadShare(env.DB, id);
  if (!row || !mayCopyUrl(user, row)) {
    throw appError('NOT_FOUND', 'Tautan tidak ditemukan');
  }
  return row;
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
  const expiry = shareExpiry(input, nowMs);
  if (!expiry.ok) {
    throw appError('VALIDATION', 'Input tidak valid', { [expiry.field]: expiry.message });
  }
  const id = newId();
  const title = input.title.trim();
  const row: ShareRow = {
    id,
    title,
    created_by: user.email,
    created_at: now,
    expires_at: new Date(expiry.ms).toISOString(),
    revoked_at: '',
    revoked_by: '',
    scope: JSON.stringify(scope),
    report_id: '',
  };
  // Batas tautan aktif dijaga DI DALAM batch (kunci baris pembagi + penjaga hitungan): pembuatan serentak diserialkan,
  // jadi total aktif tak pernah melewati batas.
  await env.DB.batch([ensureShareLockStmt(env.DB, user.email)]);
  try {
    await env.DB.batch([
      ...activeLimitGuardStmts(env.DB, user.email, now, SHARE_LIMITS.activePerSharer),
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
  } catch (error) {
    if (isGuardFailure(error)) {
      throw appError(
        'CONFLICT',
        `Tautan aktif Anda sudah ${SHARE_LIMITS.activePerSharer}; cabut yang tidak dipakai dulu`,
      );
    }
    throw error;
  }
  return toShareDto(env, row, now, true);
}

export async function listDashboardShares(
  env: Env,
  user: UserContext,
): Promise<DashboardShareDto[]> {
  const now = nowIso(env);
  // Pemegang `edit` hanya melihat tautannya sendiri; `manage`/super admin semua. Tiap baris yang dikembalikan dapat
  // dikelola penuh pemanggil (termasuk `url`).
  const rows = await listShares(
    env.DB,
    false,
    dashboardScopeOf(user) === 'all' ? undefined : user.email,
  );
  return Promise.all(rows.map((row) => toShareDto(env, row, now, mayCopyUrl(user, row))));
}

/** Mencabut tautan (idempoten); milik sendiri, atau milik siapa pun bagi `manage`/super admin. Selain itu `NOT_FOUND`. */
export async function revokeShare(env: Env, user: UserContext, id: string): Promise<{ ok: true }> {
  const row = await loadReadableShare(env, user, id);
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
