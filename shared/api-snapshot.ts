import { API_ROUTES, type ApiRouteDef, type ApiVerb, type QueryKind } from './api';
import {
  API_GROUP_VERSIONS,
  apiGroup,
  type GroupVersions,
  parseApiId,
  type RetiredRoute,
} from './api-versions';

// Potret kontrak REST (`shared/api-contract.snapshot.json`): daftar id, verb, path, query, create, status, ETag/If-Match, dan
// bentuk biner (rawBody, multipart, download) tiap rute pada rilis terakhir. Tes superset memastikan kontrak sekarang tidak menghilangkan atau mengubah apa pun dari potret itu
// (kompatibilitas mundur): rute hanya boleh ditambah, dan menghapus rute wajib lewat `RETIRED_ROUTES` SETELAH rute itu
// berstatus deprecated di potret rilis sebelumnya (keputusan 5: deprecated lebih dulu, dihapus di rilis berikutnya). Murni.

export interface SnapshotEntry {
  id: string;
  verb: ApiVerb;
  path: string;
  query?: Record<string, QueryKind>;
  create?: { verb: ApiVerb; path: string };
  /**
   * Status sukses efektif (bawaan 200). Selalu ada pada potret berformat baru; ENTRI TANPA field ini = potret lama (sebelum
   * 2026-11-23) dan tak dibandingkan pada field-field di bawah (tak ada dasar pembandingnya).
   */
  status?: number;
  /** Field keluaran yang menjadi header `ETag`. */
  etag?: string;
  /** Field input yang dibawa header `If-Match`. */
  ifMatch?: string;
  /** Badan permintaan mentah (unggah); tanpa batas ukuran (batas boleh berubah). */
  rawBody?: { field: string; mimeField?: string; contentType?: string };
  /** Bagian multipart/form-data. */
  multipart?: { parts: string[] };
  /** Unduhan biner. */
  download?: { bytesField: string; mimeField: string; filenameField?: string };
  /** Hanya ada (true) bila versi id ini tercantum di `deprecated` kelompoknya (`API_GROUP_VERSIONS`). */
  deprecated?: true;
}

/** Potret tabel rute, urut menurut id (bawaan `API_ROUTES`). `query`/`create` hanya ada bila rutenya punya. */
export function contractSnapshot(
  table: Record<string, ApiRouteDef> = API_ROUTES,
  groups: Record<string, GroupVersions> = API_GROUP_VERSIONS,
): SnapshotEntry[] {
  return Object.keys(table)
    .sort()
    .map((id) => {
      const def = table[id] as ApiRouteDef;
      const entry: SnapshotEntry = { id, verb: def.verb, path: def.path };
      if (def.query !== undefined) {
        entry.query = Object.fromEntries(
          Object.entries(def.query).sort(([a], [b]) => (a < b ? -1 : 1)),
        );
      }
      if (def.create !== undefined) entry.create = { verb: def.create.verb, path: def.create.path };
      entry.status = def.status ?? 200;
      if (def.etag !== undefined) entry.etag = def.etag;
      if (def.ifMatch !== undefined) entry.ifMatch = def.ifMatch;
      if (def.rawBody !== undefined) {
        entry.rawBody = { field: def.rawBody.field };
        if (def.rawBody.mimeField !== undefined) entry.rawBody.mimeField = def.rawBody.mimeField;
        if (def.rawBody.contentType !== undefined) {
          entry.rawBody.contentType = def.rawBody.contentType;
        }
      }
      if (def.multipart !== undefined) entry.multipart = { parts: [...def.multipart.parts] };
      if (def.download !== undefined) {
        entry.download = { bytesField: def.download.bytesField, mimeField: def.download.mimeField };
        if (def.download.filenameField !== undefined) {
          entry.download.filenameField = def.download.filenameField;
        }
      }
      const group = apiGroup(id);
      if (
        Object.hasOwn(groups, group) &&
        groups[group]?.deprecated.includes(parseApiId(id).version)
      ) {
        entry.deprecated = true;
      }
      return entry;
    });
}

/** Bandingkan nilai terstruktur secara persis (urutan kunci diabaikan). */
function sameShape(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Pelanggaran bentuk kabel yang membuat klien lama gagal membaca/mengirim: status sukses berbeda, `If-Match` berubah atau
 * baru diwajibkan, `ETag` berubah atau hilang (penambahan boleh), badan mentah/multipart/unduhan berubah, hilang, atau baru
 * muncul (multipart: bagian ditambah juga ditolak karena klien lama tak mengirimnya). Hanya dipanggil untuk entri potret
 * berformat baru.
 */
function wireProblems(old: SnapshotEntry, next: SnapshotEntry): string[] {
  const problems: string[] = [];
  if ((old.status ?? 200) !== (next.status ?? 200)) {
    problems.push(
      `Rute ${old.id}: status sukses berubah dari ${old.status} menjadi ${next.status}`,
    );
  }
  if (old.etag !== undefined && next.etag !== old.etag) {
    problems.push(`Rute ${old.id}: field ETag berubah atau hilang`);
  }
  if (old.ifMatch !== next.ifMatch) {
    problems.push(`Rute ${old.id}: field If-Match berubah`);
  }
  for (const key of ['rawBody', 'multipart', 'download'] as const) {
    if (!sameShape(old[key], next[key])) {
      problems.push(`Rute ${old.id}: bentuk ${key} berubah (field, bagian, atau jenis badan)`);
    }
  }
  return problems;
}

/**
 * Membandingkan potret lama dengan kontrak sekarang. Mengembalikan daftar pelanggaran (kosong = lolos): id yang hilang
 * tanpa tercatat di `retired` (atau tercatat tetapi belum `deprecated` di potret lama), verb/path yang berubah, kunci query yang hilang atau berubah jenis, dan `create` yang
 * hilang atau berubah. Penambahan (id baru, query baru) selalu boleh.
 */
export function compareContract(
  previous: readonly SnapshotEntry[],
  current: readonly SnapshotEntry[],
  retired: readonly RetiredRoute[],
): string[] {
  const now = new Map(current.map((entry) => [entry.id, entry]));
  const retiredIds = new Set(retired.map((route) => route.id));
  const problems: string[] = [];
  for (const old of previous) {
    const next = now.get(old.id);
    if (next === undefined) {
      if (!retiredIds.has(old.id)) {
        problems.push(`Rute ${old.id} hilang dari kontrak tanpa dicatat di RETIRED_ROUTES`);
      } else if (old.deprecated !== true) {
        problems.push(
          `Rute ${old.id} dihapus padahal belum berstatus deprecated di potret rilis sebelumnya (tandai deprecated lebih dulu, hapus di rilis berikutnya)`,
        );
      }
      continue;
    }
    if (next.verb !== old.verb) {
      problems.push(`Rute ${old.id}: verb berubah dari ${old.verb} menjadi ${next.verb}`);
    }
    if (next.path !== old.path) {
      problems.push(`Rute ${old.id}: path berubah dari ${old.path} menjadi ${next.path}`);
    }
    for (const [name, kind] of Object.entries(old.query ?? {})) {
      const nextKind = next.query?.[name];
      if (nextKind === undefined) {
        problems.push(`Rute ${old.id}: parameter query "${name}" hilang`);
      } else if (nextKind !== kind) {
        problems.push(
          `Rute ${old.id}: jenis query "${name}" berubah dari ${kind} menjadi ${nextKind}`,
        );
      }
    }
    if (old.create !== undefined) {
      if (next.create === undefined) {
        problems.push(`Rute ${old.id}: jalur create hilang`);
      } else if (next.create.verb !== old.create.verb || next.create.path !== old.create.path) {
        problems.push(`Rute ${old.id}: jalur create berubah`);
      }
    }
    // Entri potret lama (tanpa `status`) tak punya dasar untuk field di bawah.
    if (old.status !== undefined) problems.push(...wireProblems(old, next));
  }
  return problems;
}

/** Umur minimum rilis yang menandai deprecated sebelum rutenya boleh dihapus (spek fase 3, bagian 5b). */
export const REMOVAL_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface RemovalCheckInput {
  previous: readonly SnapshotEntry[];
  current: readonly SnapshotEntry[];
  retired: readonly RetiredRoute[];
  /** Umur tag rilis server sebelumnya (ms); `null` = belum ada rilis sebelumnya. */
  previousTagAgeMs: number | null;
  minAgeMs: number;
}

/**
 * Pagar rilis: pelanggaran `compareContract` DITAMBAH satu pelanggaran bila ada rute yang dihapus padahal rilis yang
 * menandainya deprecated baru terbit kurang dari `minAgeMs`. Rilis pertama (`previousTagAgeMs` `null`) lolos.
 */
export function removalProblems(input: RemovalCheckInput): string[] {
  const problems = compareContract(input.previous, input.current, input.retired);
  const now = new Set(input.current.map((entry) => entry.id));
  const removed = input.previous.filter((entry) => !now.has(entry.id));
  const age = input.previousTagAgeMs;
  if (removed.length > 0 && age !== null && age < input.minAgeMs) {
    const hours = Math.floor(age / (60 * 60 * 1000));
    const limit = Math.round(input.minAgeMs / (60 * 60 * 1000));
    for (const entry of removed) {
      problems.push(
        `Rute ${entry.id} baru berstatus deprecated kurang dari ${limit} jam (rilis sebelumnya baru terbit ${hours} jam lalu)`,
      );
    }
  }
  return problems;
}
