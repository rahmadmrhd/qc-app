/**
 * Layanan laporan dashboard terjadwal (spek dashboard bagian 7a): CRUD, hak (pemilik atau super admin mengubah;
 * pemegang `dashboard: manage` lain hanya melihat metadata), batas per pemilik, dan pembekuan cakupan saat disimpan.
 * Izin modul (`dashboard: manage`) dijaga rute. Pengiriman ada di `run.ts`.
 */
import { createHash, createHmac } from 'node:crypto';
import { writeAudit } from '@server/core/audit';
import { CAS_UPDATED_AT_SET, isGuardFailure } from '@server/core/cas';
import { type Env, nowIso, nowOf } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { newId } from '@server/core/id';
import type { UserContext } from '@server/modules/access/context';
import {
  type DashboardReportDto,
  type DashboardReportListDto,
  type DashboardReportPreviewDto,
  initialRunKey,
  nextRunAt,
  periodRange,
  REPORT_LIMITS,
  type ReportPeriod,
  type ReportSchedule,
  type ReportScope,
  type ReportStatus,
  type SaveDashboardReportInput,
  scheduleLabel,
  wibNow,
} from '@shared/dashboard-report';
import { wibDateIso } from '@shared/postel';
import { hitLimit } from '../public-limits';
import { listSharesOfReport, revokeReportSharesStmt, type ShareRow } from '../share-repo';
import { freezeContent, toShareDto } from '../share-service';
import {
  ensureReportLockStmt,
  insertReportStmt,
  listReportRows,
  loadReport,
  ownerLimitGuardStmts,
  parsePeriod,
  parseRecipients,
  parseReportScope,
  parseSchedule,
  type ReportRow,
} from './repo';
import { runReport } from './run';
import { assertReportInput, cleanReportName, normalizeRecipients } from './validate';

/** Maks. tautan terbitan yang ditampilkan di detail laporan. */
export const REPORT_LINKS_SHOWN = 10;
/** Jendela batas kirim uji (satu jam). */
const TEST_WINDOW_MS = 3_600_000;

const FALLBACK_SCHEDULE: ReportSchedule = { frequency: 'daily', hour: 0, weekday: 1, monthDay: 1 };
const FALLBACK_PERIOD: ReportPeriod = 'yesterday';

/** Hanya pemilik atau super admin yang mengubah, menjeda, mengirim uji, melihat pratinjau/tautan, atau menghapus. */
export function canEditReport(user: UserContext, row: Pick<ReportRow, 'owner'>): boolean {
  return user.isSuperAdmin || row.owner === user.email;
}

/** JSON jadwal dengan urutan kunci tetap (dipakai membandingkan perubahan jadwal). */
function scheduleJson(schedule: ReportSchedule): string {
  return JSON.stringify({
    frequency: schedule.frequency,
    hour: schedule.hour,
    weekday: schedule.weekday,
    monthDay: schedule.monthDay,
  });
}

function scopeJson(scope: ReportScope): string {
  return JSON.stringify({
    buIds: scope.buIds,
    locationIds: scope.locationIds,
    locationFiltered: scope.locationFiltered,
    widgets: scope.widgets,
    offers: scope.offers,
  });
}

/** Cakupan yang dilihat pemegang `manage` lain: hanya daftar widget (tanpa filter, BU, lokasi, atau penawaran). */
function redactScope(scope: ReportScope): ReportScope {
  return {
    buIds: [],
    locationIds: [],
    locationFiltered: scope.locationFiltered,
    widgets: scope.widgets.map((widget) => ({ id: widget.id, filters: {} })),
    offers: [],
  };
}

const EMPTY_SCOPE: ReportScope = {
  buIds: [],
  locationIds: [],
  locationFiltered: false,
  widgets: [],
  offers: [],
};

export function toReportDto(
  user: UserContext,
  row: ReportRow,
  nowMs: number,
  links?: DashboardReportDto['links'],
): DashboardReportDto {
  const canEdit = canEditReport(user, row);
  const schedule = parseSchedule(row.schedule) ?? FALLBACK_SCHEDULE;
  const recipients = parseRecipients(row.recipients);
  const scope = parseReportScope(row.scope) ?? EMPTY_SCOPE;
  const enabled = row.enabled === 1;
  const status = row.last_status as ReportStatus;
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    enabled,
    schedule,
    period: parsePeriod(row.period) ?? FALLBACK_PERIOD,
    scope: canEdit ? scope : redactScope(scope),
    recipients: canEdit ? recipients : [],
    recipientCount: recipients.length,
    linkDays: row.link_days,
    lastStatus: status === 'ok' || status === 'skipped' || status === 'error' ? status : '',
    lastNote: row.last_note,
    lastRunAt: row.last_run_at,
    nextRunAt: enabled ? nextRunAt(schedule, nowMs, row.last_run_key) : '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit,
    ...(links === undefined ? {} : { links }),
  };
}

/**
 * Tanda pendek (HMAC berkunci rahasia sesi) atas daftar penerima: audit mencatat PERUBAHAN penerima tanpa pernah
 * memuat alamat. Tak dapat dibalik tanpa rahasia server.
 */
function recipientsMark(env: Env, recipients: readonly string[]): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update([...recipients].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** Snapshot audit: tanpa alamat penerima, isi surel, atau token. */
function snapshot(
  env: Env,
  row: Pick<
    ReportRow,
    'name' | 'enabled' | 'schedule' | 'period' | 'scope' | 'recipients' | 'link_days'
  >,
): Record<string, unknown> {
  const schedule = parseSchedule(row.schedule) ?? FALLBACK_SCHEDULE;
  const scope = parseReportScope(row.scope) ?? EMPTY_SCOPE;
  const recipients = parseRecipients(row.recipients);
  return {
    name: row.name,
    enabled: row.enabled === 1,
    schedule: scheduleLabel(schedule),
    period: row.period,
    widgets: scope.widgets.map((widget) => widget.id),
    buCount: scope.buIds.length,
    locationCount: scope.locationIds.length,
    locationFiltered: scope.locationFiltered,
    recipientCount: recipients.length,
    recipientsMark: recipientsMark(env, recipients),
    linkDays: row.link_days,
  };
}

async function requireReport(env: Env, id: string): Promise<ReportRow> {
  const row = await loadReport(env.DB, id);
  if (!row) throw appError('NOT_FOUND', 'Laporan tidak ditemukan');
  return row;
}

function requireEditable(user: UserContext, row: ReportRow): void {
  if (!canEditReport(user, row)) {
    throw appError('FORBIDDEN', 'Hanya pemilik laporan yang boleh melakukan ini');
  }
}

export async function listDashboardReports(
  env: Env,
  user: UserContext,
): Promise<DashboardReportListDto> {
  const nowMs = nowOf(env);
  const rows = await listReportRows(env.DB);
  return {
    reports: rows.map((row) => toReportDto(user, row, nowMs)),
    smtpConfigured: env.MAILER !== undefined,
    limit: REPORT_LIMITS.perOwner,
  };
}

export async function getDashboardReport(
  env: Env,
  user: UserContext,
  id: string,
): Promise<DashboardReportDto> {
  const row = await requireReport(env, id);
  const nowMs = nowOf(env);
  if (!canEditReport(user, row)) return toReportDto(user, row, nowMs);
  const now = nowIso(env);
  const shares: ShareRow[] = await listSharesOfReport(env.DB, row.id, REPORT_LINKS_SHOWN);
  const links = await Promise.all(shares.map((share) => toShareDto(env, share, now, true)));
  return toReportDto(user, row, nowMs, links);
}

/** Simpan (buat atau ubah) laporan. Pemilik = pembuat; mengubah hanya oleh pemilik atau super admin. */
export async function saveDashboardReport(
  env: Env,
  user: UserContext,
  input: SaveDashboardReportInput,
): Promise<DashboardReportDto> {
  assertReportInput(input);
  const nowMs = nowOf(env);
  const now = nowIso(env);
  const existing = input.id === undefined ? null : await requireReport(env, input.id);
  if (existing !== null) requireEditable(user, existing);

  // Rentang filter tak dipakai laporan (periode relatif); hanya agar `resolveScope` punya rentang sah.
  const range = periodRange(input.period, wibDateIso(nowMs));
  const scope = freezeContent(
    user,
    {
      filter: { ...input.filter, from: range.from, to: range.to },
      locationFiltered: input.locationFiltered === true,
      widgets: input.widgets,
      offers: input.offers,
    },
    nowMs,
    { trustedLists: true },
  );
  const name = cleanReportName(input.name);
  const recipients = normalizeRecipients(input.recipients);
  const schedule = scheduleJson(input.schedule);
  const wasEnabled = existing === null ? true : existing.enabled === 1;
  const enabled = input.enabled ?? wasEnabled;
  const resetKey = initialRunKey(input.schedule, wibNow(nowMs));

  if (existing === null) {
    const id = newId();
    const row: ReportRow = {
      id,
      name,
      owner: user.email,
      enabled: enabled ? 1 : 0,
      schedule,
      period: input.period,
      scope: scopeJson(scope),
      recipients: JSON.stringify(recipients),
      link_days: input.linkDays,
      last_run_key: resetKey,
      last_run_at: '',
      last_status: '',
      last_note: '',
      created_at: now,
      updated_at: now,
      version: 1,
    };
    // Batas per pemilik dijaga DI DALAM batch (kunci baris pemilik + penjaga hitungan): pembuatan serentak diserialkan.
    await env.DB.batch([ensureReportLockStmt(env.DB, user.email)]);
    try {
      await env.DB.batch([
        ...ownerLimitGuardStmts(env.DB, user.email, REPORT_LIMITS.perOwner),
        insertReportStmt(env.DB, row),
        writeAudit(env.DB, {
          ts: now,
          actor: user.email,
          action: 'dashboard.report_create',
          target: `dashboard_report:${id}`,
          targetId: id,
          after: snapshot(env, row),
        }),
      ]);
    } catch (error) {
      if (isGuardFailure(error)) {
        throw appError(
          'CONFLICT',
          `Laporan Anda sudah ${REPORT_LIMITS.perOwner}; hapus yang tidak dipakai dulu`,
        );
      }
      throw error;
    }
    return getDashboardReport(env, user, id);
  }

  if (input.expectedUpdatedAt === undefined) {
    throw appError('VALIDATION', 'Versi laporan wajib disertakan', {
      expectedUpdatedAt: 'Muat ulang halaman lalu simpan lagi',
    });
  }
  if (input.expectedUpdatedAt !== existing.updated_at) {
    throw staleError('Laporan sudah diubah pihak lain; muat ulang lalu coba lagi');
  }
  // Kunci periode dihitung ulang hanya bila jadwal/periode berubah atau laporan dilanjutkan dari jeda: laporan tidak
  // langsung terkirim ke penerima eksternal (kirim uji untuk mencoba segera). Selain itu tidak disentuh agar klaim
  // pengirim yang sedang berjalan tidak tertimpa.
  const rescheduled =
    schedule !== existing.schedule || input.period !== existing.period || (!wasEnabled && enabled);
  const after: ReportRow = {
    ...existing,
    name,
    enabled: enabled ? 1 : 0,
    schedule,
    period: input.period,
    scope: scopeJson(scope),
    recipients: JSON.stringify(recipients),
    link_days: input.linkDays,
    updated_at: now,
    version: existing.version + 1,
  };
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE dashboard_reports SET name = ?, enabled = ?, schedule = ?, period = ?, scope = ?, recipients = ?, link_days = ?, ${rescheduled ? 'last_run_key = ?, ' : ''}${CAS_UPDATED_AT_SET}, version = version + 1 WHERE id = ?`,
      ).bind(
        name,
        after.enabled,
        schedule,
        input.period,
        after.scope,
        after.recipients,
        input.linkDays,
        ...(rescheduled ? [resetKey] : []),
        existing.updated_at,
        now,
        existing.id,
      ),
      writeAudit(env.DB, {
        ts: now,
        actor: user.email,
        action: 'dashboard.report_update',
        target: `dashboard_report:${existing.id}`,
        targetId: existing.id,
        before: snapshot(env, existing),
        after: snapshot(env, after),
      }),
    ]);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw staleError('Laporan sudah diubah pihak lain; muat ulang lalu coba lagi');
    }
    throw error;
  }
  return getDashboardReport(env, user, existing.id);
}

/** Menjeda atau melanjutkan laporan (idempoten). Dilanjutkan = kunci periode dihitung ulang (tak langsung terkirim). */
export async function setDashboardReportEnabled(
  env: Env,
  user: UserContext,
  input: { id: string; enabled: boolean },
): Promise<DashboardReportDto> {
  const row = await requireReport(env, input.id);
  requireEditable(user, row);
  if ((row.enabled === 1) === input.enabled) return getDashboardReport(env, user, row.id);
  const nowMs = nowOf(env);
  const now = nowIso(env);
  const schedule = parseSchedule(row.schedule) ?? FALLBACK_SCHEDULE;
  const action = input.enabled ? 'dashboard.report_resume' : 'dashboard.report_pause';
  // `updated_at` dinaikkan agar formulir yang sedang terbuka ditolak CAS (bukan menimpa keadaan jeda).
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE dashboard_reports SET enabled = ?, ${input.enabled ? 'last_run_key = ?, ' : ''}updated_at = ?, version = version + 1 WHERE id = ? AND enabled = ?`,
    ).bind(
      input.enabled ? 1 : 0,
      ...(input.enabled ? [initialRunKey(schedule, wibNow(nowMs))] : []),
      now,
      row.id,
      row.enabled,
    ),
    // Audit hanya bila UPDATE benar-benar mengubah baris (perubahan serentak tak menulis audit ganda).
    env.DB.prepare(
      'INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) SELECT ?, ?, ?, ?, ?, ?, ? FROM DUAL WHERE ROW_COUNT() > 0',
    ).bind(
      now,
      user.email,
      action,
      `dashboard_report:${row.id}`,
      row.id,
      JSON.stringify({ enabled: row.enabled === 1 }),
      JSON.stringify({ enabled: input.enabled }),
    ),
  ]);
  return getDashboardReport(env, user, row.id);
}

/** Menghapus laporan: baris dihapus dan tautan terbitannya dicabut dalam satu transaksi. */
export async function removeDashboardReport(
  env: Env,
  user: UserContext,
  id: string,
): Promise<{ ok: true }> {
  const row = await requireReport(env, id);
  requireEditable(user, row);
  const now = nowIso(env);
  await env.DB.batch([
    // Kunci baris laporan lebih dulu: penerbitan tautan oleh pengirim mengunci baris yang sama (`reportExistsGuardStmts`),
    // jadi tautan yang terbit sebelum penghapusan ikut dicabut di bawah, dan yang sesudahnya tak pernah terbit.
    env.DB.prepare('SELECT id FROM dashboard_reports WHERE id = ? FOR UPDATE').bind(row.id),
    // Audit hanya bila barisnya masih ada (penghapusan serentak tak menulis audit ganda).
    env.DB.prepare(
      "INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) SELECT ?, ?, 'dashboard.report_delete', ?, ?, ?, ? FROM dashboard_reports WHERE id = ?",
    ).bind(
      now,
      user.email,
      `dashboard_report:${row.id}`,
      row.id,
      JSON.stringify(snapshot(env, row)),
      JSON.stringify(null),
      row.id,
    ),
    revokeReportSharesStmt(env.DB, row.id, user.email, now),
    env.DB.prepare('DELETE FROM dashboard_reports WHERE id = ?').bind(row.id),
  ]);
  return { ok: true };
}

/**
 * Kirim uji: satu surel berawalan [UJI] HANYA ke surel pemilik, dibatasi `REPORT_LIMITS.testPerHour` per jam per
 * pemilik (tiap percobaan dihitung, juga yang gagal). Hanya pemilik atau super admin. Tanpa SMTP = `UNAVAILABLE`;
 * laporan yang dilewati atau gagal dihitung = `CONFLICT` dengan alasannya (tanpa alamat atau isi surel).
 */
export async function sendTestDashboardReport(
  env: Env,
  user: UserContext,
  id: string,
): Promise<{ ok: true }> {
  const row = await requireReport(env, id);
  requireEditable(user, row);
  if (env.MAILER === undefined) throw appError('UNAVAILABLE', 'SMTP belum diatur di server');
  const limited = await hitLimit(
    env,
    `dashboard-report-test:${createHash('sha256').update(row.owner).digest('hex')}`,
    REPORT_LIMITS.testPerHour,
    TEST_WINDOW_MS,
  );
  if (limited) {
    throw appError(
      'CONFLICT',
      `Kirim uji dibatasi ${REPORT_LIMITS.testPerHour} kali per jam; coba lagi nanti`,
    );
  }
  const outcome = await runReport(env, row, nowOf(env), 'test');
  if (outcome.status !== 'ok') {
    throw appError('CONFLICT', outcome.note || 'Surel uji tidak terkirim');
  }
  await env.DB.batch([
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: user.email,
      action: 'dashboard.report_send_test',
      target: `dashboard_report:${row.id}`,
      targetId: row.id,
      after: { name: row.name },
    }),
  ]);
  return { ok: true };
}

/**
 * Pratinjau surel: HTML yang dihitung sekarang dengan hak pemilik, tanpa mengirim dan tanpa membuat tautan (tombol =
 * tautan contoh yang tak berfungsi). Hanya pemilik atau super admin (isinya dihitung dari hak pemilik).
 */
export async function previewDashboardReport(
  env: Env,
  user: UserContext,
  id: string,
): Promise<DashboardReportPreviewDto> {
  const row = await requireReport(env, id);
  requireEditable(user, row);
  const outcome = await runReport(env, row, nowOf(env), 'preview');
  if (outcome.status !== 'ok' || outcome.rendered === undefined) {
    throw appError('CONFLICT', outcome.note || 'Pratinjau tidak dapat dibuat');
  }
  return { subject: outcome.rendered.subject, html: outcome.rendered.html };
}
