// Pemilih task Serah Terima untuk SO (spek 5.5, 5.7): kandidat berjalan, tertaut, dan peringkat "menyebut Item ini".
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { findCustomersByKeys } from '@server/modules/customer/repo';
import { checklistOf, matchedChecks } from '@server/modules/handover/checklist';
import { parseChecks } from '@server/modules/handover/repo';
import type {
  ListWarehouseHandoverCandidatesInput,
  WarehouseHandoverCandidateDto,
  WarehouseHandoverCandidatesDto,
} from '@shared/contract';
import { customerKey, type HandoverStatus } from '@shared/handover';
import { classifyNoteLines, type DetectableItem, prepareItemMatchers } from '@shared/item-detect';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { assertWhBu } from './access';
import {
  loadDetectableItems,
  notePreview,
  placeholders,
  readableHandoverLocationIds,
} from './handover-shared';
import { parseCandidateCursor } from './validate-links';

interface CandidateRow {
  id: string;
  number: string;
  created_at: string;
  note: string;
  checks: string;
  board_status: string;
}

/** Peringkat status pada urutan kandidat: Baru, Sedang dikerjakan, lalu Selesai (Dibatalkan tak pernah tampil). */
const RANK = { new: 0, in_progress: 1, done: 2 } as const;
/** Batas baris tidak cocok yang dikirim per task. */
const MISMATCH_MAX = 10;
/**
 * Dengan `itemId`, task yang menyebut Item itu diprioritaskan di paling atas. Penyebutan baru diketahui setelah catatan
 * diurai, jadi satu putaran membaca sampai sebanyak ini task (urutan biasa), mengurutkannya (penyebut dulu, urutan biasa
 * dipertahankan), lalu membagi halaman dengan kursor posisi `o~<n>`. Task di luar batas ini tidak ikut diprioritaskan.
 */
const MENTION_SCAN_MAX = 400;

const COLUMNS = 'h.id, h.number, h.created_at, h.note, h.checks, h.board_status';

/**
 * Kandidat task di lokasi terbaca (opsional dipersempit `locationId`; lokasi di luar hak = kosong). Tanpa customer SEMUA
 * task di lokasi itu tampil; customer hanya menyaring. Status yang tampil: Baru, Sedang dikerjakan, Selesai (Dibatalkan dan
 * terhapus tidak). Urutan: peringkat status, lalu `created_at` terbaru, lalu id. `includeFinished` diterima demi klien lama
 * tetapi tidak berpengaruh. `linked` = task tertaut ke `orderId` yang terbaca (selalu di depan, dikeluarkan dari `items`);
 * `mentionsItem`, `matchedLines`, dan `mismatchLines` hanya penanda, bukan penyaring; dengan `itemId`, task yang menyebut Item itu diprioritaskan di paling atas (lihat
 * `MENTION_SCAN_MAX`, kursornya berbentuk posisi), selain itu urutan di atas tidak berubah.
 */
export async function handoverCandidates(
  env: Env,
  user: UserContext,
  input: ListWarehouseHandoverCandidatesInput,
): Promise<WarehouseHandoverCandidatesDto> {
  const limit = Math.min(
    input.limit ?? WAREHOUSE_LIMITS.candidatesDefault,
    WAREHOUSE_LIMITS.candidatesMax,
  );
  const readable = readableHandoverLocationIds(user);
  const locations =
    input.locationId === undefined ? readable : readable.filter((id) => id === input.locationId);

  if (input.orderId !== undefined) {
    const order = await env.DB.prepare('SELECT bu_id FROM warehouse_orders WHERE id = ?')
      .bind(input.orderId)
      .first<{ bu_id: string }>();
    if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
    assertWhBu(user, order.bu_id, 'edit');
  }
  if (locations.length === 0) return { linked: [], items: [], nextCursor: null };

  const itemId = input.itemId;
  const detectable: DetectableItem[] =
    itemId !== undefined ? await loadDetectableItems(env, user) : [];
  const matchers = prepareItemMatchers(detectable);
  const toDto = (row: CandidateRow, linked: boolean): WarehouseHandoverCandidateDto => {
    const lines =
      itemId !== undefined
        ? classifyNoteLines(row.note, itemId, detectable, matchers)
        : { matched: [], other: [] };
    const matched = matchedChecks(row.note, parseChecks(row.checks));
    return {
      id: row.id,
      number: row.number,
      createdAt: row.created_at,
      preview: notePreview(row.note),
      status: row.board_status as HandoverStatus,
      linked,
      mentionsItem: lines.matched.length > 0,
      note: row.note,
      checklist: checklistOf(row.note).map((entry) => {
        const check = matched[entry.index] ?? null;
        return {
          index: entry.index,
          text: entry.text,
          checked: check !== null,
          by: check?.by ?? '',
          at: check?.at ?? '',
        };
      }),
      matchedLines: lines.matched,
      mismatchLines: lines.other.slice(0, MISMATCH_MAX),
    };
  };

  let linked: WarehouseHandoverCandidateDto[] = [];
  if (input.orderId !== undefined) {
    const rows = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM warehouse_order_handovers w JOIN handovers h ON h.id = w.handover_id WHERE w.order_id = ? AND ${liveWhere('h')} AND h.location_id IN (${placeholders(locations.length)}) ORDER BY h.created_at DESC, h.id DESC LIMIT ${WAREHOUSE_LIMITS.handoverLinksMax}`,
    )
      .bind(input.orderId, ...locations)
      .all<CandidateRow>();
    linked = rows.results.map((row) => toDto(row, true));
  }

  let customerId = input.customerId;
  if (customerId === undefined && input.customerName !== undefined) {
    const key = customerKey(input.customerName);
    const found = (await findCustomersByKeys(env, [key])).get(key);
    if (!found) return { linked, items: [], nextCursor: null };
    customerId = found.id;
  }

  // Penyaring bersama tiap cabang (customer, pencarian, bukan yang sudah tertaut ke SO ini).
  const sharedBinds: unknown[] = [];
  let extra = '';
  if (customerId !== undefined) {
    extra += ' AND h.customer_id = ?';
    sharedBinds.push(customerId);
  }
  if (input.query !== undefined) {
    const needle = input.query.toLowerCase();
    extra +=
      ' AND (LOCATE(?, LOWER(h.number)) > 0 OR LOCATE(?, LOWER(h.customer_name)) > 0 OR LOCATE(?, LOWER(h.note)) > 0)';
    sharedBinds.push(needle, needle, needle);
  }
  if (input.orderId !== undefined) {
    extra +=
      ' AND h.id NOT IN (SELECT w.handover_id FROM warehouse_order_handovers w WHERE w.order_id = ?)';
    sharedBinds.push(input.orderId);
  }
  const byMention = itemId !== undefined;
  let offset = 0;
  let cursor: { rank: number; createdAt: string; id: string } | null = null;
  if (input.cursor !== undefined && byMention) {
    const match = /^o~(\d{1,4})$/.exec(input.cursor);
    if (!match)
      throw appError('VALIDATION', 'Kursor tidak valid', { cursor: 'Kursor tidak valid' });
    offset = Number(match[1]);
  } else if (input.cursor !== undefined) {
    cursor = parseCandidateCursor(input.cursor);
    if (!cursor) {
      throw appError('VALIDATION', 'Kursor tidak valid', { cursor: 'Kursor tidak valid' });
    }
  }
  // Satu cabang per (lokasi, status): tiap cabang membaca indeks `handovers_candidates` (lokasi, status, hapus,
  // dibuat) berurutan dan berhenti di `limit + 1`, jadi riwayat task Selesai yang panjang tidak diurutkan seluruhnya.
  // Hasil = UNION ALL lalu urut (peringkat status, dibuat terbaru, id): sama persis dengan satu kueri berurutan.
  const branches: string[] = [];
  const binds: unknown[] = [];
  const scanLimit = byMention ? MENTION_SCAN_MAX : limit + 1;
  for (const location of locations) {
    for (const status of ['new', 'in_progress', 'done'] as const) {
      const rank = RANK[status];
      if (cursor && rank < cursor.rank) continue;
      let cursorSql = '';
      const cursorBinds: unknown[] = [];
      if (cursor && rank === cursor.rank) {
        cursorSql = ' AND (h.created_at < ? OR (h.created_at = ? AND h.id < ?))';
        cursorBinds.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      branches.push(
        `(SELECT ${COLUMNS} FROM handovers h WHERE h.location_id = ? AND h.board_status = '${status}' AND ${liveWhere('h')}${extra}${cursorSql} ORDER BY h.created_at DESC, h.id DESC LIMIT ?)`,
      );
      binds.push(location, ...sharedBinds, ...cursorBinds, scanLimit);
    }
  }
  if (branches.length === 0) return { linked, items: [], nextCursor: null };
  const rows = await env.DB.prepare(
    `SELECT * FROM (${branches.join(' UNION ALL ')}) c ORDER BY CASE c.board_status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, c.created_at DESC, c.id DESC LIMIT ?`,
  )
    .bind(...binds, scanLimit)
    .all<CandidateRow>();
  if (byMention) {
    const all = rows.results.map((row) => toDto(row, false));
    const ordered = [
      ...all.filter((dto) => dto.mentionsItem),
      ...all.filter((dto) => !dto.mentionsItem),
    ];
    const items = ordered.slice(offset, offset + limit);
    const nextCursor = ordered.length > offset + limit ? `o~${offset + limit}` : null;
    return { linked, items, nextCursor };
  }
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const rankOf = (row: CandidateRow): number =>
    RANK[row.board_status as keyof typeof RANK] ?? RANK.done;
  const nextCursor =
    rows.results.length > limit && last ? `${rankOf(last)}~${last.created_at}~${last.id}` : null;
  const items = page.map((row) => toDto(row, false));
  return { linked, items, nextCursor };
}
