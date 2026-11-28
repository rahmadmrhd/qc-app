import { createHash } from 'node:crypto';
import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { planCustomerByName } from '@server/modules/customer/service';
import { applicableStickersOf } from '@server/modules/serial/applicable';
import { newSerialStatements } from '@server/modules/serial/new-serial';
import { activeLocationName } from '@server/modules/serial/repo';
import type {
  WarehouseSkippedRowDto,
  WarehouseSubmitHeader,
  WarehouseSubmitInput,
  WarehouseSubmitOutput,
} from '@shared/contract';
import { customerKey } from '@shared/handover';
import { wibDateIso } from '@shared/postel';
import {
  orderKey,
  WAREHOUSE_LIMITS,
  WAREHOUSE_NOTE_NOTE,
  WAREHOUSE_READY_NOTE,
  WAREHOUSE_SALE_NOTE,
  WAREHOUSE_SOURCE,
  type WarehouseDispatchStatus,
  warehouseRecordedNote,
} from '@shared/serial-warehouse';
import { caseNumberPeriod } from '@shared/serials';
import { assertWhBu, canWh, whLiveBuIds } from './access';
import {
  dispatchDoneAuditStmt,
  noteAuditTarget,
  orderAuditTarget,
  readyAuditTarget,
  saleAuditTarget,
  WAREHOUSE_AUDIT,
  type WarehouseAuditTarget,
  warehouseAuditStmt,
} from './audit';
import {
  BOX_TAKEN_MESSAGE,
  boxStatements,
  dropEmptyBoxesStatement,
  readyHeldInOtherPending,
  readyInOtherBu,
  readyInPendingReady,
  releaseStatements,
} from './boxes';
import { addOrderLinksStmts, assertLinkableHandovers } from './handover-links';
import { reserveDispatchNumber } from './number';
import {
  type DispatchRow,
  insertDispatchSerialStmt,
  isBareSale,
  isNoteDispatch,
  loadDispatchRow,
  loadDispatchRowByClientId,
  loadDispatchSerialNumbers,
  loadOrderRow,
  loadOrderRowByKey,
  type OrderRow,
  placeholders,
  serialsInOrder,
  serialsInPendingDispatches,
  serialsRecordedDone,
} from './repo';

const MAX_ATTEMPTS = 3;
const ITEM_MESSAGE = 'Item tidak ditemukan atau tidak bisa dipakai';
const ORDER_TAKEN_MESSAGE = 'No SO sudah dipakai';
const RACE_MESSAGE = 'Data berubah saat disimpan. Coba lagi';

/** Sidik kolom tetap header (kanonis; tanpa `orderId`): memastikan tiap potongan membawa header yang sama. */
export function headerHash(header: WarehouseSubmitHeader): string {
  const canonical = JSON.stringify({
    // `mode` hanya ikut pada ready/note: sidik pengeluaran SO yang sedang berjalan sebelum fitur ini tetap sama.
    ...(header.mode === 'ready' || header.mode === 'note'
      ? { mode: header.mode, boxStart: header.boxStart, boxSize: header.boxSize }
      : {}),
    dispatchedOn: header.dispatchedOn,
    orderKey: orderKey(header.orderNumber),
    buId: header.buId,
    customerKey: customerKey(header.customerName),
    itemId: header.itemId,
    note: header.note,
    handoverIds: [...header.handoverIds].sort(),
    total: header.total,
    chunkSize: header.chunkSize,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

interface SerialCheckRow {
  id: string;
  serial: string;
  item_id: string;
  status: string;
  custody: string;
}

const fieldError = (field: string, message: string) =>
  appError('VALIDATION', message, { [field]: message });

function mapFinalError(error: unknown): unknown {
  if (isGuardFailure(error)) return appError('CONFLICT', RACE_MESSAGE);
  if (error instanceof DbError && error.kind === 'duplicate') {
    if (error.key?.includes('warehouse_ready_boxes_open')) {
      return fieldError('boxStart', BOX_TAKEN_MESSAGE);
    }
    return appError('CONFLICT', RACE_MESSAGE);
  }
  // Jumlah/potongan di luar rentang kolom INT (spek: tanpa batas buatan): galat validasi yang rapi, bukan 500.
  // 1264 = nilai di luar rentang kolom (mode ketat); 1690 non-penjaga = luapan ekspresi.
  if (error instanceof DbError && (error.errno === 1264 || error.kind === 'out_of_range')) {
    return fieldError('total', 'Jumlah serial terlalu besar');
  }
  return error;
}

/**
 * Satu potongan pengeluaran Keluar Gudang (maks. 200 serial; satu `batch()` per potongan, atomik). Idempoten per
 * `clientId` pengeluaran + nomor potongan: kiriman ulang mengembalikan keadaan tersimpan tanpa menulis ulang. Tabrakan
 * serentak (SO baru yang sama, serial yang dicatat QC di sela, potongan ganda) mengulang seluruh evaluasi (maks. 3 kali).
 */
export async function submitWarehouseChunk(
  env: Env,
  user: UserContext,
  input: WarehouseSubmitInput,
): Promise<WarehouseSubmitOutput> {
  for (let index = 0; ; index += 1) {
    try {
      return await submitOnce(env, user, input);
    } catch (error) {
      const retryable =
        isGuardFailure(error) || (error instanceof DbError && error.kind === 'duplicate');
      if (retryable && index + 1 < MAX_ATTEMPTS) continue;
      throw mapFinalError(error);
    }
  }
}

async function activeBu(env: Env, buId: string): Promise<boolean> {
  const hit = await env.DB.prepare(
    `SELECT 1 AS ok FROM business_units WHERE ${liveWhere()} AND status = 'active' AND id = ?`,
  )
    .bind(buId)
    .first<{ ok: number }>();
  return hit !== null;
}

async function itemUsable(env: Env, itemId: string, buId: string): Promise<boolean> {
  const hit = await env.DB.prepare(
    `SELECT 1 AS ok FROM items i WHERE ${liveWhere('i')} AND i.id = ? AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units l WHERE l.item_id = i.id AND l.bu_id = ?)`,
  )
    .bind(itemId, buId)
    .first<{ ok: number }>();
  return hit !== null;
}

/** Alasan baris dilewati: generik per kategori (tanpa nama BU/lokasi/catatan serial milik BU lain). */
const SKIP_REASONS = {
  notFound: 'Serial tidak ditemukan',
  otherType: 'Tipe berbeda',
  notGood: 'Bukan berstatus Lolos di posisi QC',
  inOrder: 'Sudah ada di SO ini',
  inNote: 'Sudah ada di catatan ini',
  futureTestDate: 'Tanggal uji tidak boleh di masa depan',
  noLocation: 'Lokasi tidak ditemukan',
  alreadyRecorded: 'Sudah tercatat WH',
  inOtherPending: 'Sudah ada di pengeluaran lain yang belum selesai',
} as const;

function parseSkipped(json: string | undefined): WarehouseSkippedRowDto[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as WarehouseSkippedRowDto[]) : [];
  } catch {
    return [];
  }
}

async function skippedTotalOf(env: Env, dispatchId: string): Promise<WarehouseSkippedRowDto[]> {
  const rows = await env.DB.prepare(
    'SELECT skipped_json FROM warehouse_dispatch_chunks WHERE dispatch_id = ? ORDER BY chunk_index',
  )
    .bind(dispatchId)
    .all<{ skipped_json: string }>();
  return rows.results.flatMap((row) => parseSkipped(row.skipped_json));
}

async function outputOf(
  env: Env,
  dispatch: DispatchRow,
  orderNumber: string | undefined,
  created: number,
  skipped: WarehouseSkippedRowDto[],
): Promise<WarehouseSubmitOutput> {
  const status = dispatch.status.trim() as WarehouseDispatchStatus;
  return {
    dispatchId: dispatch.id.trim(),
    ...(dispatch.kind.trim() === 'ready' || isNoteDispatch(dispatch) || isBareSale(dispatch)
      ? {}
      : { orderId: dispatch.order_id.trim(), orderNumber: orderNumber ?? '' }),
    status,
    chunksReceived: Number(dispatch.chunks_received),
    chunkCount: Number(dispatch.chunk_count),
    created,
    skipped,
    ...(status === 'done'
      ? {
          serials: await loadDispatchSerialNumbers(env.DB, dispatch.id.trim()),
          skippedTotal: await skippedTotalOf(env, dispatch.id.trim()),
        }
      : {}),
  };
}

/** Pesan penolakan bila tak ada serial yang dapat dicatat: ringkasan alasan generik (tanpa data lintas BU). */
function noRecordableMessage(skipped: readonly WarehouseSkippedRowDto[]): string {
  const counts = new Map<string, number>();
  for (const row of skipped) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  const summary = [...counts].map(([reason, count]) => `${reason} (${count})`).join('; ');
  return `Tidak ada serial yang dapat dicatat${summary === '' ? '' : `. Dilewati: ${summary}`}`;
}

async function countDispatchSerials(env: Env, dispatchId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM warehouse_dispatch_serials WHERE dispatch_id = ?',
  )
    .bind(dispatchId)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

/**
 * Membuang pengeluaran bertahap yang pada potongan terakhir ternyata tanpa serial sama sekali: baris pengeluaran,
 * potongan, kardus ready yang kosong, tautan task yang ditambahkan pengeluaran ini, dan SO yang dibuat khusus olehnya
 * (bila tak punya pengeluaran atau tautan lain). Satu `batch()` dijaga CAS (pengeluaran masih `pending`, potongan ini
 * memang yang terakhir, dan belum ada serial). Nomor riwayat yang sudah terpakai tidak dikembalikan (penghitung hanya naik).
 * Customer baru yang dibuat bersama SO tetap ada (master data).
 */
async function discardEmptyDispatch(
  env: Env,
  dispatch: DispatchRow,
  order: OrderRow | null,
): Promise<void> {
  const id = dispatch.id.trim();
  const statements: DbStatement[] = [
    env.DB.prepare(
      `UPDATE warehouse_dispatches SET id = CASE WHEN status = 'pending' AND chunks_received + 1 = chunk_count AND NOT EXISTS (SELECT 1 FROM warehouse_dispatch_serials WHERE dispatch_id = warehouse_dispatches.id) THEN id ELSE ${CAS_FAIL_SQL} END WHERE id = ?`,
    ).bind(id),
  ];
  if (dispatch.kind.trim() === 'ready') {
    statements.push(
      env.DB.prepare('DELETE FROM warehouse_ready_boxes WHERE dispatch_id = ?').bind(id),
    );
  }
  if (order) {
    const orderId = order.id.trim();
    statements.push(
      env.DB.prepare(
        'DELETE FROM warehouse_order_handovers WHERE order_id = ? AND created_at = ? AND created_by = ?',
      ).bind(orderId, dispatch.created_at, dispatch.created_by),
    );
  }
  statements.push(
    env.DB.prepare('DELETE FROM warehouse_dispatch_chunks WHERE dispatch_id = ?').bind(id),
    env.DB.prepare('DELETE FROM warehouse_dispatches WHERE id = ?').bind(id),
  );
  if (order) {
    const orderId = order.id.trim();
    statements.push(
      env.DB.prepare(
        'DELETE FROM warehouse_orders WHERE id = ? AND created_at = ? AND created_by = ? AND NOT EXISTS (SELECT 1 FROM warehouse_dispatches WHERE order_id = warehouse_orders.id) AND NOT EXISTS (SELECT 1 FROM warehouse_order_handovers WHERE order_id = warehouse_orders.id)',
      ).bind(orderId, dispatch.created_at, dispatch.created_by),
    );
  }
  await env.DB.batch(statements);
}

async function submitOnce(
  env: Env,
  user: UserContext,
  input: WarehouseSubmitInput,
): Promise<WarehouseSubmitOutput> {
  const { header, rows } = input;
  const today = wibDateIso(nowOf(env));
  if (header.dispatchedOn > today) {
    throw fieldError('dispatchedOn', 'Tanggal keluar tidak boleh di masa depan');
  }
  const ready = header.mode === 'ready';
  // Catatan saja (2026-11-28): tanpa SO/customer/stok; `order_id` = id pengeluaran, serial yang sama boleh dicatat ulang.
  const noteMode = header.mode === 'note';
  // Penjualan tanpa No SO: tanpa catatan SO (`order_id` = id pengeluaran), customer opsional.
  const bare = !ready && !noteMode && header.orderNumber === '';
  const kindOf = ready ? 'ready' : noteMode ? 'note' : 'order';
  const hash = headerHash(header);
  const existing = await loadDispatchRowByClientId(env.DB, input.clientId);

  let order: OrderRow | null = null;
  // SO ditemukan lewat nomornya saja (tanpa `orderId`): pengirim mengira SO baru, jadi BU/customer berbeda = nomor terpakai.
  let foundByKey = false;
  if (existing) {
    // Milik pelaku lain dijawab generik (tak membocorkan keberadaannya).
    if (existing.created_by !== user.email)
      throw appError('CONFLICT', 'Permintaan tidak dapat diproses');
    if (existing.header_hash !== hash || existing.kind.trim() !== kindOf) {
      throw fieldError('header', 'Isi pengeluaran berubah');
    }
    if (ready) {
      // Catat ready tidak punya SO: BU ada di baris pengeluaran itu sendiri.
      assertWhBu(user, existing.bu_id.trim(), 'edit', 'Catatan ready tidak ditemukan');
    } else if (bare || noteMode) {
      assertWhBu(user, existing.bu_id.trim(), 'edit');
    } else {
      order = await loadOrderRow(env.DB, existing.order_id.trim());
      if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
      assertWhBu(user, order.bu_id.trim(), 'edit');
    }
    if (existing.status.trim() === 'cancelled') {
      throw appError('CONFLICT', 'Pengeluaran sudah dibatalkan otomatis');
    }
    const recorded = await env.DB.prepare(
      'SELECT skipped_json FROM warehouse_dispatch_chunks WHERE dispatch_id = ? AND chunk_index = ?',
    )
      .bind(existing.id, input.chunkIndex)
      .first<{ skipped_json: string }>();
    if (recorded) {
      return outputOf(env, existing, order?.number, 0, parseSkipped(recorded.skipped_json));
    }
  } else {
    if (input.chunkIndex > 0) throw fieldError('chunkIndex', 'Pengeluaran belum dimulai');
    const key = orderKey(header.orderNumber);
    if (ready || bare || noteMode) {
      // Tanpa SO: tidak ada yang dimuat.
    } else if (header.orderId !== undefined) {
      order = await loadOrderRow(env.DB, header.orderId);
      if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
      assertWhBu(user, order.bu_id.trim(), 'edit');
      if (order.key !== key) throw fieldError('orderNumber', 'No SO tidak cocok dengan catatan SO');
    } else {
      order = await loadOrderRowByKey(env.DB, key);
      foundByKey = order !== null;
      // No SO sudah dipakai di BU tanpa hak: hanya keberadaan nomornya yang terungkap, bukan BU atau customernya.
      if (order && !canWh(user, order.bu_id.trim(), 'edit')) {
        throw appError('CONFLICT', ORDER_TAKEN_MESSAGE);
      }
    }
  }

  // SO lama: BU dan customer dari SO. SO baru: BU dari header (harus BU hidup ber-`serialwh: edit`).
  const buId = order ? order.bu_id.trim() : header.buId;
  if (ready) {
    // Pencatatan BARU wajib BU hidup; lanjutan (pengeluaran sudah ada) tetap jalan walau BU dihapus di tengah kiriman
    // (hak edit pada BU pencatatan sudah diperiksa di atas), seperti SO yang sudah ada pada mode SO.
    if (!existing && !whLiveBuIds(user, 'edit').includes(buId)) {
      throw appError('NOT_FOUND', 'BU tidak ditemukan');
    }
  } else if (bare || noteMode) {
    // Pengeluaran baru wajib BU hidup ber-`serialwh: edit`; lanjutan tetap jalan (hak sudah diperiksa di atas).
    if (!existing && !whLiveBuIds(user, 'edit').includes(buId)) {
      throw appError('NOT_FOUND', 'BU tidak ditemukan');
    }
  } else if (order) {
    if (foundByKey) {
      // Kalah balapan atau salah mengira SO baru: SO pemenang beda BU atau beda customer = nomor sudah dipakai.
      if (
        header.buId !== buId ||
        customerKey(order.customer_name) !== customerKey(header.customerName)
      ) {
        throw appError('CONFLICT', ORDER_TAKEN_MESSAGE);
      }
    } else if (header.buId !== buId) {
      throw fieldError('buId', 'BU tidak sama dengan SO');
    }
  } else {
    if (!whLiveBuIds(user, 'edit').includes(buId)) {
      throw appError('NOT_FOUND', 'BU tidak ditemukan');
    }
    if (header.customerName === '') throw fieldError('customerName', 'Customer wajib diisi');
  }
  if (!existing && !ready && header.handoverIds.length > 0) {
    await assertLinkableHandovers(env, user, header.handoverIds);
    if (order) {
      // Batas per SO (bukan hanya per kiriman): tautan yang sudah ada + yang baru.
      const linked = await env.DB.prepare(
        'SELECT handover_id FROM warehouse_order_handovers WHERE order_id = ?',
      )
        .bind(order.id.trim())
        .all<{ handover_id: string }>();
      const have = new Set(linked.results.map((row) => row.handover_id));
      const added = header.handoverIds.filter((id) => !have.has(id)).length;
      if (have.size + added > WAREHOUSE_LIMITS.handoverLinksMax) {
        throw fieldError(
          'handoverIds',
          `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax} task per SO`,
        );
      }
    }
  }

  // Pra-cek baca untuk pesan per SN; penjaga CAS di dalam batch tetap yang berwenang.
  const ids = rows.flatMap((row) => (row.kind === 'existing' ? [row.serialId] : []));
  const texts = rows.flatMap((row) => (row.kind === 'new' ? [row.serial] : []));
  const found = new Map<string, SerialCheckRow>();
  const byText = new Map<string, SerialCheckRow>();
  const lookupParts: string[] = [];
  const lookupBinds: unknown[] = [];
  if (ids.length > 0) {
    lookupParts.push(`s.id IN (${placeholders(ids.length)})`);
    lookupBinds.push(...ids);
  }
  if (texts.length > 0) {
    lookupParts.push(`s.serial IN (${placeholders(texts.length)})`);
    lookupBinds.push(...texts);
  }
  if (lookupParts.length > 0) {
    const result = await env.DB.prepare(
      `SELECT s.id, s.serial, s.item_id, s.status, s.custody FROM serials s WHERE ${liveWhere('s')} AND (${lookupParts.join(' OR ')})`,
    )
      .bind(...lookupBinds)
      .all<SerialCheckRow>();
    for (const row of result.results) {
      found.set(row.id.trim(), row);
      byText.set(row.serial, row);
    }
  }
  // Baris bermasalah DILEWATI (dilaporkan di `skipped`), tidak menggagalkan potongan; galat tingkat header tetap melempar.
  const skipped: WarehouseSkippedRowDto[] = [];
  const skip = (serial: string, reason: string): void => {
    skipped.push({ serial, reason });
  };
  const ineligibleReason = (serial: SerialCheckRow): string | null => {
    if (serial.item_id.trim() !== header.itemId) return SKIP_REASONS.otherType;
    if (serial.status.trim() !== 'good' || serial.custody.trim() !== 'qc') {
      return SKIP_REASONS.notGood;
    }
    return null;
  };

  interface Plan {
    /** Indeks baris dalam potongan (menentukan `seq`). */
    index: number;
    serialId: string;
    serial: string;
    createdNew: boolean;
    fresh?: { clientId: string; locationId: string; testDate: string };
  }
  let plans: Plan[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.kind === 'existing') {
      const serial = found.get(row.serialId);
      if (!serial || serial.serial !== row.serial) {
        skip(row.serial, SKIP_REASONS.notFound);
        continue;
      }
      const reason = ineligibleReason(serial);
      if (reason !== null) {
        skip(row.serial, reason);
        continue;
      }
      plans.push({ index, serialId: serial.id.trim(), serial: serial.serial, createdNew: false });
      continue;
    }
    const already = byText.get(row.serial);
    if (already) {
      // Serial sudah dicatat (mis. oleh QC di sela draf): diperlakukan sebagai serial yang sudah ada.
      const reason = ineligibleReason(already);
      if (reason !== null) {
        skip(row.serial, reason);
        continue;
      }
      plans.push({ index, serialId: already.id.trim(), serial: already.serial, createdNew: false });
      continue;
    }
    if (row.testDate > today) {
      skip(row.serial, SKIP_REASONS.futureTestDate);
      continue;
    }
    plans.push({
      index,
      serialId: newId(),
      serial: row.serial,
      createdNew: true,
      fresh: { clientId: row.clientId, locationId: row.locationId, testDate: row.testDate },
    });
  }
  // Serial ganda dalam satu SO (atau satu pengeluaran tanpa SO yang sedang berjalan) dilewati.
  const scopeId = order
    ? order.id.trim()
    : (bare || noteMode) && existing
      ? existing.id.trim()
      : null;
  if (scopeId !== null && plans.length > 0) {
    const taken = await serialsInOrder(
      env.DB,
      scopeId,
      plans.map((plan) => plan.serialId),
    );
    plans = plans.filter((plan) => {
      if (!taken.has(plan.serialId)) return true;
      skip(plan.serial, noteMode ? SKIP_REASONS.inNote : SKIP_REASONS.inOrder);
      return false;
    });
  }

  if (ready && plans.length > 0) {
    // Ready: serial yang sudah tercatat WH (selesai, mode apa pun) atau masih ada di pengeluaran pending mana pun
    // (SO atau ready) dilewati; mencatat ready dua kali menggandakan hitungan target.
    const ids = plans.filter((plan) => !plan.createdNew).map((plan) => plan.serialId);
    const [done, pending] = await Promise.all([
      serialsRecordedDone(env.DB, ids),
      serialsInPendingDispatches(env.DB, ids),
    ]);
    plans = plans.filter((plan) => {
      if (plan.createdNew || (!done.has(plan.serialId) && !pending.has(plan.serialId))) return true;
      skip(plan.serial, SKIP_REASONS.alreadyRecorded);
      return false;
    });
  }

  if (!ready && !noteMode && plans.length > 0) {
    // Serial yang masih di stok ready dan sedang ada di Penjualan pending LAIN dilewati (spek Stok Ready §9).
    const held = await readyHeldInOtherPending(
      env,
      plans.filter((plan) => !plan.createdNew).map((plan) => plan.serialId),
      existing?.id.trim() ?? '',
    );
    // Tiap BU punya data serial sendiri: stok ready BU lain dilewati sebagai tidak ditemukan (tanpa membocorkan BU).
    const otherBu = await readyInOtherBu(
      env,
      plans.filter((plan) => !plan.createdNew).map((plan) => plan.serialId),
      buId,
    );
    // Serial yang masih di pencatatan ready PENDING belum sah sebagai stok: dilewati seperti aturan pending lain.
    const inPendingReady = await readyInPendingReady(
      env,
      plans.filter((plan) => !plan.createdNew).map((plan) => plan.serialId),
    );
    plans = plans.filter((plan) => {
      if (inPendingReady.has(plan.serialId)) {
        skip(plan.serial, SKIP_REASONS.alreadyRecorded);
        return false;
      }
      if (otherBu.has(plan.serialId)) {
        skip(plan.serial, SKIP_REASONS.notFound);
        return false;
      }
      if (!held.has(plan.serialId)) return true;
      skip(plan.serial, SKIP_REASONS.inOtherPending);
      return false;
    });
  }

  const locationNames = new Map<string, string>();
  let stickers: Awaited<ReturnType<typeof applicableStickersOf>> = [];
  if (plans.some((plan) => plan.createdNew)) {
    // Item hidup/aktif/tertaut ke BU SO dan BU aktif hanya disyaratkan untuk serial BARU (tingkat header: tetap melempar).
    if (!(await itemUsable(env, header.itemId, buId))) throw fieldError('itemId', ITEM_MESSAGE);
    if (!(await activeBu(env, buId))) throw fieldError('buId', 'BU tidak aktif');
    const missing = new Set<string>();
    for (const plan of plans) {
      const locationId = plan.fresh?.locationId;
      if (locationId === undefined || locationNames.has(locationId) || missing.has(locationId)) {
        continue;
      }
      const name = await activeLocationName(env.DB, locationId);
      if (name === null) missing.add(locationId);
      else locationNames.set(locationId, name);
    }
    plans = plans.filter((plan) => {
      if (plan.fresh === undefined || !missing.has(plan.fresh.locationId)) return true;
      skip(plan.serial, SKIP_REASONS.noLocation);
      return false;
    });
    if (plans.some((plan) => plan.createdNew)) {
      stickers = await applicableStickersOf(env, header.itemId, buId);
    }
  }

  // Tanpa serial yang dapat dicatat tidak boleh ada riwayat gudang (aturan pemilik 2026-11-28): pengeluaran satu potongan
  // ditolak sebelum menulis apa pun, dan pengeluaran bertahap yang total serialnya 0 saat potongan terakhir dibatalkan bersih.
  if (plans.length === 0) {
    if (!existing && header.total <= header.chunkSize) {
      throw fieldError('rows', noRecordableMessage(skipped));
    }
    if (
      existing &&
      Number(existing.chunks_received) + 1 === Number(existing.chunk_count) &&
      (await countDispatchSerials(env, existing.id.trim())) === 0
    ) {
      const earlier = await skippedTotalOf(env, existing.id.trim());
      await discardEmptyDispatch(env, existing, order);
      throw fieldError('rows', noRecordableMessage([...earlier, ...skipped]));
    }
  }

  const now = nowIso(env);
  const statements: DbStatement[] = [];
  let dispatchId: string;
  // Catat ready: tanpa SO, `orderId` = '' (penanda kosong; kunci unik `(order_id, serial_id)` mencegah ready ganda).
  let orderId = '';
  let orderNumber = '';
  const targetOf = (): WarehouseAuditTarget =>
    ready
      ? readyAuditTarget(dispatchId, header.dispatchedOn)
      : noteMode
        ? noteAuditTarget(dispatchId, header.dispatchedOn)
        : bare
          ? saleAuditTarget(dispatchId, header.dispatchedOn)
          : orderAuditTarget(orderId, orderNumber);
  // Customer pengeluaran tanpa SO (kolom `warehouse_dispatches`); kosong pada Penjualan ber-SO dan Ready.
  let bareCustomer = { id: '', name: '' };
  if (existing) {
    dispatchId = existing.id.trim();
    if (bare || noteMode) orderId = existing.order_id.trim();
    if (order) {
      orderId = order.id.trim();
      orderNumber = order.number;
    }
  } else {
    dispatchId = newId();
    if (ready) {
      // Tanpa catatan SO, tautan task, atau customer.
    } else if (noteMode) {
      // Tanpa catatan SO dan customer; tautan task (bila ada) menempel pada id pengeluaran ini.
      orderId = dispatchId;
    } else if (bare) {
      orderId = dispatchId;
      if (header.customerName !== '') {
        const customer = await planCustomerByName(env, header.customerName, user);
        bareCustomer = { id: customer.customer.id, name: customer.customer.name };
        statements.push(...customer.statements);
      }
    } else if (order) {
      orderId = order.id.trim();
      orderNumber = order.number;
      statements.push(
        env.DB.prepare(
          'UPDATE warehouse_orders SET updated_at = ?, updated_by = ? WHERE id = ?',
        ).bind(now, user.email, orderId),
      );
    } else {
      orderId = newId();
      orderNumber = header.orderNumber;
      const customer = await planCustomerByName(env, header.customerName, user);
      statements.push(
        ...customer.statements,
        env.DB.prepare(
          'INSERT INTO warehouse_orders (id, number, `key`, bu_id, customer_id, customer_name, last_dispatched_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          orderId,
          orderNumber,
          orderKey(orderNumber),
          buId,
          customer.customer.id,
          customer.customer.name,
          '',
          now,
          user.email,
          now,
          user.email,
        ),
      );
    }
    // Nomor riwayat `OUT|RS/<kode BU>/<YYMM>-<urutan>`: penghitung CAS ikut batch yang sama dengan pengeluarannya.
    const buRow = await env.DB.prepare('SELECT code FROM business_units WHERE id = ?')
      .bind(buId)
      .first<{ code: string }>();
    if (!buRow) throw fieldError('buId', 'BU tidak ditemukan');
    const reservation = await reserveDispatchNumber(
      env,
      kindOf,
      buRow.code.trim(),
      caseNumberPeriod(today),
    );
    statements.push(...reservation.statements);
    statements.push(
      env.DB.prepare(
        "INSERT INTO warehouse_dispatches (id, number, order_id, client_id, item_id, dispatched_on, note, mode, kind, bu_id, customer_id, customer_name, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at, box_start, box_size) VALUES (?, ?, ?, ?, ?, ?, ?, 'clipboard', ?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, 0, ?, ?, '', '', ?, ?)",
      ).bind(
        dispatchId,
        reservation.number,
        orderId,
        input.clientId,
        header.itemId,
        header.dispatchedOn,
        header.note,
        kindOf,
        ready || bare || noteMode ? buId : '',
        bareCustomer.id,
        bareCustomer.name,
        hash,
        header.chunkSize,
        Math.ceil(header.total / header.chunkSize),
        header.total,
        now,
        user.email,
        noteMode ? (header.boxStart ?? 0) : 0,
        noteMode ? (header.boxSize ?? 0) : 0,
      ),
    );
    if (header.handoverIds.length > 0) {
      statements.push(...addOrderLinksStmts(env, orderId, header.handoverIds, user.email, now));
    }
    statements.push(
      warehouseAuditStmt(
        env.DB,
        ready
          ? {
              action: WAREHOUSE_AUDIT.readyCreate,
              actor: user.email,
              targetId: targetOf().targetId,
              target: targetOf().label,
              ts: now,
              after: {
                dispatchId,
                buId,
                itemId: header.itemId,
                dispatchedOn: header.dispatchedOn,
                serialTotal: header.total,
                boxFrom: header.boxStart,
                boxToPlanned:
                  (header.boxStart ?? 0) + Math.ceil(header.total / (header.boxSize ?? 1)) - 1,
              },
            }
          : {
              action: WAREHOUSE_AUDIT.dispatchCreate,
              actor: user.email,
              targetId: targetOf().targetId,
              target: targetOf().label,
              ts: now,
              after: {
                dispatchId,
                itemId: header.itemId,
                dispatchedOn: header.dispatchedOn,
                serialTotal: header.total,
                newOrder: !bare && !noteMode && order === null,
                ...(bare ? { withoutOrder: true } : {}),
                ...(noteMode
                  ? {
                      recordOnly: true,
                      boxFrom: header.boxStart,
                      boxSize: header.boxSize,
                      handoverCount: header.handoverIds.length,
                    }
                  : {}),
              },
            },
      ),
    );
  }

  // Penjaga keanggotaan potongan ganda (kunci utama) lalu tiap serial.
  statements.push(
    env.DB.prepare(
      'INSERT INTO warehouse_dispatch_chunks (dispatch_id, chunk_index, received_at, skipped_json) VALUES (?, ?, ?, ?)',
    ).bind(dispatchId, input.chunkIndex, now, JSON.stringify(skipped)),
  );
  const note = ready
    ? WAREHOUSE_READY_NOTE
    : noteMode
      ? WAREHOUSE_NOTE_NOTE
      : bare
        ? WAREHOUSE_SALE_NOTE
        : warehouseRecordedNote(orderNumber);
  const stickerNames = new Map(stickers.map((sticker) => [sticker.id, sticker.name]));
  const picks = stickers.map((sticker) => ({ stickerId: sticker.id, qty: sticker.defaultQty }));
  let created = 0;
  for (const plan of plans) {
    const seq = input.chunkIndex * header.chunkSize + plan.index;
    if (plan.fresh) {
      created += 1;
      statements.push(
        ...(await newSerialStatements(env, {
          serialId: plan.serialId,
          eventId: newId(),
          clientId: plan.fresh.clientId,
          buId,
          serial: plan.serial,
          itemId: header.itemId,
          testDate: plan.fresh.testDate,
          locationId: plan.fresh.locationId,
          locationName: locationNames.get(plan.fresh.locationId) ?? '',
          note,
          sample: false,
          actor: { id: user.userId ?? '', name: user.name, email: user.email },
          stickerPicks: picks,
          stickerNames,
          eventData: ready
            ? { source: WAREHOUSE_SOURCE, mode: 'ready', dispatchId }
            : noteMode
              ? { source: WAREHOUSE_SOURCE, mode: 'note', dispatchId }
              : bare
                ? { source: WAREHOUSE_SOURCE, mode: 'order', dispatchId }
                : { source: WAREHOUSE_SOURCE, orderId, orderNumber },
          occurredOn: header.dispatchedOn,
          now,
        })),
        env.DB.prepare('UPDATE serials SET wh_created = 1 WHERE id = ?').bind(plan.serialId),
      );
    } else {
      // Serial yang sudah ada harus masih Lolos di QC pada tipe yang sama saat batch berjalan (selain itu seluruh batch batal).
      statements.push(
        env.DB.prepare(
          // Ready: juga gagal bila serial itu kini tercatat pada pengeluaran selesai atau pending mana pun (balapan).
          `UPDATE serials SET id = CASE WHEN status = 'good' AND custody = 'qc' AND deleted_at = '' AND item_id = ?${noteMode ? '' : ready ? " AND NOT EXISTS (SELECT 1 FROM warehouse_dispatch_serials rg JOIN warehouse_dispatches rd ON rd.id = rg.dispatch_id WHERE rg.serial_id = serials.id AND rd.status IN ('done', 'pending'))" : " AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials rr JOIN warehouse_ready_boxes rc ON rc.id = rr.box_id AND rc.closed_key = '' JOIN warehouse_dispatch_serials wd ON wd.serial_id = rr.serial_id JOIN warehouse_dispatches pd ON pd.id = wd.dispatch_id WHERE rr.serial_id = serials.id AND rr.released_dispatch_id = '' AND pd.kind = 'order' AND pd.status = 'pending' AND pd.id <> ?) AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials rx JOIN warehouse_ready_boxes rb ON rb.id = rx.box_id WHERE rx.serial_id = serials.id AND rx.released_dispatch_id = '' AND rb.closed_key = '' AND rb.bu_id <> ?) AND NOT EXISTS (SELECT 1 FROM warehouse_dispatch_serials wp JOIN warehouse_dispatches rp ON rp.id = wp.dispatch_id WHERE wp.serial_id = serials.id AND rp.kind = 'ready' AND rp.status = 'pending')"} THEN id ELSE ${CAS_FAIL_SQL} END WHERE id = ?`,
        ).bind(
          ...(noteMode || ready
            ? [header.itemId, plan.serialId]
            : [header.itemId, dispatchId, buId, plan.serialId]),
        ),
      );
    }
    statements.push(
      insertDispatchSerialStmt(env.DB, {
        dispatchId,
        orderId,
        serialId: plan.serialId,
        serial: plan.serial,
        seq,
        createdNew: plan.createdNew,
      }),
    );
  }
  if (ready && header.boxStart !== undefined && header.boxSize !== undefined) {
    statements.push(
      ...(await boxStatements(env, {
        dispatchId,
        buId,
        itemId: header.itemId,
        header: { boxStart: header.boxStart, boxSize: header.boxSize, total: header.total },
        serialIds: plans.map((plan) => plan.serialId),
        firstSeq: input.chunkIndex * header.chunkSize,
        user: user.email,
        now,
      })),
    );
  }
  // Selesai bila ini potongan terakhir. Urutan penetapan penting: kolom dihitung dari nilai LAMA lebih dulu. Dijaga CAS
  // status `pending` (penyapu yang membatalkan serentak membuat batch ini batal, bukan campur).
  statements.push(
    env.DB.prepare(
      `UPDATE warehouse_dispatches SET completed_at = CASE WHEN status <> 'pending' THEN ${CAS_FAIL_SQL} WHEN chunks_received + 1 = chunk_count THEN ? ELSE completed_at END, status = CASE WHEN chunks_received + 1 = chunk_count THEN 'done' ELSE status END, created_count = created_count + ?, chunks_received = chunks_received + 1 WHERE id = ?`,
    ).bind(now, created, dispatchId),
  );
  // Pencatatan ready selesai: kardus pesanan yang tetap kosong (serial dilewati) dihapus.
  if (ready) statements.push(dropEmptyBoxesStatement(env, dispatchId));
  // Penjualan selesai melepas serial ready dari stok dan menutup kardus yang kosong (no-op bila bukan `done`).
  if (!ready && !noteMode) statements.push(...releaseStatements(env, dispatchId));
  // Audit penyelesaian: bersyarat di SQL (status `done` dan belum tercatat), aman untuk potongan serentak.
  statements.push(
    dispatchDoneAuditStmt(env.DB, {
      actor: user.email,
      kind: targetOf().kind,
      targetId: targetOf().targetId,
      target: targetOf().label,
      ts: now,
      dispatchId,
    }),
  );
  // Tanggal terakhir SO naik hanya saat pengeluaran SELESAI (pending/dibatalkan tak dihitung). Ready dan Penjualan
  // tanpa SO tak punya catatan SO.
  if (!ready && !bare && !noteMode) {
    statements.push(
      env.DB.prepare(
        "UPDATE warehouse_orders SET last_dispatched_on = GREATEST(last_dispatched_on, ?) WHERE id = ? AND EXISTS (SELECT 1 FROM warehouse_dispatches WHERE id = ? AND status = 'done')",
      ).bind(header.dispatchedOn, orderId, dispatchId),
    );
  }
  await env.DB.batch(statements);

  const dispatch = await loadDispatchRow(env.DB, dispatchId);
  if (!dispatch) throw appError('INTERNAL', 'Pengeluaran gagal disimpan');
  return outputOf(
    env,
    dispatch,
    ready || bare || noteMode ? undefined : orderNumber,
    created,
    skipped,
  );
}
