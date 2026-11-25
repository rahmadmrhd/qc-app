/**
 * Pengiriman laporan dashboard terjadwal (spek dashboard 7a.2, 7a.4, 7a.5, 7a.9).
 *
 * `checkDashboardReports` dipanggil loop 5 menit (`startDashboardReportLoop`): untuk tiap laporan aktif yang jatuh tempo
 * ia memeriksa hal murah dulu (pemilik aktif, masih `dashboard` minimal `edit`, ada widget yang boleh), MENGKLAIM periode lewat
 * CAS `last_run_key` SEBELUM menghitung dan mengirim (dua pemeriksaan serentak = satu surel), lalu menghitung dengan
 * mesin widget yang sama dengan aplikasi (hak PEMILIK saat itu), menerbitkan satu baris tautan publik, merender, dan
 * mengirim satu surel dengan `bcc`. Gagal di titik mana pun = klaim dipulihkan dan tautan terbitan dihapus (kompensasi),
 * sehingga percobaan berikutnya di hari terjadwal yang sama mencoba lagi tanpa menumpuk baris. `skipped` tidak
 * mengklaim apa pun. Tak ada log yang memuat alamat penerima, token, atau isi surel; catatan galat dibersihkan.
 *
 * `runReport` dipakai tiga mode: `scheduled` (penerima laporan), `test` (hanya satu surel ke penguji, awalan [UJI],
 * tanpa klaim dan tanpa mengubah status terakhir), dan `preview` (hanya merender dengan tautan contoh, tanpa tautan dan
 * tanpa kirim). Surel uji TIDAK PERNAH menerbitkan tautan publik (juga untuk laporan milik sendiri): tombolnya ke halaman
 * Dashboard di aplikasi (perlu masuk), keputusan pemilik produk 2026-11-24. Mode `test`/`preview` dapat dijalankan oleh
 * pengelola semua pada laporan milik orang lain (`actor`): isinya irisan hak pemilik DAN hak pelaku, dengan penanda bila
 * ada yang disembunyikan dan surel uji ke alamat pelaku. Batas waktu pengiriman datang dari mesin widget (15 dtk per widget setelah dapat slot) dan batas waktu
 * soket SMTP; tidak ada pembungkus yang meninggalkan pengiriman setengah jalan (itu dapat menggandakan surel).
 */
import { isGuardFailure } from '@server/core/cas';
import { type Env, nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { redactSecrets } from '@server/core/redact';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { widgetMeta } from '@shared/dashboard';
import { type EmailWidgetData, toEmailDto } from '@shared/dashboard-public';
import {
  isDue,
  periodKey,
  periodRange,
  REPORT_PERIOD_LABELS,
  type ReportPeriod,
  type ReportSchedule,
  type ReportScope,
  scheduleLabel,
  wibNow,
} from '@shared/dashboard-report';
import type { ShareScope } from '@shared/dashboard-share';
import { type MailLists, mailListsCount } from '@shared/mail-lists';
import { wibDateIso } from '@shared/postel';
import { publicActorName } from '@shared/serials';
import { mayOwnDashboardItems } from '../access';
import { computeShareWidgets } from '../public-view';
import { allowedWidgetIds, resolveScope } from '../scope';
import { buScopeNames, locationScopeNames } from '../scope-names';
import { signShareToken } from '../share-link';
import { deleteShareStmt, insertShareStmt, type ShareRow } from '../share-repo';
import { shareUrl } from '../share-service';
import { type EmailWidgetInput, type RenderedEmail, renderReportEmail } from './render';
import {
  claimRunKey,
  listEnabledReportRows,
  loadReportVersion,
  parseMailLists,
  parsePeriod,
  parseReportScope,
  parseSchedule,
  type ReportRow,
  type RunClaim,
  recordRunResult,
  releaseRunKey,
  reportExistsGuardStmts,
} from './repo';

export type ReportRunMode = 'scheduled' | 'test' | 'preview';

export interface ReportRunOutcome {
  status: 'ok' | 'skipped' | 'error';
  /** Alasan singkat tanpa rahasia (disimpan sebagai `last_note`). */
  note: string;
  /** Hanya mode `preview` yang sukses. */
  rendered?: RenderedEmail;
  /** Isi dipangkas karena hak pelaku lebih sempit dari hak pemilik (hanya bila `actor` bukan pemilik). */
  trimmed?: boolean;
}

const DAY_MS = 86_400_000;
const NOTE_MAX = 200;
/** Tautan contoh di pratinjau: tidak berfungsi (token tak sah = 404 seragam). */
const PREVIEW_PATH = '/dashboard-publik/contoh';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SCOPE_NAMES_SHOWN = 4;

const skipped = (note: string): ReportRunOutcome => ({ status: 'skipped', note });

/** `2026-11-23` menjadi `23 Nov 2026`. */
function formatDate(date: string): string {
  const [year = '', month = '1', day = '1'] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}

function periodLabelOf(period: ReportPeriod, from: string, to: string): string {
  const label = REPORT_PERIOD_LABELS[period];
  return from === to
    ? `${label} (${formatDate(from)})`
    : `${label} (${formatDate(from)} - ${formatDate(to)})`;
}

function namesLabel(names: readonly string[], none: string): string {
  if (names.length === 0) return none;
  if (names.length <= SCOPE_NAMES_SHOWN) return names.join(', ');
  return `${names.slice(0, SCOPE_NAMES_SHOWN).join(', ')} dan ${names.length - SCOPE_NAMES_SHOWN} lainnya`;
}

/** Catatan hasil: dibersihkan dari alamat penerima dan rahasia, dipotong. */
function noteOf(error: unknown, recipients: readonly string[], secret: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = redactSecrets(raw, secret, ...recipients)
    .replace(/\s+/g, ' ')
    .trim();
  return `Gagal: ${cleaned}`.slice(0, NOTE_MAX);
}

interface ParsedReport {
  schedule: ReportSchedule;
  period: ReportPeriod;
  scope: ReportScope;
  lists: MailLists;
}

/** Menguraikan baris; `null` bila konfigurasi rusak (data lama/rusak tidak pernah dikirim). */
function parseRow(row: ReportRow): ParsedReport | null {
  const schedule = parseSchedule(row.schedule);
  const period = parsePeriod(row.period);
  const scope = parseReportScope(row.scope);
  if (schedule === null || period === null || scope === null) return null;
  return { schedule, period, scope, lists: parseMailLists(row) };
}

/** Pemeriksaan murah sebelum klaim: pemilik aktif, masih berhak membagikan, ada widget yang boleh dilihat. */
async function ownerCheck(
  env: Env,
  row: ReportRow,
  scope: ReportScope,
): Promise<{ owner: UserContext } | ReportRunOutcome> {
  const owner = await loadUserContext(env, row.owner);
  if (owner === null) return skipped('Pemilik tidak aktif');
  if (!mayOwnDashboardItems(owner)) {
    return skipped('Pemilik tidak lagi berhak membagikan');
  }
  const allowed = new Set(allowedWidgetIds(owner));
  if (!scope.widgets.some((widget) => allowed.has(widget.id))) {
    return skipped('Tidak ada widget yang dapat ditampilkan');
  }
  return { owner };
}

interface Issued {
  id: string;
  url: string;
  expiresMs: number;
}

/** Laporan dihapus, dijeda, atau diubah pemilik di tengah pengiriman: surel tidak boleh dikirim dengan data lama. */
class ReportChangedError extends Error {
  constructor() {
    super('Laporan berubah saat pengiriman');
  }
}

const CHANGED_NOTE = 'Laporan diubah atau dihapus saat pengiriman; periode ini dilewati';

/**
 * Menerbitkan satu baris tautan publik milik laporan (rentang tetap = periode surel). Penyisipan dijaga di batch yang
 * sama: baris laporan dikunci dan harus masih ada dan `version`-nya masih milik klaim (hanya pengiriman terjadwal),
 * sehingga tak ada tautan yatim untuk laporan yang baru dihapus atau diubah.
 */
async function issueLink(
  env: Env,
  row: ReportRow,
  scope: ShareScope,
  nowMs: number,
  claim: RunClaim,
): Promise<Issued> {
  if (env.SESSION_SECRET === '') throw appError('UNAVAILABLE', 'Rahasia sesi belum dikonfigurasi');
  const expiresMs = nowMs + row.link_days * DAY_MS;
  const id = newId();
  // `shareUrl` gagal lebih awal bila `APP_ORIGIN` kosong, sebelum menulis baris apa pun.
  const url = shareUrl(env, await signShareToken(env.SESSION_SECRET, id, expiresMs));
  const share: ShareRow = {
    id,
    title: row.name,
    created_by: row.owner,
    created_at: nowIso(env),
    expires_at: new Date(expiresMs).toISOString(),
    revoked_at: '',
    revoked_by: '',
    scope: JSON.stringify(scope),
    report_id: row.id,
  };
  try {
    await env.DB.batch([
      ...reportExistsGuardStmts(env.DB, row.id, claim.version),
      insertShareStmt(env.DB, share),
    ]);
  } catch (error) {
    if (isGuardFailure(error)) throw new ReportChangedError();
    throw error;
  }
  return { id, url, expiresMs };
}

function expiresLabel(expiresMs: number, linkDays: number): string {
  return `${formatDate(wibDateIso(expiresMs))} (${linkDays} hari)`;
}

function dashboardUrl(env: Env): string {
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '') ?? '';
  return `${origin}/dashboard`;
}

function previewUrl(env: Env): string {
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '') ?? '';
  return `${origin}${PREVIEW_PATH}`;
}

/**
 * Menjalankan satu laporan. Pemeriksa jadwal sudah memeriksa jatuh tempo dan mengklaim periode (mode `scheduled`);
 * di sini: hak pemilik, hitung, terbitkan tautan, render, kirim. Mengembalikan hasil; TIDAK pernah melempar untuk
 * kegagalan pengiriman (dikembalikan sebagai `error`), tetapi mode `test`/`preview` yang tak punya mailer dijaga pemanggil.
 */
export async function runReport(
  env: Env,
  row: ReportRow,
  nowMs: number,
  mode: ReportRunMode,
  claim: RunClaim | null = null,
  actor?: UserContext,
): Promise<ReportRunOutcome> {
  const parsed = parseRow(row);
  if (parsed === null) return { status: 'error', note: 'Konfigurasi laporan tidak terbaca' };
  const checked = await ownerCheck(env, row, parsed.scope);
  if ('status' in checked) return checked;
  const { owner } = checked;

  // Pelaku selain pemilik hanya berarti pada `test`/`preview` (pengiriman terjadwal selalu hak pemilik saat itu).
  const foreign =
    mode !== 'scheduled' && actor !== undefined && actor.email !== row.owner ? actor : undefined;
  const lists: MailLists =
    mode === 'test' ? { recipients: [actor?.email ?? row.owner], cc: [], bcc: [] } : parsed.lists;
  const addresses = [...lists.recipients, ...lists.cc, ...lists.bcc];
  if (mode !== 'preview' && addresses.length === 0) {
    return skipped('Tidak ada penerima yang sah');
  }
  if (mode !== 'preview' && env.MAILER === undefined) return skipped('SMTP belum diatur');

  let issued: Issued | null = null;
  try {
    const range = periodRange(parsed.period, wibDateIso(nowMs));
    const frozen: ShareScope = {
      ...parsed.scope,
      range: { mode: 'fixed', from: range.from, to: range.to },
    };
    const computed = await computeShareWidgets(env, owner, frozen, {}, nowMs, foreign);
    if (foreign !== undefined && computed.widgets.length === 0) {
      // Tanpa menyebut isi laporan milik orang lain: hak pelaku tak mencakup satu pun widget yang berlaku.
      return {
        status: 'error',
        note: 'Tidak ada data yang dapat ditampilkan dengan hak akses Anda',
      };
    }
    const widgets: EmailWidgetInput[] = [];
    for (const result of computed.results) {
      if (result.status !== 'ok') continue;
      const data: EmailWidgetData = toEmailDto(result.id, result.data);
      widgets.push({ meta: widgetMeta(result.id), data });
    }
    if (widgets.length === 0) {
      return { status: 'error', note: 'Tidak ada widget yang berhasil dihitung' };
    }

    // Lokasi yang tampil = yang masih hak pemilik saat kirim (Serah Terima, stok), ditambah lokasi pilihan beku bila ada
    // widget Serial/Laporan yang memakainya sebagai saringan (di sana lokasi bukan hak). Sama dengan halaman publik:
    // lokasi yang haknya sudah dicabut tidak tampil di kepala surel.
    const usesLocationFilter =
      parsed.scope.locationFiltered &&
      computed.widgets.some((widget) => {
        const group = widgetMeta(widget.id).group;
        return group === 'serial' || group === 'report';
      });
    const nameableLocations = new Set([
      ...computed.scope.handoverLocationIds,
      ...computed.scope.stockLocationIds,
    ]);
    if (usesLocationFilter) {
      // Pelaku bukan pemilik: nama lokasi saringan hanya yang juga hak pelaku (Serah Terima atau stok), seperti bagian lain.
      const actorLocations =
        foreign === undefined
          ? null
          : resolveScope(foreign, { from: range.from, to: range.to }, nowMs);
      const permitted =
        actorLocations === null
          ? null
          : new Set([...actorLocations.handoverLocationIds, ...actorLocations.stockLocationIds]);
      for (const id of parsed.scope.locationIds) {
        if (permitted === null || permitted.has(id)) nameableLocations.add(id);
      }
    }
    const nameableLocationIds = parsed.scope.locationIds.filter((id) => nameableLocations.has(id));
    const [buNames, locationNames] = await Promise.all([
      buScopeNames(env, computed.scope.buIds),
      locationScopeNames(env, nameableLocationIds),
    ]);
    const scopeLabel = [
      `BU: ${namesLabel(buNames.names, 'tidak ada')}`,
      locationNames.names.length > 0 ? `Lokasi: ${namesLabel(locationNames.names, '')}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' | ');

    let ctaUrl: string;
    let linkExpires: string;
    if (mode === 'preview') {
      ctaUrl = previewUrl(env);
      linkExpires = expiresLabel(nowMs + row.link_days * DAY_MS, row.link_days);
    } else if (mode === 'test') {
      // Surel uji (milik sendiri maupun orang lain): tombol ke halaman Dashboard di aplikasi (perlu masuk; pengguna
      // terdaftar mana pun mendarat di dashboard-nya sendiri). Surel uji tidak pernah menerbitkan tautan publik
      // (keputusan pemilik produk 2026-11-24).
      ctaUrl = dashboardUrl(env);
      linkExpires = 'Tautan ke aplikasi (perlu masuk)';
    } else {
      // Cakupan tautan = cakupan laporan menurut hak pemilik saat ini: widget di luar hak dibuang dan BU diiris.
      // Hak pemilik tetap dihitung ulang tiap tautan dibuka (`loadPublicDashboard`).
      const linkScope: ShareScope = {
        ...frozen,
        widgets: computed.widgets,
        buIds: computed.scope.buIds,
      };
      if (claim === null) throw new Error('Klaim periode tidak ada untuk pengiriman terjadwal');
      issued = await issueLink(env, row, linkScope, nowMs, claim);
      ctaUrl = issued.url;
      linkExpires = expiresLabel(issued.expiresMs, row.link_days);
    }

    const rendered = renderReportEmail({
      reportName: row.name,
      periodLabel: periodLabelOf(parsed.period, range.from, range.to),
      scopeLabel,
      scheduleLabel: scheduleLabel(parsed.schedule),
      ownerName: publicActorName(row.owner),
      widgets,
      ctaUrl,
      linkExpiresLabel: linkExpires,
      ...(mode === 'test' ? { test: true } : {}),
      ...(mode === 'preview' ? { testNotice: true } : {}),
      ...(mode === 'test' ? { buttonToApp: true } : {}),
      ...(computed.trimmed ? { trimmed: true } : {}),
    });
    if (mode === 'preview') {
      return { status: 'ok', note: '', rendered, ...(computed.trimmed ? { trimmed: true } : {}) };
    }

    const mailer = env.MAILER;
    if (mailer === undefined) throw new Error('SMTP belum diatur');
    // Pemeriksaan terakhir sebelum surel keluar: laporan masih ada dan belum diubah sejak klaim (penerima, cakupan,
    // jeda, jadwal). Jendela yang tersisa hanya selama satu panggilan SMTP.
    const version = await loadReportVersion(env.DB, row.id);
    if (version === null || (claim !== null && version !== claim.version)) {
      throw new ReportChangedError();
    }
    await mailer.send({
      to: lists.recipients,
      cc: lists.cc,
      bcc: lists.bcc,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { status: 'ok', note: '' };
  } catch (error) {
    if (issued !== null) {
      // Kompensasi: tautan yang tak jadi terpakai dihapus; bila ini gagal, penyapu membersihkannya kelak.
      try {
        await env.DB.batch([deleteShareStmt(env.DB, issued.id)]);
      } catch {
        // dibiarkan: tak boleh menutupi galat asli
      }
    }
    if (error instanceof ReportChangedError) return skipped(CHANGED_NOTE);
    return { status: 'error', note: noteOf(error, addresses, env.SESSION_SECRET) };
  }
}

/** Hasil pemeriksaan satu putaran (untuk tes dan log ringkas tanpa data pribadi). */
export interface ReportCheckSummary {
  sent: number;
  skipped: number;
  errors: number;
}

/** Mencatat hasil hanya bila berbeda dari yang tersimpan (pemeriksa 5 menit tak menulis ulang catatan yang sama). */
async function recordIfChanged(
  env: Env,
  row: ReportRow,
  outcome: ReportRunOutcome,
  nowMs: number,
): Promise<void> {
  if (
    outcome.status !== 'ok' &&
    row.last_status === outcome.status &&
    row.last_note === outcome.note
  ) {
    return;
  }
  await recordRunResult(
    env.DB,
    row.id,
    outcome.status,
    outcome.note,
    new Date(nowMs).toISOString(),
  );
}

/**
 * Pemeriksa jadwal: memproses laporan aktif yang jatuh tempo, berurutan. Hanya berjalan penuh bila `Env.MAILER` ada
 * (SMTP terkonfigurasi); tanpa itu tidak berbuat apa pun. Galat satu laporan tidak menghentikan yang lain.
 */
export async function checkDashboardReports(
  env: Env,
  nowMs: number = nowOf(env),
): Promise<ReportCheckSummary> {
  const summary: ReportCheckSummary = { sent: 0, skipped: 0, errors: 0 };
  if (env.MAILER === undefined) return summary;
  const now = wibNow(nowMs);
  for (const row of await listEnabledReportRows(env.DB)) {
    try {
      const parsed = parseRow(row);
      if (parsed === null) {
        summary.errors += 1;
        await recordIfChanged(
          env,
          row,
          { status: 'error', note: 'Konfigurasi laporan tidak terbaca' },
          nowMs,
        );
        continue;
      }
      if (!isDue(parsed.schedule, now, row.last_run_key)) continue;
      const pre = await ownerCheck(env, row, parsed.scope);
      if ('status' in pre) {
        summary.skipped += 1;
        await recordIfChanged(env, row, pre, nowMs);
        continue;
      }
      if (mailListsCount(parsed.lists) === 0) {
        summary.skipped += 1;
        await recordIfChanged(env, row, skipped('Tidak ada penerima yang sah'), nowMs);
        continue;
      }
      const key = periodKey(parsed.schedule, now);
      // Klaim SEBELUM menghitung dan mengirim: dua pemeriksaan serentak tak mengirim dobel.
      // Bersyarat `version` baris yang dimuat: perubahan pemilik sejak putaran memuat baris = klaim gagal, dan putaran
      // berikutnya memakai baris yang baru (penerima dan cakupan terkini).
      const version = Number(row.version);
      if (!(await claimRunKey(env.DB, row.id, row.last_run_key, key, version))) continue;
      const claim: RunClaim = { key, version };
      let outcome: ReportRunOutcome;
      try {
        outcome = await runReport(env, row, nowMs, 'scheduled', claim);
      } catch (error) {
        outcome = {
          status: 'error',
          note: noteOf(
            error,
            [...parsed.lists.recipients, ...parsed.lists.cc, ...parsed.lists.bcc],
            env.SESSION_SECRET,
          ),
        };
      }
      if (outcome.status === 'ok') {
        summary.sent += 1;
      } else {
        // Tidak terkirim = klaim dipulihkan: dicoba lagi pada pemeriksaan berikutnya di hari terjadwal yang sama.
        await releaseRunKey(env.DB, row.id, claim, row.last_run_key);
        if (outcome.status === 'skipped') summary.skipped += 1;
        else summary.errors += 1;
      }
      await recordIfChanged(env, row, outcome, nowMs);
    } catch (error) {
      summary.errors += 1;
      // Tanpa id penerima/isi: hanya jenis galat dan id laporan (ULID).
      console.error(
        `laporan dashboard ${row.id}: pemeriksaan gagal: ${error instanceof Error ? error.name : 'galat'}`,
      );
    }
  }
  return summary;
}
