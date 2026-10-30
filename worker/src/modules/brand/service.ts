import { itemKey, normalizeKey } from '@shared/items';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import { writeAudit } from '@worker/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@worker/core/cas';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { batchWrite } from '@worker/modules/access/repo';
import { reserveSyncRevs } from '@worker/modules/sync/state';
import type { BrandRecord } from './repo';
import {
  brandsFromResult,
  brandsStatement,
  findBrandByKey,
  insertBrandStmts,
  listBrands,
  updateBrandStmts,
} from './repo';

function toBrandDto(brand: BrandRecord): BrandDto {
  return {
    id: brand.id,
    externalId: brand.externalId,
    name: brand.name,
    status: brand.status,
    itemCount: brand.itemCount,
    updatedAt: brand.updatedAt,
  };
}

export function brandSnapshot(brand: BrandRecord): Record<string, unknown> {
  return { name: brand.name, status: brand.status };
}

const BRAND_CONFLICTS = { 'brands.key': { field: 'name', message: 'Nama merk sudah dipakai' } };

function newBrandRecord(env: Env, name: string, actor: ActorRef): BrandRecord {
  const now = nowIso(env);
  return {
    id: crypto.randomUUID(),
    externalId: '',
    name,
    key: normalizeKey(name),
    status: 'active',
    itemCount: 0,
    syncRev: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
}

/** Pernyataan penyisipan merk baru + audit `brand.create` (digabung ke `batch()` pemanggil). */
export function createBrandStmts(
  env: Env,
  brand: BrandRecord,
  actor: ActorRef,
): D1PreparedStatement[] {
  return [
    ...insertBrandStmts(env.DB, brand),
    writeAudit(env.DB, {
      ts: brand.createdAt,
      actor: actor.email,
      action: 'brand.create',
      target: brand.name,
      before: null,
      after: brandSnapshot(brand),
    }),
  ];
}

export async function listBrandDtos(env: Env): Promise<BrandDto[]> {
  return (await listBrands(env)).map(toBrandDto).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rencana "buat merk langsung saat mengetik" untuk penyimpanan item: bila merk (kunci ternormalisasi)
 * sudah ada, kembalikan tanpa pernyataan; jika belum, kembalikan merk baru beserta pernyataan
 * penyisipan + audit untuk digabung ke `batch()` penyimpanan item (atomik).
 */
export async function planBrandByName(
  env: Env,
  name: string,
  actor: ActorRef,
  /** Hasil `findBrandByKey` yang sudah dimuat pemanggil (hindari kueri ganda); `undefined` = muat di sini. */
  known?: BrandRecord | null,
): Promise<{ brand: BrandRecord; statements: D1PreparedStatement[] }> {
  const found = known === undefined ? await findBrandByKey(env, normalizeKey(name)) : known;
  if (found) return { brand: found, statements: [] };
  const created = newBrandRecord(env, name, actor);
  return { brand: created, statements: createBrandStmts(env, created, actor) };
}

/** Batas parameter terikat D1 per kueri (100) dikurangi sisa parameter tetap. */
const KEY_CHUNK = 90;
/**
 * Item per pernyataan `UPDATE ... FROM json_each` ganti nama: satu parameter JSON berisi `[id, kunci, urutan, hex(tipe)]`
 * per item. ASCII umum ±150 byte per item (500 item = ±75 KB); terburuk (tipe 100 karakter non-ASCII 3 byte, merk 60
 * karakter) ±1,1 KB per item = ±550 KB per potongan. Batas D1 untuk nilai string/BLOB 2 MB (spek §2b; batas 100 KB
 * berlaku untuk teks SQL, bukan nilai bind), jadi 500 per potongan masih jauh di bawah batas.
 */
const RENAME_ITEMS_PER_STATEMENT = 500;

/**
 * Tabrakan kunci merk+tipe dua item akibat ganti nama: dijaga indeks unik `items.key` pada `UPDATE` item
 * di batch yang sama (bukan kueri pemeriksaan terpisah), jadi pemeriksaan dan penulisan atomik.
 */
const BRAND_RENAME_CONFLICTS = {
  ...BRAND_CONFLICTS,
  'items.key': {
    field: 'name',
    message: 'Nama baru membuat merk dan tipe dua item bentrok',
  },
};

const RENAME_ALIAS_MESSAGE = 'Nama baru bentrok dengan nama lain item';

/**
 * Penjaga di batch ganti nama: kunci item baru tidak boleh sama dengan nama lain (alias) item mana pun, termasuk
 * milik item itu sendiri. Satu `SELECT` per potongan kunci yang melempar `integer overflow` bila ada bentrok
 * (dipetakan ke CONFLICT di `saveBrand`), sehingga seluruh batch batal.
 */
function aliasCollisionGuards(env: Env, keys: readonly string[]): D1PreparedStatement[] {
  const guards: D1PreparedStatement[] = [];
  for (let from = 0; from < keys.length; from += KEY_CHUNK) {
    const chunk = keys.slice(from, from + KEY_CHUNK);
    guards.push(
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM item_alias_keys WHERE key IN (${chunk.map(() => '?').join(',')})) THEN ${CAS_FAIL_SQL} ELSE 1 END`,
      ).bind(...chunk),
    );
  }
  return guards;
}

/** True bila salah satu kunci masih dipegang sebagai nama lain (alias) item mana pun: satu round trip. */
async function aliasCollides(env: Env, keys: readonly string[]): Promise<boolean> {
  const unique = [...new Set(keys)];
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < unique.length; from += KEY_CHUNK) {
    const chunk = unique.slice(from, from + KEY_CHUNK);
    statements.push(
      env.DB.prepare(
        `SELECT 1 AS hit FROM item_alias_keys WHERE key IN (${chunk.map(() => '?').join(',')}) LIMIT 1`,
      ).bind(...chunk),
    );
  }
  if (statements.length === 0) return false;
  return (await env.DB.batch(statements)).some((result) => result.results.length > 0);
}

/**
 * Item milik merk pada saat dibaca: id, tipe (kunci baru dihitung dari tipe), dan `mh` = `hex(model)` dari D1.
 * Tipe dibandingkan per BYTE (`hex`), bukan lewat teks hasil dekode `json_extract`: teks Unicode tak utuh (mis.
 * surrogate tunggal) tidak sama byte-nya setelah bolak-balik JSON, dan item tak akan pernah cocok.
 */
interface OwnItem {
  id: string;
  model: string;
  mh: string;
}

const OWN_ITEMS_SQL =
  'SELECT id, model, hex(model) AS mh FROM items WHERE brand_id = ? ORDER BY id';

/**
 * Kunci sementara yang pasti unik per item: karakter kontrol U+0001 (kunci asli tidak pernah memuatnya) + `rowid`
 * (bilangan bulat unik; `id` tidak dipakai karena `items.key` berurutan NOCASE sehingga `AB` dan `ab` bertabrakan).
 */
const TEMP_KEY_SQL = 'char(1) || rowid';

/**
 * Menghitung ulang kunci SELURUH item merk ini dalam dua tahap di batch yang sama, supaya tabrakan SEMENTARA antar
 * item merk ini (kunci baru satu item = kunci lama item lain di merk yang sama) tidak ditolak indeks unik
 * `items.key`, yang memeriksa per baris:
 *  1. satu `UPDATE` memberi semua item merk kunci sementara unik (`TEMP_KEY_SQL`; dilewati bila merk tanpa item);
 *  2. `UPDATE ... FROM json_each` per 500 item memasang kunci akhir dan revisi sinkron tiap item dari jatah yang
 *     dipesan `reserveSyncRevs` (item ke-`i` dari `count` memakai `seq - (count - 1 - i)`). Hanya baris yang masih
 *     milik merk ini dengan tipe yang sama (byte) dengan yang dibaca yang disentuh.
 * Penjaga di batch yang sama (keduanya `integer overflow`, mengulang `saveBrand`): jumlah item merk harus sama dengan
 * yang dibaca (sebelum tahap 1), dan tidak boleh ada item merk yang masih berkunci sementara (sesudah tahap 2:
 * item baru, pindah merk, atau tipe berubah di antara baca dan tulis). Bentrok sungguhan dengan merk+tipe item
 * merk lain ditolak indeks unik `items.key` pada tahap 2. `+items.brand_id` (tanpa indeks) sengaja: tanpa `+`
 * planner memilih indeks `items_brand` sebagai loop luar dan memindai `json_each` untuk tiap item (O(N^2), 28 ms untuk
 * 200 item di SQLite); dengan `+` ia mencari baris lewat PRIMARY KEY dari tiap baris JSON.
 */
function renameItemStatements(
  env: Env,
  brandId: string,
  own: ReadonlyArray<{ id: string; mh: string; next: string }>,
): D1PreparedStatement[] {
  const guard = (condition: string, ...binds: unknown[]) =>
    env.DB.prepare(`SELECT CASE WHEN ${condition} THEN 1 ELSE ${CAS_FAIL_SQL} END`).bind(...binds);
  // Penjaga jumlah SELALU dikirim (juga untuk merk tanpa item: item yang disisipkan di tengah memicu ulang).
  const statements: D1PreparedStatement[] = [
    guard('(SELECT COUNT(*) FROM items WHERE brand_id = ?) = ?', brandId, own.length),
  ];
  if (own.length === 0) return statements;
  statements.push(
    env.DB.prepare(`UPDATE items SET key = ${TEMP_KEY_SQL} WHERE brand_id = ?`).bind(brandId),
  );
  for (let from = 0; from < own.length; from += RENAME_ITEMS_PER_STATEMENT) {
    const chunk = own.slice(from, from + RENAME_ITEMS_PER_STATEMENT);
    const rows = JSON.stringify(
      chunk.map((item, offset) => [item.id, item.next, from + offset, item.mh]),
    );
    statements.push(
      env.DB.prepare(
        `UPDATE items SET key = j.k, sync_rev = (SELECT seq FROM sync_state WHERE resource = 'items') - ${own.length - 1} + j.i FROM (SELECT json_extract(value, '$[0]') AS id, json_extract(value, '$[1]') AS k, json_extract(value, '$[2]') AS i, json_extract(value, '$[3]') AS mh FROM json_each(?)) AS j WHERE items.id = j.id AND +items.brand_id = ? AND hex(items.model) = j.mh`,
      ).bind(rows, brandId),
    );
  }
  statements.push(
    guard(
      'NOT EXISTS (SELECT 1 FROM items WHERE brand_id = ? AND substr(key, 1, 1) = char(1))',
      brandId,
    ),
  );
  return statements;
}

/** Percobaan ganti nama bila himpunan item merk berubah di antara baca dan tulis. */
const RENAME_ATTEMPTS = 3;
const RENAME_STALE_MESSAGE = 'Item merk ini sedang berubah; ulangi permintaan';

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  // Satu round trip baca: daftar merk (langsung dari D1) dan, untuk merk yang ada, item milik merk itu
  // (indeks `items_brand`; dipakai hanya bila nama berubah).
  const [brandsResult, ownRows] = await env.DB.batch([
    brandsStatement(env),
    ...(input.id ? [env.DB.prepare(OWN_ITEMS_SQL).bind(input.id)] : []),
  ]);
  const brands = brandsFromResult(brandsResult as { results: unknown[] });
  const existing = input.id ? brands.find((brand) => brand.id === input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  const key = normalizeKey(input.name);
  if (brands.some((brand) => brand.id !== input.id && brand.key === key)) {
    throw appError('CONFLICT', 'Nama merk sudah dipakai', { name: 'Nama merk sudah dipakai' });
  }

  if (!existing) {
    const created = newBrandRecord(env, input.name, actor);
    await batchWrite(env.DB, createBrandStmts(env, created, actor), BRAND_CONFLICTS);
    return toBrandDto(created);
  }

  if (existing.name === input.name) return toBrandDto(existing);

  // Kunci item = merk + tipe, jadi ganti nama menghitung ulang kunci item merk ini. Tabrakan dengan nama lain
  // (alias) dijaga penjaga di batch tulis; tabrakan dengan merk+tipe item lain dijaga indeks unik `items.key`;
  // perubahan himpunan item merk di antara baca dan tulis dijaga `renameItemStatements` (diulang).
  // Hanya item merk ini (indeks `items_brand`) dan kunci baru yang disentuh; tidak ada pemindaian `items`.
  let rows = (ownRows?.results ?? []) as OwnItem[];
  for (let attempt = 1; ; attempt++) {
    const own = rows.map((item) => ({ ...item, next: itemKey(input.name, item.model) }));
    const now = nowIso(env);
    const updated: BrandRecord = {
      ...existing,
      name: input.name,
      key,
      updatedAt: now,
      updatedBy: actor.email,
    };
    const statements: D1PreparedStatement[] = [
      ...aliasCollisionGuards(env, [...new Set(own.map((item) => item.next))]),
      ...updateBrandStmts(env.DB, updated),
    ];
    // Nama merk ikut tersinkron di setiap item (`merk`), jadi revisi item naik walau kunci sama. Satu pernyataan
    // memesan N revisi unik berurutan; tiap item mengambil jatahnya sendiri. Penjaga jumlah dikirim juga untuk N = 0.
    if (own.length > 0) statements.push(reserveSyncRevs(env.DB, 'items', own.length, now));
    statements.push(...renameItemStatements(env, existing.id, own));
    statements.push(
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'brand.update',
        target: updated.name,
        before: brandSnapshot(existing),
        after: brandSnapshot(updated),
      }),
    );
    try {
      await batchWrite(env.DB, statements, BRAND_RENAME_CONFLICTS);
      return toBrandDto(updated);
    } catch (error) {
      if (!isGuardFailure(error)) throw error;
      // Sebab dipilih dari bentrok yang SEBENARNYA, bukan dari perbandingan himpunan item (rentan ABA): nama baru
      // memang dipegang sebagai nama lain item mana pun, atau himpunan/tipe item berubah (ulangi dari bacaan baru).
      if (
        await aliasCollides(
          env,
          own.map((item) => item.next),
        )
      ) {
        throw appError('CONFLICT', RENAME_ALIAS_MESSAGE, { name: RENAME_ALIAS_MESSAGE });
      }
      if (attempt >= RENAME_ATTEMPTS) throw appError('CONFLICT', RENAME_STALE_MESSAGE);
      rows = (await env.DB.prepare(OWN_ITEMS_SQL).bind(existing.id).all<OwnItem>()).results;
    }
  }
}

export async function setBrandStatus(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const brands = await listBrands(env, { fresh: true });
  const existing = brands.find((brand) => brand.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  if (existing.status === input.status) return toBrandDto(existing);
  const now = nowIso(env);
  const updated: BrandRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await env.DB.batch([
    ...updateBrandStmts(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'brand.activate' : 'brand.deactivate',
      target: updated.name,
      before: brandSnapshot(existing),
      after: brandSnapshot(updated),
    }),
  ]);
  return toBrandDto(updated);
}
