import { encodeAuditCursor } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { assertAccessRecordReadable } from '@server/modules/access/service';
import { parseAuditCursor } from '@server/modules/access/validate';
import { assertBrandReadable } from '@server/modules/brand/service';
import { assertCustomerReadable } from '@server/modules/customer/service';
import { assertHandoverReadable } from '@server/modules/handover/service';
import { assertItemReadable } from '@server/modules/item/service';
import { readablePostel } from '@server/modules/postel/service';
import { readableQrDesign, readableQrPreset } from '@server/modules/qrcode/service';
import { assertStickerReadable, assertStickerTypeReadable } from '@server/modules/sticker/service';
import { type ActivityKind, auditTargetKind } from '@shared/audit';
import type { ActivityEntryDto, ActivityPageDto, ListActivityInput } from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import { ACTIVITY_DEFAULT_LIMIT } from './validate';

interface ActivityRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  before: string;
  after: string;
}

/**
 * Izin modul tingkat rute `get` tiap model (alternatif; cukup satu). Pelanggaran = `FORBIDDEN`, sama dengan rute
 * `get`-nya. Handover berlokasi: izinnya dinilai di `assertHandoverReadable` (tak ada lokasi terbaca = `NOT_FOUND`).
 */
type Alternatives = readonly (readonly [ModuleKey, Level])[];

const ITEM_VIEW: Alternatives = [['item', 'view']];
const CATALOG_READ: Alternatives = [
  ['sticker', 'view'],
  ['item', 'edit'],
];
const STICKER_VIEW: Alternatives = [['sticker', 'view']];
const QR_VIEW: Alternatives = [['qrcode', 'view']];
const ACCESS_VIEW: Alternatives = [['access', 'view']];

function requireModule(user: UserContext, alternatives: Alternatives): void {
  if (!alternatives.some(([module, level]) => hasLevel(user.permissions[module], level))) {
    throw appError('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
  }
}

type Gate = (env: Env, user: UserContext, id: string) => Promise<void>;

/** Gerbang baca per `kind`: izin modul rute `get` model itu lalu pemuat rekaman yang sama (record tak terbaca = NOT_FOUND). */
const GATES: Record<ActivityKind, Gate> = {
  item: async (env, user, id) => {
    requireModule(user, ITEM_VIEW);
    await assertItemReadable(env, id, user);
  },
  brand: async (env, user, id) => {
    requireModule(user, ITEM_VIEW);
    await assertBrandReadable(env, id, user);
  },
  customer: async (env, user, id) => {
    requireModule(user, ITEM_VIEW);
    await assertCustomerReadable(env, id, user);
  },
  sticker: async (env, user, id) => {
    requireModule(user, CATALOG_READ);
    await assertStickerReadable(env, id, user);
  },
  stickerType: async (env, user, id) => {
    requireModule(user, CATALOG_READ);
    await assertStickerTypeReadable(env, id, user);
  },
  qrDesign: async (env, user, id) => {
    requireModule(user, QR_VIEW);
    await readableQrDesign(env, id, user);
  },
  qrPreset: async (env, user, id) => {
    requireModule(user, QR_VIEW);
    await readableQrPreset(env, id, user);
  },
  postel: async (env, user, id) => {
    requireModule(user, STICKER_VIEW);
    await readablePostel(env, user, id);
  },
  user: async (env, user, id) => {
    requireModule(user, ACCESS_VIEW);
    await assertAccessRecordReadable(env, 'users', id, user);
  },
  role: async (env, user, id) => {
    requireModule(user, ACCESS_VIEW);
    await assertAccessRecordReadable(env, 'roles', id, user);
  },
  location: async (env, user, id) => {
    requireModule(user, ACCESS_VIEW);
    await assertAccessRecordReadable(env, 'locations', id, user);
  },
  businessUnit: async (env, user, id) => {
    requireModule(user, ACCESS_VIEW);
    await assertAccessRecordReadable(env, 'businessUnits', id, user);
  },
  handover: async (env, user, id) => {
    await assertHandoverReadable(env, id, user);
  },
};

function parseSnapshot(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * NAMA field yang berubah antara snapshot sebelum dan sesudah (nilai tak pernah keluar dari fungsi ini). Satu sisi
 * kosong (create/delete) = semua kunci sisi lain; JSON null/rusak di kedua sisi = tak diketahui (`undefined`).
 * Urutan = urutan kunci snapshot (sesudah dahulu, lalu yang hanya ada di sebelum).
 */
export function changedFieldsOf(beforeText: string, afterText: string): string[] | undefined {
  const before = parseSnapshot(beforeText);
  const after = parseSnapshot(afterText);
  if (!before && !after) return undefined;
  const keys = [...new Set([...Object.keys(after ?? {}), ...Object.keys(before ?? {})])];
  const changed = keys.filter(
    (key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null),
  );
  return changed.length > 0 ? changed : undefined;
}

function toEntry(row: ActivityRow): ActivityEntryDto {
  const changedFields = changedFieldsOf(row.before, row.after);
  return {
    id: String(row.id),
    ts: row.ts,
    actor: row.actor,
    action: row.action,
    ...(changedFields ? { changedFields } : {}),
  };
}

/**
 * Riwayat aktivitas satu record, terbaru dahulu, berkursor `(ts, id)` lewat indeks `audit_log_target_id_ts`. Hanya
 * entri berjenis `kind` yang ikut (`auditTargetKind(action) === kind`); entri tanpa `target_id` (sebelum 2026-11-20)
 * tidak punya riwayat. DTO tidak memuat nilai sebelum/sesudah.
 */
export async function listActivity(
  env: Env,
  user: UserContext,
  input: ListActivityInput,
): Promise<ActivityPageDto> {
  await GATES[input.kind](env, user, input.id);
  const limit = input.limit ?? ACTIVITY_DEFAULT_LIMIT;
  let cursor = input.cursor ? parseAuditCursor(input.cursor) : null;
  const matched: ActivityRow[] = [];
  // Entri ber-`target_id` yang sama tetapi berjenis lain (mis. id bertabrakan lintas model) dilewati; satu putaran
  // hampir selalu cukup, putaran berikutnya hanya bila ada baris yang bukan `kind` ini.
  for (;;) {
    const binds: unknown[] = [input.id];
    let cursorSql = '';
    if (cursor) {
      cursorSql = ' AND (ts < ? OR (ts = ? AND id < ?))';
      binds.push(cursor.ts, cursor.ts, cursor.id);
    }
    const result = await env.DB.prepare(
      `SELECT id, ts, actor, action, \`before\`, \`after\` FROM audit_log WHERE target_id = ?${cursorSql} ORDER BY ts DESC, id DESC LIMIT ?`,
    )
      .bind(...binds, limit + 1)
      .all<ActivityRow>();
    for (const row of result.results) {
      if (auditTargetKind(row.action) === input.kind) matched.push(row);
    }
    const last = result.results[result.results.length - 1];
    if (matched.length > limit || result.results.length < limit + 1 || !last) break;
    cursor = { ts: last.ts, id: last.id };
  }
  const page = matched.slice(0, limit);
  const hasMore = matched.length > limit;
  const last = page[page.length - 1];
  return {
    entries: page.map(toEntry),
    nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
    hasMore,
  };
}
