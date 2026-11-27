import type { ApiVerb } from './api';
import { compareVersions } from './desktop-release';

// Versi API per kelompok rute (spek 2026-11-20-versi-api-ui-dasar-paksa-update-design.md). Murni: tanpa API runtime
// (`shared/` tak boleh memakai `URL`, `fetch`, dsb.), dipakai server (pemasangan jalur, ping) dan klien (pemilih id).
//
// Id berversi = `<idDasar>@<n>` dengan n >= 2 (tanpa nol di depan); id dasar (v1) WAJIB selalu ada. Versi diturunkan dari
// akhiran id, jadi tidak ada field `version` di `ApiRouteDef`. Kelompok = awalan id dasar sebelum titik pertama.

/** Awalan jalur REST untuk satu versi, mis. `/api/v2`. */
export function restBase(version: number): string {
  return `/api/v${version}`;
}

const VERSION_SUFFIX = /^(.+)@([2-9]|[1-9]\d+)$/;

/** Memisah id jadi id dasar dan versi; akhiran yang tak sah dianggap bagian id biasa (versi 1). */
export function parseApiId(id: string): { base: string; version: number } {
  const match = VERSION_SUFFIX.exec(id);
  if (match === null) return { base: id, version: 1 };
  return { base: match[1] as string, version: Number(match[2]) };
}

/** Kelompok sebuah id: awalan id dasar sebelum titik pertama (`access.users.list` -> `access`). */
export function apiGroup(id: string): string {
  const { base } = parseApiId(id);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

export interface GroupVersions {
  /** Versi tertinggi yang boleh dipakai klien untuk kelompok ini. */
  latest: number;
  /** Versi yang sudah ditandai deprecated (dihapus di rilis berikutnya). */
  deprecated: readonly number[];
}

/** Versi tiap kelompok yang diumumkan server. Tes menjaga seluruh kelompok `API_ROUTES` terdaftar di sini. */
export const API_GROUP_VERSIONS: Record<string, GroupVersions> = {
  access: { latest: 1, deprecated: [] },
  activity: { latest: 1, deprecated: [] },
  auth: { latest: 1, deprecated: [] },
  brands: { latest: 1, deprecated: [] },
  businessUnits: { latest: 1, deprecated: [] },
  clFiles: { latest: 1, deprecated: [] },
  clUploads: { latest: 1, deprecated: [] },
  clFirmwares: { latest: 1, deprecated: [] },
  customers: { latest: 1, deprecated: [] },
  dashboard: { latest: 1, deprecated: [] },
  dashboardReports: { latest: 1, deprecated: [] },
  dashboardShares: { latest: 1, deprecated: [] },
  desktop: { latest: 1, deprecated: [] },
  exports: { latest: 1, deprecated: [] },
  files: { latest: 1, deprecated: [] },
  guides: { latest: 1, deprecated: [] },
  handovers: { latest: 1, deprecated: [] },
  items: { latest: 1, deprecated: [] },
  jobs: { latest: 1, deprecated: [] },
  notifications: { latest: 1, deprecated: [] },
  postelFiles: { latest: 1, deprecated: [] },
  postelSettings: { latest: 1, deprecated: [] },
  postels: { latest: 1, deprecated: [] },
  push: { latest: 1, deprecated: [] },
  qrcodes: { latest: 1, deprecated: [] },
  serialCases: { latest: 1, deprecated: [] },
  serialProofs: { latest: 1, deprecated: [] },
  serialServiceSettings: { latest: 1, deprecated: [] },
  serialSettings: { latest: 1, deprecated: [] },
  serialWarehouse: { latest: 1, deprecated: [] },
  serials: { latest: 1, deprecated: [] },
  stickerGuides: { latest: 1, deprecated: [] },
  stickerSettings: { latest: 1, deprecated: [] },
  stickerStock: { latest: 1, deprecated: [] },
  stickerTypes: { latest: 1, deprecated: [] },
  stickers: { latest: 1, deprecated: [] },
};

/**
 * Versi klien paling rendah yang masih didukung server (keputusan pemilik 2026-11-20). Nilai awal `0.0.0` = tidak memaksa
 * siapa pun; dinaikkan hanya bersamaan dengan penghapusan versi API yang masih dipakai installer lama, lewat PR yang dapat
 * ditinjau (jangan dari variabel lingkungan). Dipakai daftar unduhan desktop (versi di bawahnya tidak ditampilkan) dan,
 * di fase 3, `/api/ping` serta layar penahan desktop.
 */
export const MIN_CLIENT: { readonly desktop: string } = { desktop: '0.0.0' };

/** Rute yang sudah dihapus dari `API_ROUTES` (dicatat agar potret kontrak tak menganggapnya hilang tanpa sengaja). */
export interface RetiredRoute {
  id: string;
  verb: ApiVerb;
  path: string;
  /** Rilis server yang menghapusnya, mis. `server-v1.4.0`. */
  removedIn: string;
}

export const RETIRED_ROUTES: readonly RetiredRoute[] = [];

/** Bentuk peta yang diumumkan `/api/ping` dan dibaca klien. */
export type ServerApis = Record<string, { latest: number; deprecated: number[] }>;

/** Salinan `API_GROUP_VERSIONS` untuk `/api/ping` (mengubahnya tak menyentuh tabel sumber). */
export function announcedApis(): ServerApis {
  return Object.fromEntries(
    Object.entries(API_GROUP_VERSIONS).map(([group, info]) => [
      group,
      { latest: info.latest, deprecated: [...info.deprecated] },
    ]),
  );
}

function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Membaca peta `apis` dari respons server yang tak tepercaya. Entri rusak dibuang satu-satu (klien tak boleh melempar
 * hanya karena satu kelompok aneh); tak ada entri sah = `null` (pemanggil jatuh ke v1).
 */
export function parseServerApis(value: unknown): ServerApis | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries: [string, { latest: number; deprecated: number[] }][] = [];
  for (const [group, raw] of Object.entries(value)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const { latest, deprecated } = raw as { latest?: unknown; deprecated?: unknown };
    if (!isVersionNumber(latest)) continue;
    const list =
      Array.isArray(deprecated) && deprecated.every(isVersionNumber) ? [...deprecated] : [];
    entries.push([group, { latest, deprecated: list }]);
  }
  // `fromEntries` membuat properti data biasa, jadi kunci seperti `__proto__` dari server tak mengubah prototipe.
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

/**
 * Memilih id yang dipakai klien untuk id dasar `base`: versi tertinggi yang ada di `ids` dan tidak melebihi `latest`
 * kelompoknya di peta server. Versi deprecated dihindari bila ada alternatif; bila semua deprecated, tertinggi yang
 * diizinkan tetap dipakai (tidak melempar). Peta kosong/kelompok tak dikenal = v1.
 */
export function pickApiId(base: string, ids: readonly string[], apis: ServerApis | null): string {
  const versions = ids
    .map(parseApiId)
    .filter((parsed) => parsed.base === base)
    .map((parsed) => parsed.version);
  if (versions.length === 0) throw new Error(`Id API tidak dikenal: ${base}`);
  const info =
    apis !== null && Object.hasOwn(apis, apiGroup(base)) ? apis[apiGroup(base)] : undefined;
  const latest = info?.latest ?? 1;
  const deprecated = info?.deprecated ?? [];
  const allowed = versions.filter((v) => v <= latest);
  const preferred = allowed.filter((v) => !deprecated.includes(v));
  const chosen = Math.max(...(preferred.length > 0 ? preferred : allowed), 1);
  return chosen === 1 ? base : `${base}@${chosen}`;
}

/** Versi unik (naik) yang dipakai id-id ini; v1 selalu ada. */
export function apiVersionsInUse(ids: readonly string[]): number[] {
  return [...new Set([1, ...ids.map((id) => parseApiId(id).version)])].sort((a, b) => a - b);
}

/**
 * Mencari rute terhapus yang cocok dengan permintaan. `path` relatif terhadap awalan versi (`/brands/abc`, tanpa query).
 * Cocok bila verba dan versi sama dan templat `route.path` cocok segmen per segmen (`{nama}` = satu segmen tak kosong,
 * selain itu sama persis). Jalur berakhiran `/` atau berisi `//` tidak pernah cocok. Dipakai server untuk menjawab 426.
 */
export function matchRetiredRoute(
  retired: readonly RetiredRoute[],
  verb: string,
  version: number,
  path: string,
): RetiredRoute | null {
  if (path.endsWith('/') || path.includes('//')) return null;
  const actual = path.split('/');
  for (const route of retired) {
    if (route.verb !== verb || parseApiId(route.id).version !== version) continue;
    const template = route.path.split('/');
    if (template.length !== actual.length) continue;
    const same = template.every((part, index) => {
      const segment = actual[index] as string;
      return part.startsWith('{') && part.endsWith('}') ? segment !== '' : part === segment;
    });
    if (same) return route;
  }
  return null;
}

/**
 * Kelompok yang versi pilihan klien ini (`pickApiId`) sudah ditandai deprecated oleh server: klien hanya mengenal
 * versi yang akan dihapus, jadi perlu diperbarui. Urut abjad, tanpa ganda; `apis` `null` = tidak ada.
 */
export function deprecatedGroupsInUse(ids: readonly string[], apis: ServerApis | null): string[] {
  if (apis === null) return [];
  const groups = new Set<string>();
  for (const base of new Set(ids.map((id) => parseApiId(id).base))) {
    const group = apiGroup(base);
    if (!Object.hasOwn(apis, group)) continue;
    const chosen = parseApiId(pickApiId(base, ids, apis)).version;
    if ((apis[group] as { deprecated: number[] }).deprecated.includes(chosen)) groups.add(group);
  }
  return [...groups].sort();
}

/** Versi klien paling rendah yang diumumkan server di `/api/ping` (bentuk `MIN_CLIENT`). */
export interface MinClient {
  desktop: string;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Membaca `minClient` dari respons ping yang tak tepercaya; apa pun yang rusak = `null` (tidak menahan siapa pun). */
export function parseMinClient(value: unknown): MinClient | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { desktop } = value as { desktop?: unknown };
  return typeof desktop === 'string' && SEMVER.test(desktop) ? { desktop } : null;
}

/** `true` hanya bila versi terpasang sah dan lebih rendah dari minimum; data tak lengkap tidak pernah menahan. */
export function isBelowMinClient(installed: string, min: MinClient | null): boolean {
  if (min === null || !SEMVER.test(installed)) return false;
  return compareVersions(installed, min.desktop) < 0;
}
