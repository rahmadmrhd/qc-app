import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { listFiles_ } from '@gas/modules/files/repo';
import type { ItemRecord } from '@gas/modules/item/repo';
import { listItems_, updateItem_ } from '@gas/modules/item/repo';
import {
  brandNameMap_,
  itemLabel_,
  itemSnapshot_,
  itemSyncSignature_,
  toItemView_,
  writeItem_,
} from '@gas/modules/item/service';
import { FILE_SCHEME, MARKDOWN_MAX_LENGTH } from '@shared/files';
import {
  DRIVE_REF_SCHEME,
  extractImageTargets,
  ITEM_LIMITS,
  isRefIdChar,
  mapMarkdownRefs,
  normalizeKey,
  normalizeNewlines,
} from '@shared/items';
import type { ItemStatus, SaveItemInput } from '@shared/rpc';
import type { SyncEntryResult, SyncWireItem, SyncWireSticker } from '@shared/sync';
import { SYNC_ACTOR, SYNC_LIMITS } from '@shared/sync';
import { isStaleWrite_, syncFailureResult_ } from './conflict';
import type { DriveProbe } from './files';
import { commitDriveFiles_, planDriveFiles_, probeDriveIds_ } from './files';
import { paginateByRev_, validateSyncPull_ } from './pull';
import type { SyncPushEnvelope, WireCheck } from './wire';
import {
  asSyncObject_,
  readSyncBaseRev_,
  readSyncBool_,
  readSyncId_,
  rejectUnknownSyncFields_,
} from './wire';

/** Field berat yang hanya dikirim bila diminta lewat `include`. */
export const SYNC_ITEM_INCLUDABLE = ['detail', 'stickers', 'accessories'] as const;

export function toWireItem_(
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

export function driveIdsByFile_(): Map<string, string> {
  return new Map(listFiles_().map((file) => [file.id, file.driveId]));
}

export function pullItems_(raw: unknown): {
  items: SyncWireItem[];
  nextRev: number;
  hasMore: boolean;
} {
  const input = validateSyncPull_(raw, SYNC_ITEM_INCLUDABLE);
  const { page, nextRev, hasMore } = paginateByRev_(listItems_(), input.sinceRev, input.limit);
  const names = brandNameMap_();
  const driveByFile = driveIdsByFile_();
  return {
    items: page.map((item) => toWireItem_(item, names, driveByFile, input.include)),
    nextRev,
    hasMore,
  };
}

export interface SyncItemInput {
  uid?: string;
  id?: string;
  merk?: string;
  tipe?: string;
  isCountryLock?: boolean;
  images?: string[];
  detail?: string;
  stickers?: SyncWireSticker[];
  accessories?: Array<{ name: string; qty: number }>;
  active?: boolean;
  baseRev?: number;
}

// Fungsi, bukan konstanta: SYNC_ACTOR berasal dari file lain dan belum ada saat file ini dimuat di GAS.
function syncItemActor_() {
  return { email: SYNC_ACTOR };
}
/** Nama field internal → nama field pada kabel, agar pesan galat sesuai kontrak. */
const WIRE_FIELD_NAMES: Record<string, string> = {
  brand: 'merk',
  model: 'tipe',
  attachments: 'images',
};

function checkWireText_(
  source: Record<string, unknown>,
  key: 'merk' | 'tipe',
  max: number,
  fields: Record<string, string>,
): string | undefined {
  if (source[key] === undefined) return undefined;
  const text = typeof source[key] === 'string' ? (source[key] as string).trim() : '';
  if (text === '') fields[key] = 'Wajib diisi';
  else if (text.length > max) fields[key] = `Maksimal ${max} karakter`;
  else if (normalizeKey(text) === '') fields[key] = 'Harus memuat huruf atau angka';
  else return text;
  return undefined;
}

/** "drive:<id>" utuh; hanya judul Markdown ("..." atau '...') boleh mengikuti id. */
function isWholeDriveTarget_(target: string): boolean {
  if (!target.startsWith(DRIVE_REF_SCHEME)) return false;
  let end = DRIVE_REF_SCHEME.length;
  while (end < target.length && isRefIdChar(target.charAt(end))) end++;
  if (end === DRIVE_REF_SCHEME.length) return false;
  const rest = target.slice(end).trim();
  return rest === '' || rest.startsWith('"') || rest.startsWith("'");
}

/**
 * Markdown tanpa gambar `![alt](drive:<id>)` yang utuh. Sisa yang masih memuat "![" berarti ada gambar
 * dalam bentuk lain (gaya referensi, bersarang, tidak tertutup) yang tidak boleh lolos dari pemeriksaan tujuan.
 */
function withoutWireImages_(detail: string): string {
  let out = '';
  let from = 0;
  while (from < detail.length) {
    const open = detail.indexOf('![', from);
    if (open < 0) break;
    out += detail.slice(from, open);
    let altEnd = open + 2;
    while (
      altEnd < detail.length &&
      detail.charAt(altEnd) !== ']' &&
      detail.charAt(altEnd) !== '[' &&
      detail.charAt(altEnd) !== '\n'
    ) {
      altEnd++;
    }
    if (detail.charAt(altEnd) === ']' && detail.charAt(altEnd + 1) === '(') {
      let end = altEnd + 2;
      while (end < detail.length && detail.charAt(end) !== ')' && detail.charAt(end) !== '\n')
        end++;
      if (detail.charAt(end) === ')' && isWholeDriveTarget_(detail.slice(altEnd + 2, end).trim())) {
        from = end + 1;
        continue;
      }
    }
    out += '![';
    from = open + 2;
  }
  return out + detail.slice(from);
}

/** Id Drive dari target gambar `![alt](drive:<id>)` saja; "drive:" di teks atau tautan biasa tidak dihitung. */
function driveImageIds_(detail: string): string[] {
  const ids: string[] = [];
  for (const target of extractImageTargets(detail)) {
    let end = DRIVE_REF_SCHEME.length;
    while (end < target.length && isRefIdChar(target.charAt(end))) end++;
    const id = target.slice(DRIVE_REF_SCHEME.length, end);
    if (target.startsWith(DRIVE_REF_SCHEME) && id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function checkWireDetail_(value: unknown, fields: Record<string, string>): string | undefined {
  if (typeof value !== 'string') {
    fields.detail = 'Harus berupa teks';
    return undefined;
  }
  const detail = normalizeNewlines(value);
  if (detail.length > MARKDOWN_MAX_LENGTH) {
    fields.detail = `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`;
    return undefined;
  }
  if (detail.includes('qcfile:')) {
    fields.detail = 'Rujukan qcfile: tidak diterima; pakai drive:<id>';
    return undefined;
  }
  for (const target of extractImageTargets(detail)) {
    if (!isWholeDriveTarget_(target)) {
      fields.detail = 'Gambar di Markdown hanya boleh ![alt](drive:<id>)';
      return undefined;
    }
  }
  if (withoutWireImages_(detail).includes('![')) {
    fields.detail = 'Gambar di Markdown hanya boleh ![alt](drive:<id>)';
    return undefined;
  }
  return detail;
}

function checkWireImages_(value: unknown, fields: Record<string, string>): string[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.attachments) {
    fields.images = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.attachments} gambar`
      : 'Harus berupa daftar id Drive';
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      fields.images = 'Harus berupa daftar id Drive';
      return undefined;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function checkWireStickers_(
  value: unknown,
  fields: Record<string, string>,
): SyncWireSticker[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.stickers) {
    fields.stickers = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.stickers} stiker`
      : 'Harus berupa daftar stiker';
    return undefined;
  }
  const out: SyncWireSticker[] = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Stiker ${i + 1}`;
    const entry = asSyncObject_(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.stickerName) {
      fields.stickers = `${label}: nama wajib 1–${ITEM_LIMITS.stickerName} karakter`;
      return undefined;
    }
    const note = entry.note === undefined || entry.note === null ? '' : entry.note;
    if (typeof note !== 'string' || note.trim().length > ITEM_LIMITS.stickerNote) {
      fields.stickers = `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`;
      return undefined;
    }
    const image =
      entry.image === undefined || entry.image === null || entry.image === '' ? null : entry.image;
    if (image !== null && (typeof image !== 'string' || image.trim().length > 100)) {
      fields.stickers = `${label}: gambar harus id Drive atau null`;
      return undefined;
    }
    out.push({ name, note: note.trim(), image: image === null ? null : (image as string).trim() });
  }
  return out;
}

function checkWireAccessories_(
  value: unknown,
  fields: Record<string, string>,
): Array<{ name: string; qty: number }> | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.accessories) {
    fields.accessories = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.accessories} kelengkapan`
      : 'Harus berupa daftar kelengkapan';
    return undefined;
  }
  const out: Array<{ name: string; qty: number }> = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Kelengkapan ${i + 1}`;
    const entry = asSyncObject_(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.accessoryName) {
      fields.accessories = `${label}: nama wajib 1–${ITEM_LIMITS.accessoryName} karakter`;
      return undefined;
    }
    const qty = entry.qty;
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > ITEM_LIMITS.accessoryQty
    ) {
      fields.accessories = `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`;
      return undefined;
    }
    out.push({ name, qty });
  }
  return out;
}

const SYNC_ITEM_ENTRY_FIELDS = [
  'uid',
  'id',
  'merk',
  'tipe',
  'isCountryLock',
  'images',
  'detail',
  'stickers',
  'accessories',
  'active',
  'baseRev',
] as const;

export function checkSyncItem_(raw: unknown): WireCheck<SyncItemInput> {
  const source = asSyncObject_(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncItemInput = {};
  rejectUnknownSyncFields_(source, SYNC_ITEM_ENTRY_FIELDS, fields);
  const uid = readSyncId_(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId_(source, 'id', fields);
  if (id !== undefined) value.id = id;
  const merk = checkWireText_(source, 'merk', ITEM_LIMITS.brand, fields);
  if (merk !== undefined) value.merk = merk;
  const tipe = checkWireText_(source, 'tipe', ITEM_LIMITS.model, fields);
  if (tipe !== undefined) value.tipe = tipe;
  const lock = readSyncBool_(source, 'isCountryLock', fields);
  if (lock !== undefined) value.isCountryLock = lock;
  if (source.images !== undefined) {
    const images = checkWireImages_(source.images, fields);
    if (images !== undefined) value.images = images;
  }
  if (source.detail !== undefined) {
    const detail = checkWireDetail_(source.detail, fields);
    if (detail !== undefined) value.detail = detail;
  }
  if (source.stickers !== undefined) {
    const stickers = checkWireStickers_(source.stickers, fields);
    if (stickers !== undefined) value.stickers = stickers;
  }
  if (source.accessories !== undefined) {
    const accessories = checkWireAccessories_(source.accessories, fields);
    if (accessories !== undefined) value.accessories = accessories;
  }
  const active = readSyncBool_(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev_(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  // Sel Sheets maks. 50.000 karakter: tolak JSON besar sebelum menulis (sama dengan validator form web).
  for (const key of ['stickers', 'accessories', 'images'] as const) {
    const list = value[key];
    if (list !== undefined && JSON.stringify(list).length > ITEM_LIMITS.jsonCell) {
      fields[key] = 'Data terlalu besar';
    }
  }
  if (
    Object.keys(fields).length === 0 &&
    driveIdsOf_(value).length > SYNC_LIMITS.driveRefsPerEntry
  ) {
    fields.detail = `Maksimal ${SYNC_LIMITS.driveRefsPerEntry} gambar berbeda per item`;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** Semua id Drive yang dirujuk entri: galeri, contoh stiker, dan gambar di Markdown. */
export function driveIdsOf_(entry: SyncItemInput): string[] {
  const ids = [...(entry.images ?? [])];
  for (const sticker of entry.stickers ?? []) {
    if (sticker.image !== null) ids.push(sticker.image);
  }
  ids.push(...driveImageIds_(entry.detail ?? ''));
  return [...new Set(ids)];
}

type Match =
  | { kind: 'none' }
  | { kind: 'found'; existing: ItemRecord }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'conflict'; existing: ItemRecord; fields: Record<string, string> };

/** Pencocokan: uid → id MySQL → merk+tipe ternormalisasi (kontrak 3.3). */
function matchSyncItem_(entry: SyncItemInput, items: readonly ItemRecord[]): Match {
  const byUid = entry.uid === undefined ? undefined : items.find((item) => item.id === entry.uid);
  if (entry.uid !== undefined && !byUid)
    return { kind: 'invalid', fields: { uid: 'Item tidak ditemukan' } };
  const byId =
    entry.id === undefined ? undefined : items.find((item) => item.externalId === entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return {
      kind: 'conflict',
      existing: byUid,
      fields: { id: 'uid dan id mengarah ke item berbeda' },
    };
  }
  let existing = byUid ?? byId;
  if (!existing && entry.merk !== undefined && entry.tipe !== undefined) {
    const key = `${normalizeKey(entry.merk)} ${normalizeKey(entry.tipe)}`.trim();
    existing = items.find((item) => item.key === key);
  }
  if (!existing) return { kind: 'none' };
  if (entry.id !== undefined && existing.externalId !== '' && existing.externalId !== entry.id) {
    return { kind: 'conflict', existing, fields: { id: 'Item sudah terpetakan ke id MySQL lain' } };
  }
  return { kind: 'found', existing };
}

function itemConflict_(
  index: number,
  existing: ItemRecord,
  proposed: Partial<ReturnType<typeof toItemView_>>,
  fields?: Record<string, string>,
): SyncEntryResult<SyncWireItem> {
  const names = brandNameMap_();
  const before = toItemView_(existing, names);
  appendAudit_({
    ts: nowIso_(),
    actor: SYNC_ACTOR,
    action: 'item.sync.conflict',
    target: itemLabel_(before),
    before: itemSnapshot_(before),
    after: itemSnapshot_({ ...before, ...proposed }),
  });
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireItem_(existing, names, driveIdsByFile_(), SYNC_ITEM_INCLUDABLE),
    ...(fields ? { fields } : {}),
  };
}

/** Di dalam lock. */
function upsertSyncItem_(
  entry: SyncItemInput,
  index: number,
  overwrite: boolean,
  probes: ReadonlyMap<string, DriveProbe | null>,
): SyncEntryResult<SyncWireItem> {
  const items = listItems_();
  const names = brandNameMap_();
  const matched = matchSyncItem_(entry, items);
  if (matched.kind === 'invalid') return { index, status: 'invalid', fields: matched.fields };
  if (matched.kind === 'conflict')
    return itemConflict_(index, matched.existing, {}, matched.fields);
  const existing = matched.kind === 'found' ? matched.existing : undefined;

  if (!existing) {
    const required: Record<string, string> = {};
    if (entry.merk === undefined) required.merk = 'Wajib diisi untuk item baru';
    if (entry.tipe === undefined) required.tipe = 'Wajib diisi untuk item baru';
    if (entry.isCountryLock === undefined) required.isCountryLock = 'Wajib diisi untuk item baru';
    if (Object.keys(required).length > 0) return { index, status: 'invalid', fields: required };
  }

  const ownerId = existing?.id ?? platform_().uuid();
  const { map, missing, pending } = planDriveFiles_(driveIdsOf_(entry), probes, ownerId);
  if (missing.length > 0) {
    const bad = new Set(missing);
    const fields: Record<string, string> = {};
    const first = (ids: readonly string[]) => ids.find((id) => bad.has(id));
    const badImage = first(entry.images ?? []);
    if (badImage !== undefined) fields.images = `Berkas ${badImage} tidak ada di folder aplikasi`;
    const badSticker = first(
      (entry.stickers ?? []).flatMap((sticker) => (sticker.image === null ? [] : [sticker.image])),
    );
    if (badSticker !== undefined)
      fields.stickers = `Berkas ${badSticker} tidak ada di folder aplikasi`;
    const badMarkdown = first(driveImageIds_(entry.detail ?? ''));
    if (badMarkdown !== undefined)
      fields.detail = `Berkas ${badMarkdown} tidak ada di folder aplikasi`;
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
    const currentSignature = itemSyncSignature_({
      ...existing,
      brandId: normalizeKey(names.get(existing.brandId) ?? ''),
    });
    const wantedSignature = itemSyncSignature_({
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
        updateItem_({ ...existing, externalId: entry.id as string });
        return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
      }
      return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
    }
    if (isStaleWrite_(entry.baseRev, existing.syncRev, overwrite)) {
      return itemConflict_(index, existing, {
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
  commitDriveFiles_(pending);
  const record = writeItem_(merged, {
    id: ownerId,
    existing,
    actor: syncItemActor_(),
    externalId: entry.id,
    status,
  });
  return { index, status: existing ? 'updated' : 'created', uid: record.id, rev: record.syncRev };
}

/** Pesan galat penulisan memakai nama field internal; ubah ke nama pada kabel. */
function toWireFields_<T>(result: SyncEntryResult<T>): SyncEntryResult<T> {
  if (!result.fields) return result;
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.fields))
    fields[WIRE_FIELD_NAMES[key] ?? key] = message;
  return { ...result, fields };
}

export function pushItems_(envelope: SyncPushEnvelope): {
  results: Array<SyncEntryResult<SyncWireItem>>;
} {
  const checks = envelope.entries.map((raw) => checkSyncItem_(raw));
  // I/O Drive di luar lock: info untuk semua id yang belum tercatat, sekali untuk seluruh permintaan.
  const probes = probeDriveIds_(
    checks.flatMap((check) => (check.ok ? driveIdsOf_(check.value) : [])),
  );
  const results = checks.map((check, index): SyncEntryResult<SyncWireItem> => {
    if (!check.ok) return { index, status: 'invalid', fields: check.fields };
    try {
      return platform_().withLock(() =>
        upsertSyncItem_(check.value, index, envelope.overwrite, probes),
      );
    } catch (error) {
      return toWireFields_(syncFailureResult_<SyncWireItem>(error, index));
    }
  });
  return { results };
}
