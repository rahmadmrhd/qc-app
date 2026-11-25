/**
 * Mesin tampilan publik tautan dashboard (spek dashboard 7.4): cakupan beku di baris tautan, diiris dengan hak
 * pembagi SAAT INI dan dipersempit filter penonton. Penonton tidak pernah memperluas apa pun: BU/lokasi diiris dengan
 * himpunan beku, tanggal dijepit ke rentang beku, filter relasi hanya bila ditawarkan pembagi dan di dalam nilai
 * pilihannya. Irisan kosong = KOSONG (bukan semua). Keluaran melewati `toPublicDto` (daftar putih).
 */
import { type Env, nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import { FILTER_LIST_MAX } from '@server/core/validate';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import type {
  DashboardGroupId,
  DashboardOptionKind,
  DashboardRange,
  DashboardWidgetRequest,
  WidgetResult,
} from '@shared/dashboard';
import {
  DASHBOARD_GROUPS,
  GROUP_FILTERS,
  OPTIONS_IDS_MAX,
  validateDashboardRange,
  widgetMeta,
} from '@shared/dashboard';
import type {
  PublicDashboardDto,
  PublicFilterOption,
  PublicFilterOptions,
  PublicQueryInput,
} from '@shared/dashboard-public';
import { toPublicDto } from '@shared/dashboard-public';
import type { ShareRange, ShareScope, ShareWidgetScope } from '@shared/dashboard-share';
import { shareStatus } from '@shared/dashboard-share';
import { wibDateIso } from '@shared/postel';
import { publicActorName } from '@shared/serials';
import { mayOwnDashboardItems } from './access';
import { runWidgets } from './engine';
import { loadOptions } from './options';
import { allowedWidgetIds, type ResolvedScope, resolveScope } from './scope';
import { buScopeNames, locationScopeNames } from './scope-names';
import { parseScope, type ShareRow } from './share-repo';

const DAY_MS = 86_400_000;
const MAX_ID_LENGTH = 100;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const OPTION_KIND: Record<string, DashboardOptionKind> = {
  customer: 'customers',
  item: 'items',
  brand: 'brands',
  stickerType: 'stickerTypes',
  sticker: 'stickers',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw appError('VALIDATION', `${label} harus berupa daftar teks`);
  }
  if (value.length > FILTER_LIST_MAX) {
    throw appError('VALIDATION', `${label} maksimal ${FILTER_LIST_MAX} nilai`);
  }
  const ids = (value as string[]).map((item) => item.trim());
  if (ids.some((item) => item === '' || item.length > MAX_ID_LENGTH)) {
    throw appError('VALIDATION', `${label} berisi nilai tidak valid`);
  }
  return [...new Set(ids)];
}

function readDate(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !DATE_ONLY.test(value) ||
    validateDashboardRange({ from: value, to: value }) !== null
  ) {
    throw appError('VALIDATION', `${label} tidak sah`);
  }
  return value;
}

/**
 * Validasi badan filter penonton: maks. `FILTER_LIST_MAX` nilai per filter, tanggal `YYYY-MM-DD`, kunci yang tak dikenal
 * diabaikan. Nilai enum di luar `options` dan rentang terbalik = `VALIDATION`. Daftar BU/lokasi `[]` sah (= tidak ada);
 * daftar filter grup kosong dibuang (tanpa filter).
 */
export function validatePublicQuery(input: unknown): PublicQueryInput {
  if (input === null || input === undefined) return {};
  if (!isRecord(input)) throw appError('VALIDATION', 'Badan harus berupa objek');
  const result: PublicQueryInput = {};
  if (input.buIds !== undefined && input.buIds !== null) result.buIds = readIds(input.buIds, 'BU');
  if (input.locationIds !== undefined && input.locationIds !== null) {
    result.locationIds = readIds(input.locationIds, 'Lokasi');
  }
  if (input.from !== undefined && input.from !== null)
    result.from = readDate(input.from, 'Tanggal awal');
  if (input.to !== undefined && input.to !== null) result.to = readDate(input.to, 'Tanggal akhir');
  if (result.from !== undefined && result.to !== undefined && result.from > result.to) {
    throw appError('VALIDATION', 'Tanggal awal tidak boleh setelah tanggal akhir');
  }
  if (isRecord(input.groups)) {
    const groups: NonNullable<PublicQueryInput['groups']> = {};
    for (const group of DASHBOARD_GROUPS) {
      const raw = input.groups[group];
      if (!isRecord(raw)) continue;
      const filters: Record<string, string[]> = {};
      for (const field of GROUP_FILTERS[group]) {
        const value = raw[field.key];
        if (value === undefined || value === null) continue;
        const list = readIds(value, field.label);
        if (list.length === 0) continue;
        if (field.kind === 'enum') {
          const allowed = (field.options ?? []).map((option) => option.value);
          if (list.some((item) => !allowed.includes(item))) {
            throw appError('VALIDATION', `${field.label} berisi nilai tidak valid`);
          }
        }
        filters[field.key] = list;
      }
      if (Object.keys(filters).length > 0) groups[group] = filters;
    }
    if (Object.keys(groups).length > 0) result.groups = groups;
  }
  return result;
}

/** Rentang beku pada `today`: tetap apa adanya; bergulir = N hari terakhir yang berakhir hari ini (WIB). */
function frozenRange(range: ShareRange, today: string): DashboardRange {
  if (range.mode === 'fixed') return { from: range.from, to: range.to };
  const end = Date.parse(`${today}T00:00:00.000Z`);
  return {
    from: new Date(end - (range.days - 1) * DAY_MS).toISOString().slice(0, 10),
    to: today,
  };
}

/** Rentang penonton dijepit ke rentang beku; rentang terbalik (tak lewat validator) jatuh ke rentang beku. */
function clampRange(base: DashboardRange, viewer: PublicQueryInput): DashboardRange {
  const clamp = (value: string) =>
    value < base.from ? base.from : value > base.to ? base.to : value;
  const from = clamp(viewer.from ?? base.from);
  const to = clamp(viewer.to ?? base.to);
  return from > to ? base : { from, to };
}

/** Irisan himpunan beku dengan pilihan penonton; penonton tidak memilih = himpunan beku utuh. */
function narrow(frozen: readonly string[], viewer: readonly string[] | undefined): string[] {
  if (viewer === undefined) return [...frozen];
  const wanted = new Set(viewer);
  return frozen.filter((id) => wanted.has(id));
}

/**
 * Filter grup efektif satu widget. Enum: bebas bila pembagi tak membekukannya, selain itu diiris dengan nilai beku.
 * Relasi: hanya bila ditawarkan dan di dalam nilai pilihan pembagi. Irisan kosong atau filter yang tak diizinkan =
 * diabaikan (nilai beku dipertahankan), tanpa galat berbeda.
 */
function mergeFilters(
  widget: ShareWidgetScope,
  group: DashboardGroupId,
  viewerFilters: Record<string, string[]> | undefined,
  offers: readonly string[],
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...widget.filters };
  if (!viewerFilters) return merged;
  for (const field of GROUP_FILTERS[group]) {
    const wanted = viewerFilters[field.key];
    if (!wanted || wanted.length === 0) continue;
    const frozen = widget.filters[field.key];
    if (field.kind === 'relation') {
      if (!offers.includes(field.key) || !frozen || frozen.length === 0) continue;
      const inside = wanted.filter((value) => frozen.includes(value));
      if (inside.length > 0) merged[field.key] = inside;
    } else if (frozen && frozen.length > 0) {
      const inside = wanted.filter((value) => frozen.includes(value));
      if (inside.length > 0) merged[field.key] = inside;
    } else {
      merged[field.key] = wanted;
    }
  }
  return merged;
}

const marks = (values: readonly unknown[]) => values.map(() => '?').join(', ');

async function buOptions(env: Env, ids: readonly string[]): Promise<PublicFilterOption[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT b.id, b.name FROM business_units b WHERE ${liveWhere('b')} AND b.id IN (${marks(ids)}) ORDER BY b.name, b.id`,
  )
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return rows.results.map((row) => ({ value: row.id, label: row.name }));
}

async function locationOptions(env: Env, ids: readonly string[]): Promise<PublicFilterOption[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT l.id, l.name FROM locations l WHERE ${liveWhere('l')} AND l.id IN (${marks(ids)}) ORDER BY l.name, l.id`,
  )
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return rows.results.map((row) => ({ value: row.id, label: row.name }));
}

/** Pilihan relasi yang ditawarkan: nama dari nilai pilihan pembagi saja, lewat hak pembagi (`loadOptions` `ids`). */
async function offerOptions(
  env: Env,
  sharer: UserContext,
  key: string,
  ids: readonly string[],
): Promise<PublicFilterOption[]> {
  const kind = OPTION_KIND[key];
  if (!kind || ids.length === 0) return [];
  const found = new Map<string, PublicFilterOption>();
  for (let start = 0; start < ids.length; start += OPTIONS_IDS_MAX) {
    const chunk = ids.slice(start, start + OPTIONS_IDS_MAX);
    const page = await loadOptions(env, sharer, { kind, ids: chunk });
    for (const option of page[kind]) found.set(option.value, option);
  }
  return ids.flatMap((id) => {
    const option = found.get(id);
    return option ? [option] : [];
  });
}

function offeredValues(widgets: readonly ShareWidgetScope[], key: string): string[] {
  const values = new Set<string>();
  for (const widget of widgets) {
    if (!GROUP_FILTERS[widgetMeta(widget.id).group].some((field) => field.key === key)) continue;
    for (const value of widget.filters[key] ?? []) values.add(value);
  }
  return [...values];
}

/**
 * Tautan masih dapat dilayani: aktif (tak dicabut/kedaluwarsa), cakupannya terbaca, pembagi ada/aktif/tak terhapus dan
 * masih memegang `dashboard` minimal `edit`. `null` selain itu. Dipakai bersama oleh halaman data dan rute pencatat kunjungan
 * agar keduanya menolak persis pada keadaan yang sama (tanpa oracle baru).
 */
export async function servableShare(
  env: Env,
  share: ShareRow,
  nowMs: number,
): Promise<{ frozen: ShareScope; sharer: UserContext } | null> {
  if (shareStatus(share, new Date(nowMs).toISOString()) !== 'active') return null;
  const frozen: ShareScope | null = parseScope(share.scope);
  if (frozen === null) return null;
  const sharer = await loadUserContext(env, share.created_by);
  if (sharer === null || !mayOwnDashboardItems(sharer)) return null;
  return { frozen, sharer };
}

/**
 * Himpunan lokasi yang ditawarkan sebagai saringan Serial/Laporan. Dibatasi lokasi saat dibagikan = himpunan beku;
 * tidak dibatasi = lokasi hak pembagi saat ini (ditambah himpunan beku Serah Terima/stok bila ada). Kosong bila tak ada
 * widget Serial/Laporan, karena lokasi hanya relevan sebagai hak untuk Serah Terima dan stok (sudah di himpunan beku).
 */
function serialLocationPool(
  sharer: UserContext,
  frozen: ShareScope,
  widgets: readonly ShareWidgetScope[],
): string[] {
  const usesSerial = widgets.some((widget) => {
    const group = widgetMeta(widget.id).group;
    return group === 'serial' || group === 'report';
  });
  if (!usesSerial) return [];
  if (frozen.locationFiltered) return [...frozen.locationIds];
  return [...new Set([...frozen.locationIds, ...Object.keys(sharer.locations)])];
}

export interface ComputedShareWidgets {
  /** Widget cakupan beku yang masih boleh dilihat pembagi (hak SAAT INI) dan, bila ada `actor`, juga oleh pelaku. */
  widgets: ShareWidgetScope[];
  /**
   * Hanya bila ada `actor`: sebagian isi disembunyikan karena hak PELAKU lebih sempit dari hak pembagi (widget dibuang
   * atau BU/lokasi diiris untuk grup yang tampil). Pengurangan karena hak pembagi sendiri tidak dihitung.
   */
  trimmed: boolean;
  /** Rentang beku pada hari ini, SEBELUM dipersempit penonton. */
  base: DashboardRange;
  /** Cakupan efektif yang dipakai menghitung (rentang sesudah penyempitan penonton). */
  scope: ResolvedScope;
  /** Hasil tiap widget, urut menurut `widgets`. */
  results: WidgetResult[];
}

/**
 * Inti perhitungan yang dipakai bersama halaman publik dan laporan terjadwal: cakupan beku diiris dengan hak
 * `sharer` SAAT INI dan dipersempit filter `viewer` (laporan terjadwal memakai `{}`: tanpa penyempitan), lalu widget
 * yang diizinkan dijalankan oleh mesin widget yang sama (semafor dan cache yang sama). Tidak memeriksa apakah tautan
 * masih dapat dilayani (`servableShare`).
 */
export async function computeShareWidgets(
  env: Env,
  sharer: UserContext,
  frozen: ShareScope,
  viewer: PublicQueryInput,
  nowMs: number,
  actor?: UserContext,
): Promise<ComputedShareWidgets> {
  const allowed = new Set(allowedWidgetIds(sharer));
  const sharerWidgets = frozen.widgets.filter((widget) => allowed.has(widget.id));
  // Pelaku selain pembagi (pratinjau/kirim uji laporan milik orang lain oleh pengelola semua): isi = irisan hak pembagi
  // DAN hak pelaku, sehingga pelaku tak pernah melihat data di luar haknya sendiri.
  const actorAllowed = actor === undefined ? null : new Set(allowedWidgetIds(actor));
  const widgets =
    actorAllowed === null
      ? sharerWidgets
      : sharerWidgets.filter((widget) => actorAllowed.has(widget.id));

  const base = frozenRange(frozen.range, wibDateIso(nowMs));
  const range = clampRange(base, viewer);
  const buIds = narrow(frozen.buIds, viewer.buIds);
  // Lokasi yang boleh dipilih penonton untuk saringan Serial/Laporan: bila tautan tidak dibatasi lokasi, mengikuti hak
  // lokasi pembagi SAAT INI (lokasi bukan batas hak Serial, hanya saringan); bila dibatasi, hanya himpunan beku.
  const serialPool = serialLocationPool(sharer, frozen, widgets);
  // Pilihan lokasi penonton hanya berlaku bila ada lokasi yang ditawarkan; selain itu diabaikan, bukan diiris ke kosong.
  const viewerLocations = serialPool.length === 0 ? undefined : viewer.locationIds;
  const locationIds = narrow(
    frozen.locationIds,
    frozen.locationIds.length === 0 ? undefined : viewer.locationIds,
  );

  // Hak pembagi saat ini ∩ cakupan beku ∩ filter penonton; `[]` ke `resolveScope` berarti tidak ada (bukan semua).
  // Himpunan beku boleh lebih dari `FILTER_LIST_MAX` (hasil hak pembagi); daftar penonton sudah dibatasi validator.
  const resolved = resolveScope(
    sharer,
    { from: range.from, to: range.to, buIds, locationIds },
    nowMs,
    { trustedLists: true },
  );
  // Irisan per bidang dengan hak pelaku (BU, lokasi Serah Terima, lokasi stok); lokasi Serial/Laporan hanya saringan,
  // bukan hak, jadi tak disentuh. Himpunan lokasi beku bercampur menurut modul, maka diiris per bidang, bukan digabung.
  let trimmed = false;
  let effective: ResolvedScope = {
    ...resolved,
    // Lokasi menjadi filter Serial/Laporan hanya bila dibekukan demikian atau penonton sendiri mempersempitnya.
    serialLocationIds: frozen.locationFiltered
      ? locationIds
      : viewerLocations !== undefined
        ? narrow(serialPool, viewerLocations)
        : null,
  };
  if (actor !== undefined && actorAllowed !== null) {
    const actorScope = resolveScope(actor, { from: range.from, to: range.to }, nowMs);
    const keep = (own: readonly string[], allowedByActor: readonly string[]): string[] => {
      const permitted = new Set(allowedByActor);
      return own.filter((id) => permitted.has(id));
    };
    const groups = new Set(widgets.map((widget) => widgetMeta(widget.id).group));
    const buIds = keep(effective.buIds, actorScope.buIds);
    const handoverLocationIds = keep(effective.handoverLocationIds, actorScope.handoverLocationIds);
    const stockLocationIds = keep(effective.stockLocationIds, actorScope.stockLocationIds);
    trimmed =
      widgets.length < sharerWidgets.length ||
      ((groups.has('serial') || groups.has('report')) && buIds.length < effective.buIds.length) ||
      (groups.has('handover') &&
        handoverLocationIds.length < effective.handoverLocationIds.length) ||
      (groups.has('sticker') && stockLocationIds.length < effective.stockLocationIds.length);
    effective = { ...effective, buIds, handoverLocationIds, stockLocationIds };
  }
  const scope: ResolvedScope = effective;
  const requests: DashboardWidgetRequest[] = widgets.map((widget) => {
    const group = widgetMeta(widget.id).group;
    const filters = mergeFilters(widget, group, viewer.groups?.[group], frozen.offers);
    return Object.keys(filters).length > 0 ? { id: widget.id, filters } : { id: widget.id };
  });
  const results: WidgetResult[] = await runWidgets(env, scope, requests);
  return { widgets, trimmed, base, scope, results };
}

/**
 * Memuat dashboard publik untuk satu tautan. `null` bila tautan tak aktif (dicabut/kedaluwarsa), cakupannya tak
 * terbaca, pembagi tak ditemukan/nonaktif/terhapus, atau pembagi tak lagi memegang `dashboard` minimal `edit`. Hak pembagi
 * dihitung ulang tiap permintaan (`resolveScope`, `allowedWidgetIds`): menurun haknya = menyempit tanpa galat berbeda.
 */
export async function loadPublicDashboard(
  env: Env,
  share: ShareRow,
  viewer: PublicQueryInput,
  nowMs: number,
): Promise<PublicDashboardDto | null> {
  const servable = await servableShare(env, share, nowMs);
  if (servable === null) return null;
  const { frozen, sharer } = servable;
  const { widgets, base, scope, results } = await computeShareWidgets(
    env,
    sharer,
    frozen,
    viewer,
    nowMs,
  );

  // Nama dan pilihan filter dari cakupan beku (sebelum penyempitan penonton), tetap diiris dengan hak pembagi.
  const baseScope = resolveScope(
    sharer,
    { from: base.from, to: base.to, buIds: frozen.buIds, locationIds: frozen.locationIds },
    nowMs,
    { trustedLists: true },
  );
  // Lokasi yang tampil = yang masih boleh dibaca pembagi (Serah Terima, stok), ditambah lokasi pilihan beku bila ada
  // widget Serial/Laporan yang memakainya sebagai saringan (di sana lokasi bukan hak). Lokasi yang haknya sudah hilang
  // tidak tampil di kepala maupun pilihan filter.
  const usesLocationFilter =
    frozen.locationFiltered &&
    widgets.some((widget) => {
      const group = widgetMeta(widget.id).group;
      return group === 'serial' || group === 'report';
    });
  const nameableLocations = new Set([
    ...baseScope.handoverLocationIds,
    ...baseScope.stockLocationIds,
  ]);
  if (usesLocationFilter) for (const id of frozen.locationIds) nameableLocations.add(id);
  const nameableLocationIds = frozen.locationIds.filter((id) => nameableLocations.has(id));
  // Tautan Serial/Laporan tanpa pembatasan lokasi: pilihan filter lokasi = lokasi hak pembagi (bukan nama di kepala).
  const poolLocationIds = serialLocationPool(sharer, frozen, widgets).filter(
    (id) => !nameableLocationIds.includes(id),
  );
  const offeredLocationIds = frozen.locationFiltered
    ? nameableLocationIds
    : [...nameableLocationIds, ...poolLocationIds];
  const [bu, location, buNames, locationNames] = await Promise.all([
    buOptions(env, baseScope.buIds),
    locationOptions(env, offeredLocationIds),
    buScopeNames(env, baseScope.buIds, true),
    locationScopeNames(env, nameableLocationIds, true),
  ]);
  const groups: PublicFilterOptions['groups'] = {};
  for (const key of frozen.offers) {
    const values = offeredValues(widgets, key);
    if (values.length > 0) groups[key] = await offerOptions(env, sharer, key, values);
  }

  return {
    title: share.title,
    sharedBy: publicActorName(share.created_by),
    generatedAt: nowIso(env),
    expiresAt: share.expires_at,
    range: scope.range,
    bounds: base,
    bucket: scope.bucket,
    // Kepala memuat nama termasuk BU/lokasi yang sudah dihapus (ditandai); pilihan filter (`options`) tidak.
    scope: {
      buNames: buNames.names,
      buDeleted: buNames.deleted,
      locationNames: locationNames.names,
      locationDeleted: locationNames.deleted,
    },
    options: { bu, location, groups },
    widgets: results.map((result) => ({
      id: result.id,
      group: widgetMeta(result.id).group,
      result:
        result.status === 'ok'
          ? { status: 'ok', data: toPublicDto(result.id, result.data) }
          : { status: 'error', message: result.message },
    })),
  };
}
