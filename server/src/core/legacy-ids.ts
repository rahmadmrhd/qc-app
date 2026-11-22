// Lapisan terjemahan ID lama SEMENTARA (keputusan pemilik produk 2026-11-23; spek
// `docs/superpowers/specs/2026-11-22-id-ulid-design.md` bagian 1 butir 10 dan bagian 4a).
//
// Skrip operator lokal menulis ulang ID baris lama (UUID) menjadi ULID dan menyimpan pasangannya di tabel `id_ulid_map`
// (`old_id`, `new_id`, `source_table`; dibuat dan diisi skrip itu, BUKAN migrasi). Klien yang masih membawa ID lama (antrean
// offline, draf Serial Number web/desktop, `pending.db`, berkas `.qcsn`, bookmark, tab yang terbuka) akan mengirimnya ke
// server; lapisan ini menggantinya dengan ID baru SEBELUM validasi dan izin berlokasi, jadi state klien tetap berfungsi.
//
// Aturan (rinci di spek bagian 4a):
//   - Hanya nilai STRING yang PERSIS berpola UUID, ada di `id_ulid_map.old_id`, DAN berada di bawah kunci pembawa ID
//     (`id`, `ids`, `attachments`, `*Id`, `*Ids`; elemen larik mengikuti kunci larik itu) yang diganti. Teks bebas (nomor serial, komentar,
//     nama, Markdown) tidak disentuh walau kebetulan berbentuk UUID: kalau tidak, nilai itu akan berubah dan lapisan menjadi
//     oracle pemetaan UUID lama ke ULID (review 2026-11-23). Kunci `clientId` dilewati (kunci idempoten klien, bukan ID baris).
//     Gagal-aman: ID lama di kunci bernama lain tak diterjemahkan (sama seperti tanpa lapisan), bukan membocorkan data.
//   - Tabel peta tak ada = tanpa pekerjaan (keadaan sebelum migrasi). Status dicek ulang paling sering tiap 30 detik.
//   - Hanya aktif bila data berada di keadaan SESUDAH migrasi: setelah `--revert` data kembali ke UUID tetapi peta masih
//     ada, dan menerjemahkan UUID ke ULID yang sudah tak ada akan merusak semuanya. Arah diuji dari sampel baris peta pada
//     tabel yang barisnya tak dihapus permanen: ID baru harus ditemukan dan ID lama tidak.
//   - Galat basis data selain "tabel tak ada" TIDAK ditelan (`UNAVAILABLE` seperti rute lain).
//   - Batas kerja per permintaan: 2.000 kandidat unik, dicari per 500; kedalaman struktur 20. Kelebihannya dibiarkan.
//
// Lapisan dicabut lewat PR setelah masa pantau satu minggu dan sapu akhir skrip (spek bagian 4a, "Pencabutan"). JANGAN
// memperluasnya menjadi pembuat tabel peta atau penulis ulang data.

import { LEGACY_UUID_PATTERN } from '@shared/ids';
import { type Db, DbError } from './db';
import { type Env, nowOf } from './env';

const MAP_TABLE = 'id_ulid_map';
/** MariaDB `ER_NO_SUCH_TABLE`. */
const ER_NO_SUCH_TABLE = 1146;
const STATE_TTL_MS = 30_000;
export const MAX_LEGACY_CANDIDATES = 2000;
const LOOKUP_CHUNK = 500;
const MAX_DEPTH = 20;
/** Kunci yang nilainya BUKAN ID baris (UUID kunci idempoten klien). */
const SKIP_KEYS: ReadonlySet<string> = new Set(['clientId']);
/**
 * Kunci pembawa ID baris di kontrak API: `id`, `ids`, `jobId`, `itemId`, `locationIds`, `businessUnitIds`, `proofPhotoIds`, ...
 * (hampir semua properti ber-ID di `shared/contract.ts` berakhiran `Id`/`Ids` atau bernama `id`/`ids`). Satu-satunya
 * pengecualian bernama lain: `attachments` (`SaveItemInput.attachments`: ID berkas galeri item; ditemukan review 2026-11-23).
 * Tes `legacy-ids.test.ts` membaca `shared/contract.ts` dan GAGAL bila ada properti string baru yang belum diklasifikasikan
 * (ID baris atau bukan), supaya celah sejenis tak lolos diam-diam. Diekspor hanya untuk tes itu.
 */
export const ID_KEY = /^(?:id|ids|attachments)$|Ids?$/;
/** Batas cache hasil terjemahan per proses; peta tak berubah selama aktif, jadi cukup dikosongkan bila penuh. */
const HIT_CACHE_MAX = 50_000;

/**
 * Tabel yang barisnya tak pernah dihapus permanen oleh aplikasi (hanya soft delete), dipakai menguji arah migrasi. Tiap
 * kueri sengaja literal dan membaca baris terhapus juga (lihat `SOFT_DELETE_EXEMPT`).
 */
const PROBE_SQL: Readonly<Record<string, string>> = {
  users: 'SELECT SUM(id = ?) AS fresh, SUM(id = ?) AS stale FROM users WHERE id IN (?, ?)',
  locations: 'SELECT SUM(id = ?) AS fresh, SUM(id = ?) AS stale FROM locations WHERE id IN (?, ?)',
  business_units:
    'SELECT SUM(id = ?) AS fresh, SUM(id = ?) AS stale FROM business_units WHERE id IN (?, ?)',
};

interface State {
  until: number;
  active: boolean;
  hits: Map<string, string>;
}

const states = new WeakMap<Db, State>();

/** Hanya untuk tes: buang cache status dan terjemahan milik `db` (tes berbagi koneksi dan memutar jam sendiri). */
export function resetLegacyIdsState(db: Db): void {
  states.delete(db);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Kumpulkan string berpola UUID yang berada di bawah kunci pembawa ID (unik, paling banyak `MAX_LEGACY_CANDIDATES`).
 * `idKey` = apakah nilai ini (atau larik yang memuatnya) berada di bawah kunci ber-ID. Murni, tanpa I/O.
 */
export function collectLegacyIds(
  value: unknown,
  into: Set<string>,
  depth = 0,
  idKey = false,
): void {
  if (into.size >= MAX_LEGACY_CANDIDATES || depth > MAX_DEPTH) return;
  if (typeof value === 'string') {
    if (idKey && LEGACY_UUID_PATTERN.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLegacyIds(item, into, depth + 1, idKey);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (SKIP_KEYS.has(key)) continue;
    collectLegacyIds(value[key], into, depth + 1, ID_KEY.test(key));
  }
}

/**
 * Ganti nilai string ber-ID yang ada di `map` DI TEMPAT (struktur input milik kernel REST), dengan aturan kunci yang sama
 * seperti `collectLegacyIds`; mengembalikan jumlah penggantian.
 */
export function replaceLegacyIds(
  value: unknown,
  map: ReadonlyMap<string, string>,
  depth = 0,
  idKey = false,
): number {
  if (depth > MAX_DEPTH) return 0;
  let replaced = 0;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === 'string') {
        const next = idKey ? map.get(item) : undefined;
        if (next !== undefined) {
          value[i] = next;
          replaced++;
        }
      } else {
        replaced += replaceLegacyIds(item, map, depth + 1, idKey);
      }
    }
    return replaced;
  }
  if (!isPlainRecord(value)) return 0;
  for (const key of Object.keys(value)) {
    if (SKIP_KEYS.has(key)) continue;
    const item = value[key];
    const isId = ID_KEY.test(key);
    if (typeof item === 'string') {
      const next = isId ? map.get(item) : undefined;
      if (next !== undefined) {
        value[key] = next;
        replaced++;
      }
    } else {
      replaced += replaceLegacyIds(item, map, depth + 1, isId);
    }
  }
  return replaced;
}

function isMissingTable(error: unknown): boolean {
  return error instanceof DbError && error.errno === ER_NO_SUCH_TABLE;
}

/** True bila peta ada DAN data berada di keadaan sesudah migrasi (lihat catatan arah di kepala berkas). */
async function probeActive(db: Db): Promise<boolean> {
  let fresh = 0;
  let stale = 0;
  try {
    for (const [table, sql] of Object.entries(PROBE_SQL)) {
      const sample = await db
        .prepare(`SELECT old_id, new_id FROM ${MAP_TABLE} WHERE source_table = ? LIMIT 1`)
        .bind(table)
        .first<{ old_id: string; new_id: string }>();
      if (sample === null) continue;
      const row = await db
        .prepare(sql)
        .bind(sample.new_id, sample.old_id, sample.new_id, sample.old_id)
        .first<{ fresh: unknown; stale: unknown }>();
      fresh += Number(row?.fresh ?? 0);
      stale += Number(row?.stale ?? 0);
    }
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
  return fresh > 0 && stale === 0;
}

async function stateOf(env: Env): Promise<State> {
  const now = nowOf(env);
  const cached = states.get(env.DB);
  if (cached !== undefined && cached.until > now) return cached;
  const active = await probeActive(env.DB);
  // Cache terjemahan dibuang bila keadaan berubah (mis. `--revert`) atau habis masa berlakunya.
  const next: State = {
    until: now + STATE_TTL_MS,
    active,
    hits: active && cached?.active === true ? cached.hits : new Map(),
  };
  states.set(env.DB, next);
  return next;
}

/**
 * Pasangan lama -> baru untuk `ids`: dari cache bila ada, sisanya dicari ke peta (per `LOOKUP_CHUNK`) lalu dicache.
 * Hasil permintaan ini dipegang peta lokal, jadi pengosongan cache yang penuh tak dapat membuangnya.
 */
async function resolve(
  db: Db,
  ids: Iterable<string>,
  hits: Map<string, string>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = hits.get(id);
    if (hit !== undefined) found.set(id, hit);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
    const chunk = missing.slice(i, i + LOOKUP_CHUNK);
    const marks = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT old_id, new_id FROM ${MAP_TABLE} WHERE old_id IN (${marks})`)
      .bind(...chunk)
      .all<{ old_id: string; new_id: string }>();
    if (hits.size + results.length > HIT_CACHE_MAX) hits.clear();
    for (const row of results) {
      found.set(row.old_id, row.new_id);
      hits.set(row.old_id, row.new_id);
    }
  }
  return found;
}

/**
 * Terjemahkan ID lama di `input` (hasil `fromRequestParts`) DI TEMPAT. Mengembalikan jumlah nilai yang diganti. Tanpa
 * kandidat UUID tidak ada pekerjaan basis data sama sekali.
 */
export async function translateLegacyIds(env: Env, input: unknown): Promise<number> {
  const candidates = new Set<string>();
  collectLegacyIds(input, candidates);
  if (candidates.size === 0) return 0;
  const state = await stateOf(env);
  if (!state.active) return 0;
  let found: Map<string, string>;
  try {
    found = await resolve(env.DB, candidates, state.hits);
  } catch (error) {
    // Peta dibuang (tahap 2 atau `DROP TABLE`) di antara dua pengecekan status: tanpa pekerjaan, status dihitung ulang.
    if (isMissingTable(error)) {
      states.delete(env.DB);
      return 0;
    }
    throw error;
  }
  return replaceLegacyIds(input, found);
}
