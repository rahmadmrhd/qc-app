import { FILE_SCHEME, MARKDOWN_MAX_LENGTH } from '@shared/files';
import { DRIVE_REF_SCHEME, extractFileRefs, mapMarkdownRefs, normalizeKey } from '@shared/items';
import type { ItemStatus, SaveItemInput } from '@shared/rpc';
import type { SyncEntryResult, SyncWireItem } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { writeAudit } from '@worker/core/audit';
import { batchGuarded } from '@worker/core/cas';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { isAppError } from '@worker/core/errors';
import { listBrands } from '@worker/modules/brand/repo';
import type { ItemRecord, ItemRow } from '@worker/modules/item/repo';
import { findItem, ITEM_COLUMNS, toItem } from '@worker/modules/item/repo';
import {
  itemLabel,
  itemSnapshot,
  itemSyncSignature,
  planItemWrite,
} from '@worker/modules/item/service';
import { isStaleWrite, syncFailureResult } from './conflict';
import type { DriveProbe } from './files';
import { commitDriveFilesStmts, planDriveFiles, probeDriveIds } from './files';
import type { SyncItemInput } from './items-wire';
import { checkSyncItem, driveIdsOf, driveImageIds, WIRE_FIELD_NAMES } from './items-wire';
import { paginateByRev, validateSyncPull } from './pull';
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
  return new Map((await listBrands(env)).map((brand) => [brand.id, brand.name]));
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

export async function pullItems(
  env: Env,
  raw: unknown,
): Promise<{ items: SyncWireItem[]; nextRev: number; hasMore: boolean }> {
  const input = validateSyncPull(raw, SYNC_ITEM_INCLUDABLE);
  // Halaman berindeks `items_sync_rev` (hanya baris > sinceRev, urut naik, limit+1 untuk hasMore).
  const rows = await env.DB.prepare(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE sync_rev > ? ORDER BY sync_rev ASC LIMIT ?`,
  )
    .bind(input.sinceRev, input.limit + 1)
    .all<ItemRow>();
  const { page, nextRev, hasMore } = paginateByRev(
    rows.results.map(toItem),
    input.sinceRev,
    input.limit,
  );
  const [names, driveByFile] = await Promise.all([
    brandNameMap(env),
    driveIdsByFile(env, page, input.include),
  ]);
  return {
    items: page.map((item) => toWireItem(item, names, driveByFile, input.include)),
    nextRev,
    hasMore,
  };
}

type Match =
  | { kind: 'none' }
  | { kind: 'found'; existing: ItemRecord }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'conflict'; existing: ItemRecord; fields: Record<string, string> };

async function findByExternalId(env: Env, externalId: string): Promise<ItemRecord | null> {
  const row = await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE external_id = ?`)
    .bind(externalId)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

async function findByKey(env: Env, key: string): Promise<ItemRecord | null> {
  const row = await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE key = ?`)
    .bind(key)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

/** Pencocokan: uid -> id MySQL -> merk+tipe ternormalisasi (kontrak 3.3), lewat kueri berindeks. */
async function matchSyncItem(env: Env, entry: SyncItemInput): Promise<Match> {
  const byUid = entry.uid === undefined ? undefined : await findItem(env, entry.uid);
  if (entry.uid !== undefined && !byUid) {
    return { kind: 'invalid', fields: { uid: 'Item tidak ditemukan' } };
  }
  const byId = entry.id === undefined ? undefined : await findByExternalId(env, entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return {
      kind: 'conflict',
      existing: byUid,
      fields: { id: 'uid dan id mengarah ke item berbeda' },
    };
  }
  let existing = byUid ?? byId ?? undefined;
  if (!existing && entry.merk !== undefined && entry.tipe !== undefined) {
    const key = `${normalizeKey(entry.merk)} ${normalizeKey(entry.tipe)}`.trim();
    existing = (await findByKey(env, key)) ?? undefined;
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

async function upsertSyncItem(
  env: Env,
  entry: SyncItemInput,
  index: number,
  overwrite: boolean,
  probes: ReadonlyMap<string, DriveProbe | null>,
): Promise<SyncEntryResult<SyncWireItem>> {
  const names = await brandNameMap(env);
  const matched = await matchSyncItem(env, entry);
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
  });
  await batchGuarded(
    env.DB,
    plan.statements,
    { 'items.key': { field: 'model', message: 'Merk dan tipe sudah dipakai item lain' } },
    'Item diubah pihak lain; ulangi permintaan',
  );
  const written = await findItem(env, plan.record.id);
  return {
    index,
    status: existing ? 'updated' : 'created',
    uid: plan.record.id,
    rev: written?.syncRev ?? plan.record.syncRev,
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
  const results: Array<SyncEntryResult<SyncWireItem>> = [];
  for (const [index, check] of checks.entries()) {
    if (!check.ok) {
      results.push({ index, status: 'invalid', fields: check.fields });
      continue;
    }
    try {
      results.push(await upsertSyncItem(env, check.value, index, envelope.overwrite, probes));
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
