import { API_ROUTES, type ApiRouteDef, type ApiVerb, type QueryKind } from './api';
import {
  API_GROUP_VERSIONS,
  apiGroup,
  type GroupVersions,
  parseApiId,
  type RetiredRoute,
} from './api-versions';

// Potret kontrak REST (`shared/api-contract.snapshot.json`): daftar id, verb, path, query, dan create tiap rute pada
// rilis terakhir. Tes superset memastikan kontrak sekarang tidak menghilangkan atau mengubah apa pun dari potret itu
// (kompatibilitas mundur): rute hanya boleh ditambah, dan menghapus rute wajib lewat `RETIRED_ROUTES` SETELAH rute itu
// berstatus deprecated di potret rilis sebelumnya (keputusan 5: deprecated lebih dulu, dihapus di rilis berikutnya). Murni.

export interface SnapshotEntry {
  id: string;
  verb: ApiVerb;
  path: string;
  query?: Record<string, QueryKind>;
  create?: { verb: ApiVerb; path: string };
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
