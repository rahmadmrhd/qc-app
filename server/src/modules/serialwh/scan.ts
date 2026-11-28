import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import { whRecordedSql } from '@server/modules/serial/wh-flags';
import type {
  ListWarehouseSerialsInput,
  WarehouseLookupInput,
  WarehouseLookupOutput,
  WarehouseSerialsPageDto,
} from '@shared/contract';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { normalizeSerial, serialProblem } from '@shared/serials';
import { assertWhBu, whBuIds } from './access';
import {
  loadDispatchRefs,
  placeholders,
  selectWhSerials,
  serialsInOrder,
  toWarehouseSerial,
  type WhSerialRow,
} from './repo';

/**
 * Pengungkapan lintas BU (spek 5.9, keputusan pemilik: "lencana + kode BU saja"): `recorded` (ada pengeluaran selesai di
 * BU mana pun) untuk lencana; rujukan pengeluaran lengkap hanya untuk SO di BU terbaca (`serialwh: view`), selain itu
 * hanya kode BU dan tanggal; nama BU hanya bila BU serial itu terbaca (kode BU selalu ada).
 */
async function toDtos(env: Env, user: UserContext, rows: readonly WhSerialRow[], orderId?: string) {
  const readable = new Set(whBuIds(user, 'view'));
  const ids = rows.map((row) => row.id.trim());
  const { refs, recorded } = await loadDispatchRefs(env.DB, ids, readable);
  const inOrder = orderId === undefined ? null : await serialsInOrder(env.DB, orderId, ids);
  return rows.map((row) =>
    toWarehouseSerial(
      row,
      refs.get(row.id.trim()) ?? [],
      inOrder === null ? undefined : inOrder.has(row.id.trim()),
      readable.has(row.bu_id.trim()),
      recorded.has(row.id.trim()),
    ),
  );
}

/**
 * Pencarian serial lintas BU (apa pun BU-nya; terhapus = tidak ditemukan) menurut nomor ternormalisasi dan/atau id.
 * Pengungkapan sengaja minimal (`WarehouseSerialDto`). `orderId` (opsional) menandai serial yang sudah ada pada SO itu;
 * SO harus berada pada BU ber-`serialwh: edit`, selain itu `NOT_FOUND` (agar keanggotaan SO lain tak terbuka).
 */
export async function warehouseLookup(
  env: Env,
  user: UserContext,
  input: WarehouseLookupInput,
): Promise<WarehouseLookupOutput> {
  let orderId: string | undefined;
  if (input.orderId !== undefined) {
    const order = await env.DB.prepare('SELECT id, bu_id FROM warehouse_orders WHERE id = ?')
      .bind(input.orderId)
      .first<{ id: string; bu_id: string }>();
    if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
    assertWhBu(user, order.bu_id.trim(), 'edit');
    orderId = order.id.trim();
  }
  const serials = [
    ...new Set(
      (input.serials ?? [])
        .map((value) => normalizeSerial(value))
        .filter((value) => serialProblem(value) === null),
    ),
  ];
  const ids = [...new Set(input.ids ?? [])];
  if (serials.length + ids.length > WAREHOUSE_LIMITS.lookupMax) {
    throw appError('VALIDATION', `Maksimal ${WAREHOUSE_LIMITS.lookupMax} serial per pencarian`);
  }
  if (serials.length === 0 && ids.length === 0) return { found: [] };
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (serials.length > 0) {
    parts.push(`s.serial IN (${placeholders(serials.length)})`);
    binds.push(...serials);
  }
  if (ids.length > 0) {
    parts.push(`s.id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  const rows = await selectWhSerials(
    env.DB,
    `(${parts.join(' OR ')})`,
    binds,
    'ORDER BY s.serial, s.id',
  );
  return { found: await toDtos(env, user, rows.results, orderId) };
}

function encodeCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}~${row.id.trim()}`;
}

/**
 * Daftar serial satu Item pada BU yang boleh dibaca pemanggil (`serialwh: view` ke atas), untuk tabel pilihan form
 * Keluar Gudang. Hanya BU SAAT INI; urut terbaru dicatat. `hideRecordedBuId` menyembunyikan serial yang sudah tercatat
 * pada pengeluaran selesai di SO milik BU itu.
 */
export async function warehouseSerials(
  env: Env,
  user: UserContext,
  input: ListWarehouseSerialsInput,
): Promise<WarehouseSerialsPageDto> {
  const readable = whBuIds(user, 'view');
  const buIds = input.buIds ? readable.filter((id) => input.buIds?.includes(id)) : readable;
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? WAREHOUSE_LIMITS.listDefault;
  const where = ['s.item_id = ?', `s.bu_id IN (${placeholders(buIds.length)})`];
  const binds: unknown[] = [input.itemId, ...buIds];
  if (input.locationId !== undefined) {
    where.push('s.location_id = ?');
    binds.push(input.locationId);
  }
  if (input.testDate !== undefined) {
    where.push('s.test_date = ?');
    binds.push(input.testDate);
  }
  const query = normalizeSerial(input.query ?? '');
  if (query !== '') {
    where.push("s.serial LIKE ? ESCAPE '!'");
    binds.push(`${escapeLike(query)}%`);
  }
  // Hanya BU yang terbaca pemanggil yang boleh dijadikan penyaring (selain itu diabaikan: tanpa oracle lintas BU).
  if (input.hideRecordedBuId !== undefined && readable.includes(input.hideRecordedBuId)) {
    if (input.forMode === 'ready') {
      // Mode ready: catatan WH selesai mana pun (SO atau ready) membuat serial itu dilewati saat kirim, jadi disembunyikan.
      where.push(`NOT ${whRecordedSql('s')}`);
    } else {
      where.push(
        "NOT EXISTS (SELECT 1 FROM warehouse_dispatch_serials hw JOIN warehouse_dispatches hd ON hd.id = hw.dispatch_id LEFT JOIN warehouse_orders ho ON ho.id = hw.order_id WHERE hw.serial_id = s.id AND hd.kind = 'order' AND hd.status = 'done' AND IF(hd.bu_id <> '', hd.bu_id, ho.bu_id) = ?)",
      );
      binds.push(input.hideRecordedBuId);
    }
  }
  if (input.cursor !== undefined) {
    const match = /^(.+)~(.+)$/.exec(input.cursor);
    if (!match?.[1] || !match[2]) throw appError('VALIDATION', 'Kursor tidak valid');
    where.push('(s.created_at < ? OR (s.created_at = ? AND s.id < ?))');
    binds.push(match[1], match[1], match[2]);
  }
  const rows = await selectWhSerials(
    env.DB,
    where.join(' AND '),
    [...binds, limit + 1],
    'ORDER BY s.created_at DESC, s.id DESC LIMIT ?',
  );
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await toDtos(env, user, page),
    nextCursor: rows.results.length > limit && last ? encodeCursor(last) : null,
  };
}
