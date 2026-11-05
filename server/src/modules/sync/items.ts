import { writeAudit } from '@server/core/audit';
import { batchGuarded } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { isAppError } from '@server/core/errors';
import { PreEncodedJson } from '@server/core/pre-encoded';
import type { BrandRecord } from '@server/modules/brand/repo';
import { brandsFromResult, brandsStatement, listBrands } from '@server/modules/brand/repo';
import type { ItemRecord, ItemRow } from '@server/modules/item/repo';
import { ITEM_COLUMNS, toItem } from '@server/modules/item/repo';
import {
  ITEM_CONFLICTS,
  itemLabel,
  itemSnapshot,
  itemSyncSignature,
  planItemWrite,
} from '@server/modules/item/service';
import { FILE_SCHEME, MARKDOWN_MAX_LENGTH } from '@shared/files';
import { DRIVE_REF_SCHEME, extractFileRefs, mapMarkdownRefs, normalizeKey } from '@shared/items';
import type { ItemStatus, SaveItemInput } from '@shared/rpc';
import type { SyncEntryResult, SyncWireItem } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { isStaleWrite, syncFailureResult } from './conflict';
import type { DriveProbe } from './files';
import { commitDriveFilesStmts, planDriveFiles, probeDriveIds } from './files';
import type { SyncItemInput } from './items-wire';
import { checkSyncItem, driveIdsOf, driveImageIds, WIRE_FIELD_NAMES } from './items-wire';
import { validateSyncPull } from './pull';
import type { SyncPushEnvelope } from './wire';

export { checkSyncItem };

/** Field berat yang hanya dikirim bila diminta lewat `include`. */
export const SYNC_ITEM_INCLUDABLE = ['detail', 'stickers', 'accessories'] as const;

const SYNC_ACTOR_REF: ActorRef = { email: SYNC_ACTOR };

export function toWireItem(
  item: ItemRecord,
  names: ReadonlyMap<string, string>,
  driveByFile: ReadonlyMap<string, string>,
  include: readonly string[],
): SyncWireItem {
  const wire: SyncWireItem = {
    uid: item.id,
    id: item.externalId === '' ? null : item.externalId,
    merk: names.get(item.brandId) ?? '',
    tipe: item.model,
    isCountryLock: item.isCountryLock,
    images: item.attachments.flatMap((fileId) => {
      const driveId = driveByFile.get(fileId);
      return driveId === undefined ? [] : [driveId];
    }),
    active: item.status === 'active',
    rev: item.syncRev,
  };
  if (include.includes('detail')) {
    wire.detail = mapMarkdownRefs(
      item.detail,
      FILE_SCHEME,
      DRIVE_REF_SCHEME,
      (id) => driveByFile.get(id) ?? null,
    );
  }
  if (include.includes('stickers')) {
    wire.stickers = item.stickers.map((sticker) => ({
      name: sticker.name,
      note: sticker.note,
      image: sticker.fileId === null ? null : (driveByFile.get(sticker.fileId) ?? null),
    }));
  }
  if (include.includes('accessories')) {
    wire.accessories = item.accessories.map((accessory) => ({
      name: accessory.name,
      qty: accessory.qty,
    }));
  }
  return wire;
}

export async function brandNameMap(env: Env): Promise<Map<string, string>> {
  return new Map((await listBrands(env, { fresh: true })).map((brand) => [brand.id, brand.name]));
}

/** id berkas -> id Drive, hanya untuk berkas yang dirujuk `items` (dipecah ≤ 90 parameter per kueri D1). */
export async function driveIdsByFile(
  env: Env,
  items: readonly ItemRecord[],
  include: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const id of item.attachments) ids.add(id);
    if (include.includes('stickers')) {
      for (const sticker of item.stickers) if (sticker.fileId !== null) ids.add(sticker.fileId);
    }
    if (include.includes('detail')) for (const id of extractFileRefs(item.detail)) ids.add(id);
  }
  const all = [...ids];
  const map = new Map<string, string>();
  if (all.length === 0) return map;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    statements.push(
      env.DB.prepare(
        `SELECT id, drive_id FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk),
    );
  }
  const results = await env.DB.batch<{ id: string; drive_id: string }>(statements);
  for (const result of results) for (const row of result.results) map.set(row.id, row.drive_id);
  return map;
}

/**
 * Id Drive gambar galeri sebagai larik JSON, dihitung SQLite (urut galeri; berkas tak dikenal dilewati, seperti
 * `toWireItem`). Jalur cepat `'[]'` menghindari `json_each` untuk item tanpa gambar; kolom bukan larik JSON
 * dibaca sebagai kosong (seperti `parseStrings`).
 */
const PULL_IMAGES_SQL = `CASE
  WHEN i.attachments = '[]' THEN '[]'
  WHEN json_valid(i.attachments) = 0 THEN '[]'
  WHEN json_type(i.attachments) <> 'array' THEN '[]'
  ELSE COALESCE((SELECT json_group_array(drive_id) FROM (SELECT f.drive_id AS drive_id FROM json_each(i.attachments) a JOIN files f ON f.id = a.value ORDER BY a.key)), '[]')
END`;

/**
 * Stiker kabel (`name`, `note`, `image` = id Drive atau null) dari kolom `stickers`, dengan aturan yang sama
 * dengan `parseStickers` (hanya objek bernama; catatan bukan teks = ''; berkas tak dikenal = null).
 */
const PULL_STICKERS_SQL = `CASE
  WHEN json_valid(i.stickers) = 0 THEN '[]'
  WHEN json_type(i.stickers) <> 'array' THEN '[]'
  ELSE COALESCE((SELECT json_group_array(json(w)) FROM (
    SELECT json_object(
      'name', trim(json_extract(e.value, '$.name')),
      'note', CASE WHEN json_type(e.value, '$.note') = 'text' THEN trim(json_extract(e.value, '$.note')) ELSE '' END,
      'image', (SELECT f.drive_id FROM files f WHERE f.id = trim(json_extract(e.value, '$.fileId')))
    ) AS w
    FROM json_each(i.stickers) e
    WHERE CASE WHEN e.type = 'object' THEN json_type(e.value, '$.name') = 'text' AND trim(json_extract(e.value, '$.name')) <> '' ELSE 0 END
    ORDER BY e.key)), '[]')
END`;

/** Kelengkapan kabel (`name`, `qty`) dengan aturan `parseAccessories` (objek bernama, qty bilangan bulat >= 1). */
const PULL_ACCESSORIES_SQL = `CASE
  WHEN json_valid(i.accessories) = 0 THEN '[]'
  WHEN json_type(i.accessories) <> 'array' THEN '[]'
  ELSE COALESCE((SELECT json_group_array(json(w)) FROM (
    SELECT json_object('name', trim(json_extract(e.value, '$.name')), 'qty', json_extract(e.value, '$.qty')) AS w
    FROM json_each(i.accessories) e
    WHERE CASE WHEN e.type = 'object' THEN json_type(e.value, '$.name') = 'text' AND trim(json_extract(e.value, '$.name')) <> ''
      AND json_type(e.value, '$.qty') = 'integer' AND json_extract(e.value, '$.qty') >= 1 ELSE 0 END
    ORDER BY e.key)), '[]')
END`;

/**
 * Badan kabel item disusun di SQLite sebagai teks JSON: Worker tidak lagi membuat objek per baris, memetakan
 * merk/gambar/stiker, lalu menyerialkan ulang (gerbang CPU: halaman 500 item). Nilai field sama dengan
 * `toWireItem` (acuan tes); nama merk dari `brands` pada kueri yang sama (selalu segar).
 */
function pullHeadSql(include: readonly string[]): string {
  const fields = [
    `'uid', trim(i.id)`,
    `'id', CASE WHEN trim(i.external_id) = '' THEN NULL ELSE trim(i.external_id) END`,
    `'merk', COALESCE(trim(b.name), '')`,
    `'tipe', trim(i.model)`,
    `'isCountryLock', json(CASE WHEN trim(i.is_country_lock) = 'true' THEN 'true' ELSE 'false' END)`,
    `'images', json(${PULL_IMAGES_SQL})`,
    `'active', json(CASE WHEN trim(i.status) = 'inactive' THEN 'false' ELSE 'true' END)`,
    `'rev', i.sync_rev`,
  ];
  if (include.includes('stickers')) fields.push(`'stickers', json(${PULL_STICKERS_SQL})`);
  if (include.includes('accessories')) fields.push(`'accessories', json(${PULL_ACCESSORIES_SQL})`);
  return `json_object(${fields.join(', ')})`;
}

interface PullRow {
  j: string;
  rev: number;
  /** `detail` sebagai literal string JSON; null bila memuat rujukan berkas (dipetakan di Worker, lihat `dr`). */
  dj?: string | null;
  /** Teks Markdown mentah, hanya untuk detail yang memuat rujukan `qcfile:`. */
  dr?: string | null;
}

/** Kolom besar hanya dibaca bila diminta lewat `include`; detail tanpa rujukan berkas sudah berbentuk JSON. */
function pullSql(include: readonly string[]): string {
  const detail = include.includes('detail')
    ? `, CASE WHEN instr(i.detail_md, '${FILE_SCHEME}') = 0 THEN json_quote(i.detail_md) END AS dj, CASE WHEN instr(i.detail_md, '${FILE_SCHEME}') > 0 THEN i.detail_md END AS dr`
    : '';
  return `SELECT ${pullHeadSql(include)} AS j, i.sync_rev AS rev${detail} FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE i.sync_rev > ? ORDER BY i.sync_rev ASC LIMIT ?`;
}

/** Id berkas -> id Drive untuk berkas yang dirujuk detail halaman ini (kosong bila tak ada rujukan). */
async function driveIdsForRefs(
  env: Env,
  fileIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const all = [...fileIds];
  if (all.length === 0) return map;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    statements.push(
      env.DB.prepare(
        `SELECT id, drive_id FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk),
    );
  }
  const results = await env.DB.batch<{ id: string; drive_id: string }>(statements);
  for (const result of results) for (const row of result.results) map.set(row.id, row.drive_id);
  return map;
}

export async function pullItems(env: Env, raw: unknown): Promise<PreEncodedJson> {
  const input = validateSyncPull(raw, SYNC_ITEM_INCLUDABLE);
  // Halaman berindeks `items_sync_rev` (hanya baris > sinceRev, urut naik, limit+1 untuk hasMore).
  const result = await env.DB.prepare(pullSql(input.include))
    .bind(input.sinceRev, input.limit + 1)
    .all<PullRow>();
  const rows = result.results;
  const count = Math.min(rows.length, input.limit);
  const bodies: string[] = [];
  if (!input.include.includes('detail')) {
    for (let i = 0; i < count; i++) bodies.push((rows[i] as PullRow).j);
  } else {
    // Hanya detail yang memuat rujukan berkas yang perlu dipetakan di sini (satu kueri berkas untuk halaman).
    const fileIds = new Set<string>();
    for (let i = 0; i < count; i++) {
      const row = rows[i] as PullRow;
      if (row.dj == null) for (const id of extractFileRefs(row.dr ?? '')) fileIds.add(id);
    }
    const driveByFile = await driveIdsForRefs(env, fileIds);
    for (let i = 0; i < count; i++) {
      const row = rows[i] as PullRow;
      const detail =
        row.dj ??
        JSON.stringify(
          mapMarkdownRefs(
            row.dr ?? '',
            FILE_SCHEME,
            DRIVE_REF_SCHEME,
            (id) => driveByFile.get(id) ?? null,
          ),
        );
      bodies.push(`${row.j.slice(0, -1)},"detail":${detail}}`);
    }
  }
  const last = count > 0 ? (rows[count - 1] as PullRow) : undefined;
  const nextRev = last ? Number(last.rev) : input.sinceRev;
  return new PreEncodedJson(
    `{"items":[${bodies.join(',')}],"nextRev":${nextRev},"hasMore":${rows.length > input.limit}}`,
  );
}

type Match =
  | { kind: 'none' }
  | { kind: 'found'; existing: ItemRecord }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'conflict'; existing: ItemRecord; fields: Record<string, string> };

/**
 * Item yang dimuat SEKALI di awal `push` (satu round trip D1 untuk seluruh entri) dan dijaga selaras dengan
 * tulisan permintaan ini. Pencarian per entri tidak lagi memakai kueri sendiri-sendiri.
 */
interface ItemIndex {
  byId: Map<string, ItemRecord>;
  /** id MySQL -> item (hanya yang terpetakan). */
  byExternal: Map<string, ItemRecord>;
  /** kunci item (huruf kecil, seperti kolom `key` NOCASE) -> item. */
  byKey: Map<string, ItemRecord>;
}

/** Kunci pencocokan merk+tipe seperti `matchSyncItem` (kontrak 3.3). */
function syncKeyOf(entry: { merk?: string | undefined; tipe?: string | undefined }): string | null {
  if (entry.merk === undefined || entry.tipe === undefined) return null;
  return `${normalizeKey(entry.merk)} ${normalizeKey(entry.tipe)}`.trim().toLowerCase();
}

function indexItem(index: ItemIndex, item: ItemRecord): void {
  index.byId.set(item.id, item);
  if (item.externalId !== '' && !index.byExternal.has(item.externalId)) {
    index.byExternal.set(item.externalId, item);
  }
  index.byKey.set(item.key.toLowerCase(), item);
}

/** Buang jejak lama item (kunci/id MySQL sebelum diubah) sebelum `indexItem` memasang yang baru. */
function unindexItem(index: ItemIndex, item: ItemRecord): void {
  index.byId.delete(item.id);
  if (index.byExternal.get(item.externalId)?.id === item.id)
    index.byExternal.delete(item.externalId);
  if (index.byKey.get(item.key.toLowerCase())?.id === item.id) {
    index.byKey.delete(item.key.toLowerCase());
  }
}

/**
 * Satu `batch` untuk seluruh pencarian uid / id MySQL / kunci semua entri (<= 90 parameter per kueri) DAN daftar
 * merk (langsung dari D1): satu round trip untuk keduanya.
 */
async function prefetchItems(
  env: Env,
  entries: readonly SyncItemInput[],
): Promise<{ index: ItemIndex; brands: BrandRecord[] }> {
  const index: ItemIndex = { byId: new Map(), byExternal: new Map(), byKey: new Map() };
  const uids = [
    ...new Set(entries.flatMap((entry) => (entry.uid === undefined ? [] : [entry.uid]))),
  ];
  const externals = [
    ...new Set(entries.flatMap((entry) => (entry.id === undefined ? [] : [entry.id]))),
  ];
  const keys = [...new Set(entries.flatMap((entry) => syncKeyOf(entry) ?? []))];
  const statements: D1PreparedStatement[] = [];
  const add = (column: string, values: readonly string[]) => {
    for (let from = 0; from < values.length; from += 90) {
      const chunk = values.slice(from, from + 90);
      statements.push(
        env.DB.prepare(
          `SELECT ${ITEM_COLUMNS} FROM items WHERE ${column} IN (${chunk.map(() => '?').join(',')})`,
        ).bind(...chunk),
      );
    }
  };
  add('id', uids);
  add('external_id', externals);
  add('key', keys);
  const itemResults = statements.length;
  statements.push(brandsStatement(env));
  const results = await env.DB.batch<ItemRow>(statements);
  for (const result of results.slice(0, itemResults)) {
    for (const row of result.results) indexItem(index, toItem(row));
  }
  return { index, brands: brandsFromResult(results[itemResults] as { results: unknown[] }) };
}

/** Pencocokan: uid -> id MySQL -> merk+tipe ternormalisasi (kontrak 3.3), dari indeks hasil `prefetchItems`. */
function matchSyncItem(index: ItemIndex, entry: SyncItemInput): Match {
  const byUid = entry.uid === undefined ? undefined : index.byId.get(entry.uid);
  if (entry.uid !== undefined && !byUid) {
    return { kind: 'invalid', fields: { uid: 'Item tidak ditemukan' } };
  }
  const byId = entry.id === undefined ? undefined : index.byExternal.get(entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return {
      kind: 'conflict',
      existing: byUid,
      fields: { id: 'uid dan id mengarah ke item berbeda' },
    };
  }
  let existing = byUid ?? byId ?? undefined;
  if (!existing) {
    const key = syncKeyOf(entry);
    if (key !== null) existing = index.byKey.get(key) ?? undefined;
  }
  if (!existing) return { kind: 'none' };
  if (entry.id !== undefined && existing.externalId !== '' && existing.externalId !== entry.id) {
    return { kind: 'conflict', existing, fields: { id: 'Item sudah terpetakan ke id MySQL lain' } };
  }
  return { kind: 'found', existing };
}

async function itemConflict(
  env: Env,
  index: number,
  existing: ItemRecord,
  names: ReadonlyMap<string, string>,
  proposed: Partial<{ brand: string } & ItemRecord>,
  fields?: Record<string, string>,
): Promise<SyncEntryResult<SyncWireItem>> {
  const before = { ...existing, brand: names.get(existing.brandId) ?? '' };
  await env.DB.batch([
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: SYNC_ACTOR,
      action: 'item.sync.conflict',
      target: itemLabel(before),
      before: itemSnapshot(before),
      after: itemSnapshot({ ...before, ...proposed }),
    }),
  ]);
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireItem(
      existing,
      names,
      await driveIdsByFile(env, [existing], SYNC_ITEM_INCLUDABLE),
      SYNC_ITEM_INCLUDABLE,
    ),
    ...(fields ? { fields } : {}),
  };
}

/** Keadaan bersama satu permintaan `push`: merk (dimuat langsung dari D1 sekali) dan indeks item. */
interface PushState {
  names: Map<string, string>;
  brandsByKey: Map<string, BrandRecord>;
  items: ItemIndex;
}

async function upsertSyncItem(
  env: Env,
  entry: SyncItemInput,
  index: number,
  overwrite: boolean,
  probes: ReadonlyMap<string, DriveProbe | null>,
  state: PushState,
): Promise<SyncEntryResult<SyncWireItem>> {
  const { names } = state;
  const matched = matchSyncItem(state.items, entry);
  if (matched.kind === 'invalid') return { index, status: 'invalid', fields: matched.fields };
  if (matched.kind === 'conflict') {
    return itemConflict(env, index, matched.existing, names, {}, matched.fields);
  }
  const existing = matched.kind === 'found' ? matched.existing : undefined;

  if (!existing) {
    const required: Record<string, string> = {};
    if (entry.merk === undefined) required.merk = 'Wajib diisi untuk item baru';
    if (entry.tipe === undefined) required.tipe = 'Wajib diisi untuk item baru';
    if (entry.isCountryLock === undefined) required.isCountryLock = 'Wajib diisi untuk item baru';
    if (Object.keys(required).length > 0) return { index, status: 'invalid', fields: required };
  }

  const ownerId = existing?.id ?? crypto.randomUUID();
  const { map, missing, pending } = await planDriveFiles(env, driveIdsOf(entry), probes, ownerId);
  if (missing.length > 0) {
    const bad = new Set(missing);
    const fields: Record<string, string> = {};
    const first = (ids: readonly string[]) => ids.find((id) => bad.has(id));
    const badImage = first(entry.images ?? []);
    if (badImage !== undefined) fields.images = `Berkas ${badImage} tidak ada di folder aplikasi`;
    const badSticker = first(
      (entry.stickers ?? []).flatMap((sticker) => (sticker.image === null ? [] : [sticker.image])),
    );
    if (badSticker !== undefined) {
      fields.stickers = `Berkas ${badSticker} tidak ada di folder aplikasi`;
    }
    const badMarkdown = first(driveImageIds(entry.detail ?? ''));
    if (badMarkdown !== undefined) {
      fields.detail = `Berkas ${badMarkdown} tidak ada di folder aplikasi`;
    }
    return { index, status: 'invalid', fields };
  }

  const status: ItemStatus =
    entry.active === undefined
      ? (existing?.status ?? 'active')
      : entry.active
        ? 'active'
        : 'inactive';
  const merged: SaveItemInput = {
    ...(existing ? { id: existing.id } : {}),
    brand: entry.merk ?? (existing ? (names.get(existing.brandId) ?? '') : ''),
    model: entry.tipe ?? existing?.model ?? '',
    isCountryLock: entry.isCountryLock ?? existing?.isCountryLock ?? false,
    aliases: existing ? [...existing.aliases] : [],
    stickers: entry.stickers
      ? entry.stickers.map((sticker) => ({
          name: sticker.name,
          note: sticker.note,
          fileId: sticker.image === null ? null : (map.get(sticker.image) ?? null),
        }))
      : (existing?.stickers ?? []),
    accessories: entry.accessories ?? existing?.accessories ?? [],
    attachments: entry.images
      ? entry.images.flatMap((driveId) => {
          const fileId = map.get(driveId);
          return fileId === undefined ? [] : [fileId];
        })
      : (existing?.attachments ?? []),
    detail:
      entry.detail !== undefined
        ? mapMarkdownRefs(entry.detail, DRIVE_REF_SCHEME, FILE_SCHEME, (id) => map.get(id) ?? null)
        : (existing?.detail ?? ''),
  };

  // Rujukan drive:<id> menjadi qcfile:<uuid> yang lebih panjang: batas Markdown berlaku pada hasil akhir.
  if (merged.detail.length > MARKDOWN_MAX_LENGTH) {
    return {
      index,
      status: 'invalid',
      fields: {
        detail: `Maksimal ${MARKDOWN_MAX_LENGTH} karakter setelah rujukan gambar dipetakan`,
      },
    };
  }

  if (existing) {
    // Merk dibandingkan menurut kunci ternormalisasi: beda huruf besar/kecil saja bukan perubahan.
    const currentSignature = itemSyncSignature({
      ...existing,
      brandId: normalizeKey(names.get(existing.brandId) ?? ''),
    });
    const wantedSignature = itemSyncSignature({
      brandId: normalizeKey(merged.brand),
      model: merged.model,
      isCountryLock: merged.isCountryLock,
      attachments: merged.attachments,
      detail: merged.detail,
      stickers: merged.stickers,
      accessories: merged.accessories,
      status,
    });
    const mapChanged = entry.id !== undefined && existing.externalId === '';
    if (currentSignature === wantedSignature) {
      if (mapChanged) {
        // Pemetaan id MySQL adalah pembukuan, bukan perubahan data: tanpa kenaikan rev dan tanpa audit.
        await env.DB.prepare('UPDATE items SET external_id = ? WHERE id = ?')
          .bind(entry.id as string, existing.id)
          .run();
        unindexItem(state.items, existing);
        indexItem(state.items, { ...existing, externalId: entry.id as string });
        return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
      }
      return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
    }
    if (isStaleWrite(entry.baseRev, existing.syncRev, overwrite)) {
      return itemConflict(env, index, existing, names, {
        brand: merged.brand,
        model: merged.model,
        isCountryLock: merged.isCountryLock,
        attachments: merged.attachments,
        detail: merged.detail,
        stickers: merged.stickers,
        accessories: merged.accessories,
        status,
      });
    }
  }

  // Semua pemeriksaan (field, konflik, berkas) sudah lolos: baru sekarang berkas baru didaftarkan.
  if (pending.length > 0) await env.DB.batch(commitDriveFilesStmts(env, pending));
  const plan = await planItemWrite(env, merged, {
    id: ownerId,
    existing,
    actor: SYNC_ACTOR_REF,
    externalId: entry.id,
    status,
    knownBrand: state.brandsByKey.get(normalizeKey(merged.brand)) ?? null,
  });
  // Revisi yang dipakai baris datang dari `RETURNING sync_rev` pada INSERT/UPDATE item di batch yang sama
  // (tanpa pernyataan tambahan); hanya pernyataan itu yang mengembalikan baris.
  const results = await batchGuarded(
    env.DB,
    plan.statements,
    ITEM_CONFLICTS,
    'Item diubah pihak lain; ulangi permintaan',
  );
  const written = (
    results.find((result) => result.results.length > 0)?.results[0] as
      | { sync_rev: number }
      | undefined
  )?.sync_rev;
  const record: ItemRecord = { ...plan.record, syncRev: written ?? plan.record.syncRev };
  if (existing) unindexItem(state.items, existing);
  indexItem(state.items, record);
  // Merk yang dibuat/dipakai penulisan ini ikut tercatat untuk entri berikutnya.
  names.set(record.brandId, plan.brandName);
  const brandKey = normalizeKey(plan.brandName);
  if (!state.brandsByKey.has(brandKey)) {
    state.brandsByKey.set(brandKey, {
      id: record.brandId,
      externalId: '',
      name: plan.brandName,
      key: brandKey,
      status: 'active',
      itemCount: 0,
      syncRev: 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      updatedBy: SYNC_ACTOR,
    });
  }
  return {
    index,
    status: existing ? 'updated' : 'created',
    uid: record.id,
    rev: record.syncRev,
  };
}

/** Pesan galat penulisan memakai nama field internal; ubah ke nama pada kabel. */
function toWireFields<T>(result: SyncEntryResult<T>): SyncEntryResult<T> {
  if (!result.fields) return result;
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.fields)) {
    fields[WIRE_FIELD_NAMES[key] ?? key] = message;
  }
  return { ...result, fields };
}

export async function pushItems(
  env: Env,
  envelope: SyncPushEnvelope,
): Promise<{ results: Array<SyncEntryResult<SyncWireItem>> }> {
  const checks = envelope.entries.map((raw) => checkSyncItem(raw));
  // I/O Drive sekali untuk seluruh permintaan: info untuk semua id yang belum tercatat.
  const probes = await probeDriveIds(
    env,
    checks.flatMap((check) => (check.ok ? driveIdsOf(check.value) : [])),
  );
  // Merk (langsung dari D1) dan item yang dirujuk dimuat sekali untuk seluruh permintaan (satu round trip).
  const { index, brands } = await prefetchItems(
    env,
    checks.flatMap((check) => (check.ok ? [check.value] : [])),
  );
  const state: PushState = {
    names: new Map(brands.map((brand) => [brand.id, brand.name])),
    brandsByKey: new Map(brands.map((brand) => [brand.key, brand])),
    items: index,
  };
  const results: Array<SyncEntryResult<SyncWireItem>> = [];
  for (const [index, check] of checks.entries()) {
    if (!check.ok) {
      results.push({ index, status: 'invalid', fields: check.fields });
      continue;
    }
    try {
      results.push(
        await upsertSyncItem(env, check.value, index, envelope.overwrite, probes, state),
      );
    } catch (error) {
      // Penjaga CAS yang gagal (rebutan dengan penulis lain) tidak bermakna "isi tidak sah": boleh diulang.
      if (isAppError(error) && error.code === 'CONFLICT' && error.fields === undefined) {
        results.push({
          index,
          status: 'error',
          fields: { _: 'Item diubah pihak lain saat diproses; ulangi permintaan' },
        });
        continue;
      }
      results.push(toWireFields(syncFailureResult<SyncWireItem>(error, index)));
    }
  }
  return { results };
}
