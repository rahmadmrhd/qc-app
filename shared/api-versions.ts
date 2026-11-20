import type { ApiVerb } from './api';

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
  auth: { latest: 1, deprecated: [] },
  brands: { latest: 1, deprecated: [] },
  businessUnits: { latest: 1, deprecated: [] },
  customers: { latest: 1, deprecated: [] },
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
  serials: { latest: 1, deprecated: [] },
  stickerGuides: { latest: 1, deprecated: [] },
  stickerSettings: { latest: 1, deprecated: [] },
  stickerStock: { latest: 1, deprecated: [] },
  stickerTypes: { latest: 1, deprecated: [] },
  stickers: { latest: 1, deprecated: [] },
};

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
