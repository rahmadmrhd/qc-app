import { batchGuarded, isGuardFailure } from '@server/core/cas';
import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, isAppError, staleError } from '@server/core/errors';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
// Impor efek-samping: mendaftarkan pendengar stok bus event (`core/events.ts`). Kode di berkas ini tidak memakai
// apa pun dari modul stiker; pemotongan stok hanya datang lewat `statementsFor`.
import '@server/modules/sticker/serial-listener';
import { newId } from '@server/core/id';
import { buIdsWithLevel } from '@shared/business-units';
import type {
  GetSerialInput,
  GetSerialOutput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SaveSerialBatchOutput,
  SerialBuHistoryDto,
  SerialBuOptionsDto,
  SerialCaseDto,
  SerialChangeDto,
  SerialDto,
  SerialEditable,
  SerialEventDto,
  SerialItemOptionDto,
  SerialItemOptionsPageDto,
  SerialListInput,
  SerialListOutput,
  SerialLocationOptionsDto,
  SerialProofPhotoDto,
  SerialRowInput,
  SerialRowResult,
  SerialStickerOptionsDto,
  SerialStickerOptionsInput,
  SerialStickerPick,
  SerialStickerStatus,
  SerialSummaryDto,
  UpdateSerialBatchInput,
  UpdateSerialBatchOutput,
  UpdateSerialBatchRowResult,
  UpdateSerialInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { wibDateIso } from '@shared/postel';
import {
  normalizeSerial,
  proofMinimumOf,
  SERIAL_CUSTODIES,
  SERIAL_EVENT_TYPES,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialEventType,
  type SerialStatus,
  splitSerialInput,
} from '@shared/serials';
import {
  canManageSerial,
  canWriteBu,
  readableBuIds,
  restorableSerialsSql,
  writableBuIds,
} from './access';
import { applicableStickersOf } from './applicable';
import { involvedBuIdsMany } from './bu-history';
import { loadCases, type SerialCaseRow } from './case-repo';
import { newSerialStatements } from './new-serial';
import { canManageProof } from './proof/access';
import { loadStampItemInfo, planProofAttach } from './proof/attach';
import { listFailedProofsBySerial, listProofsByEvents } from './proof/repo';
import { loadReadableSerialRow } from './readable';
import { recheckExistingSerial, recheckStickerTargetAllowed } from './recheck-entry';
import {
  activeItemWritableForBu,
  activeLocationName,
  findSerialByClientId,
  insertNextEventStmt,
  isReplayOfRow,
  itemLabelOf,
  listSerialRows,
  loadBuHistory,
  loadSerialEvents,
  loadSerialRow,
  loadSerialStickers,
  SERIAL_PER_BU_ARMS_MAX,
  type SerialBuHistoryRow,
  type SerialColumn,
  type SerialEventRow,
  type SerialListFilter,
  type SerialRow,
  type SerialStickerRow,
  updateSerialStmt,
} from './repo';
import {
  parseEditable,
  parseSerialRow,
  SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT,
  SERIAL_LIST_DEFAULT_LIMIT,
} from './validate';

interface OptionRow {
  id: string;
  brand_name: string | null;
  model: string;
  key: string;
  proof_required: number | string;
  proof_min: number | string;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(',');

/**
 * Opsi item bagi pemilih di form pencatatan dan filter daftar: hanya item AKTIF yang beririsan dengan BU tempat user
 * berlevel `serial: edit` (tanpa syarat `item: view`; pembaca saja: BU yang boleh dibacanya), berkursor menurut `key`, dengan pencarian. Hanya bidang yang dibutuhkan;
 * `buOptions` hanya BU dalam cakupan user itu (BU lain item itu tidak bocor).
 */
export async function queryItemOptions(
  env: Env,
  user: UserContext,
  input: ListSerialItemOptionsInput,
): Promise<SerialItemOptionsPageDto> {
  const limit = input.limit ?? SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT;
  // Pencatat (`serial: edit`) memilih dari BU ber-level edit; pembaca saja (view pada `serial`/`serialservice`) dari BU
  // yang boleh dibacanya (bahan filter daftar). Bidang yang keluar sama minimalnya; di luar hak diam-diam tak muncul.
  const writable = writableBuIds(user);
  const scope = writable.length > 0 ? writable : readableBuIds(user);
  if (scope.length === 0) return { items: [], nextCursor: null };
  const where = [
    "i.status = 'active'",
    `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${placeholders(scope.length)}))`,
  ];
  const binds: unknown[] = [...scope];
  // Mode id: tepat item-item itu (filter BU/status IDENTIK dengan pencarian); query/cursor/limit diabaikan.
  const byIds = input.itemIds !== undefined;
  if (byIds) {
    const ids = input.itemIds ?? [];
    if (ids.length === 0) return { items: [], nextCursor: null };
    where.push(`i.id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  } else {
    const query = normalizeKey(input.query ?? '');
    if (query !== '') {
      where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
      binds.push(query, query);
    }
    if (input.cursor) {
      where.push('i.`key` > ?');
      binds.push(input.cursor);
    }
  }
  const effectiveLimit = byIds ? (input.itemIds?.length ?? 0) : limit;
  const rows = await env.DB.prepare(
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\`, i.proof_required, i.proof_min FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, effectiveLimit + 1)
    .all<OptionRow>();
  const page = rows.results.slice(0, effectiveLimit);
  const last = page[page.length - 1];
  const links = new Map<string, { id: string; code: string; name: string }[]>();
  if (page.length > 0) {
    const linkRows = await env.DB.prepare(
      `SELECT l.item_id, l.bu_id, bu.code, bu.name FROM item_business_units l JOIN business_units bu ON bu.id = l.bu_id WHERE l.item_id IN (${placeholders(page.length)}) AND l.bu_id IN (${placeholders(scope.length)}) ORDER BY bu.code, l.bu_id`,
    )
      .bind(...page.map((row) => row.id), ...scope)
      .all<{ item_id: string; bu_id: string; code: string; name: string }>();
    for (const row of linkRows.results) {
      const list = links.get(row.item_id.trim()) ?? [];
      list.push({ id: row.bu_id.trim(), code: row.code.trim(), name: row.name.trim() });
      links.set(row.item_id.trim(), list);
    }
  }
  const items = page.map((row): SerialItemOptionDto => {
    const buOptions = links.get(row.id.trim()) ?? [];
    return {
      id: row.id.trim(),
      label: `${row.brand_name ?? ''} ${row.model.trim()}`.trim(),
      buIds: buOptions.map((bu) => bu.id),
      buOptions,
      proofRequired: Number(row.proof_required) === 1,
      proofMin: Number(row.proof_min),
    };
  });
  return {
    items,
    nextCursor: !byIds && rows.results.length > limit && last ? last.key : null,
  };
}

/** Jalur Catat Serial WH: pemegang `serialwh: edit` pada BU itu, item aktif, hidup, dan terpasang pada BU tersebut. */
async function activeItemInBuForWarehouse(
  env: Env,
  user: UserContext,
  itemId: string,
  buId: string,
): Promise<boolean> {
  if (!buIdsWithLevel(user.businessUnits, 'serialwh', 'edit').includes(buId)) return false;
  const hit = await env.DB.prepare(
    `SELECT 1 AS ok FROM items i WHERE ${liveWhere('i')} AND i.id = ? AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units l WHERE l.item_id = i.id AND l.bu_id = ?)`,
  )
    .bind(itemId, buId)
    .first<{ ok: number }>();
  return hit !== null;
}

/**
 * Stiker yang berlaku bagi item pada BU tertentu; BU di luar hak tulis user, BU nonaktif, atau item yang tidak terlihat
 * bagi user = `NOT_FOUND`. BU serial tidak lagi dibatasi pada BU item (spek 2026-11-18 butir N).
 */
export async function stickerOptions(
  env: Env,
  user: UserContext,
  input: SerialStickerOptionsInput,
): Promise<SerialStickerOptionsDto> {
  // Cek ulang serial yang sudah ada: item catatan adalah acuan, jadi syarat item aktif/terlihat dilewati bila serial itu
  // bertipe `itemId` dan BU yang diminta sah sebagai tujuan cek ulang (spek serial unik se-sistem §5.1, §11 butir 9).
  const viaSerial =
    input.serialId !== undefined &&
    (await recheckStickerTargetAllowed(env, user, input.serialId, input.itemId, input.buId));
  if (
    !viaSerial &&
    !(await activeItemWritableForBu(env.DB, input.itemId, input.buId, user)) &&
    !(await activeItemInBuForWarehouse(env, user, input.itemId, input.buId))
  ) {
    throw appError('NOT_FOUND', 'Item tidak ditemukan');
  }
  return { stickers: await applicableStickersOf(env, input.itemId, input.buId) };
}

/**
 * BU AKTIF yang boleh dipilih saat mencatat serial: BU ber-level `serial: edit` (pembaca saja: BU yang boleh dibacanya,
 * pola `queryItemOptions`), urut kode lalu id. BU di luar hak tidak pernah muncul.
 */
export async function buOptions(env: Env, user: UserContext): Promise<SerialBuOptionsDto> {
  const writable = writableBuIds(user);
  const scope = writable.length > 0 ? writable : readableBuIds(user);
  if (scope.length === 0) return { businessUnits: [] };
  const rows = await env.DB.prepare(
    `SELECT id, code, name FROM business_units WHERE status = 'active' AND ${liveWhere()} AND id IN (${placeholders(scope.length)}) ORDER BY code, id`,
  )
    .bind(...scope)
    .all<{ id: string; code: string; name: string }>();
  return {
    businessUnits: rows.results.map((row) => ({
      id: row.id.trim(),
      code: row.code.trim(),
      name: row.name,
    })),
  };
}

/**
 * Semua lokasi AKTIF dan hidup (id, kode, nama), urut kode; pilihan lokasi saat mencatat serial tidak dibatasi
 * penugasan lokasi. Lokasi terhapus tidak ditawarkan (serial yang sudah di sana tetap menampilkan namanya).
 */
export async function locationOptions(env: Env): Promise<SerialLocationOptionsDto> {
  const rows = await env.DB.prepare(
    `SELECT id, code, name FROM locations WHERE status = 'active' AND ${liveWhere()} ORDER BY code, id`,
  ).all<{ id: string; code: string; name: string }>();
  return {
    locations: rows.results.map((row) => ({
      id: row.id.trim(),
      code: row.code.trim(),
      name: row.name,
    })),
  };
}

const DUPLICATE_MESSAGE = 'Serial sudah terdaftar';
export const ITEM_MESSAGE = 'Item tidak ditemukan atau tidak bisa dipakai';
export const LOCATION_MESSAGE = 'Lokasi tidak ditemukan';
const LOCATION_LOCKED_MESSAGE =
  'Lokasi tidak bisa diubah selama Serial Number masih dalam pengiriman atau di servis';
const STICKER_MESSAGE = 'Stiker tidak berlaku bagi item ini';
export const SERIAL_CONFLICTS = {
  serials_bu_serial: { message: DUPLICATE_MESSAGE, field: 'serial' },
  // Keunikan se-sistem: `serials_serial_live` (nama dasar `serials_serial`) setelah migrasi contract 0030. `serials_serial`
  // dan `serials_bu_serial` lama dibuang `ensureSerialUniqueIndex` saat start; entri keduanya dipertahankan selama data lama
  // dengan serial ganda lintas BU masih memakai `serials_bu_serial` sebagai penjaga.
  serials_serial: { message: DUPLICATE_MESSAGE, field: 'serial' },
  // Kunci idempoten kejadian (cek ulang dari Catat).
  serial_events_client_id: { message: DUPLICATE_MESSAGE, field: 'clientId' },
  serials_client_id: { message: DUPLICATE_MESSAGE, field: 'clientId' },
};

const NOT_FOUND_MESSAGE = 'Serial Number tidak ditemukan';

/** Rujukan baris yang sudah terhapus (keputusan T7): dinamai agar pengguna tahu mana yang harus diganti. */
type DeletedRef = 'Item' | 'Lokasi' | 'BU';

function deletedMessage(ref: DeletedRef, rowNumber: number | undefined): string {
  return `${rowNumber === undefined ? '' : `Baris ${rowNumber}: `}${ref} sudah dihapus`;
}

/**
 * Rujukan baris yang terhapus, bila ada (urut BU, Item untuk `item-bu`; Lokasi untuk `location`), atau `null`. Hanya
 * mengungkap apa yang pengirim sudah pegang haknya: BU yang boleh ditulisnya (diperiksa pemanggil), item yang beririsan
 * dengan BU tulisnya, dan lokasi menurut id yang ia kirim. Selain itu pesan generik tetap berlaku.
 */
async function deletedReferenceOf(
  env: Env,
  user: UserContext,
  row: SerialRowInput,
  step: 'item-bu' | 'location',
): Promise<DeletedRef | null> {
  if (step === 'location') {
    const hit = await env.DB.prepare(
      `SELECT 1 AS ok FROM locations WHERE ${deletedWhere()} AND id = ?`,
    )
      .bind(row.locationId)
      .first<{ ok: number }>();
    return hit ? 'Lokasi' : null;
  }
  const bu = await env.DB.prepare(
    `SELECT 1 AS ok FROM business_units WHERE ${deletedWhere()} AND id = ?`,
  )
    .bind(row.buId)
    .first<{ ok: number }>();
  if (bu) return 'BU';
  const scope = writableBuIds(user);
  if (scope.length === 0) return null;
  const item = await env.DB.prepare(
    `SELECT 1 AS ok FROM items i WHERE ${deletedWhere('i')} AND i.id = ? AND EXISTS (SELECT 1 FROM item_business_units l WHERE l.item_id = i.id AND l.bu_id IN (${placeholders(scope.length)}))`,
  )
    .bind(row.itemId, ...scope)
    .first<{ ok: number }>();
  return item ? 'Item' : null;
}

/** Kejadian cek ulang berpengenal ini ada pada serial yang kini TERHAPUS (kiriman ulang ke serial terhapus). */
async function recheckReplayOfDeleted(env: Env, clientId: string): Promise<boolean> {
  const hit = await env.DB.prepare(
    `SELECT 1 AS ok FROM serial_events e JOIN serials s ON s.id = e.serial_id WHERE ${deletedWhere('s')} AND e.client_id = ?`,
  )
    .bind(clientId)
    .first<{ ok: number }>();
  return hit !== null;
}

const failRow = (row: SerialRowInput, message: string): SerialRowResult => ({
  clientId: row.clientId,
  result: 'invalid',
  message,
  serial: row.serial,
});

/** Baris yang sama dikirim ulang (kunci idempoten `clientId`): `created` dengan id lama, tanpa efek baru. */
function idempotent(row: SerialRowInput, id: string): SerialRowResult {
  return { clientId: row.clientId, result: 'created', message: '', id, serial: row.serial };
}

type Applicable = Awaited<ReturnType<typeof applicableStickersOf>>;

/**
 * Memo kueri rujukan untuk SATU permintaan `saveBatch`: item aktif per (item, BU), lokasi aktif per id, dan stiker
 * yang berlaku per (item, BU) dihitung sekali walau banyak baris memakainya (tanpa memo: ±8 kueri per baris lewat
 * tunnel). Hanya hidup selama permintaan itu; hasil per baris dan atomisitas tak berubah.
 */
export class SerialLookupMemo {
  private readonly items = new Map<string, Promise<boolean>>();
  private readonly proofMins = new Map<string, Promise<number>>();
  private readonly locations = new Map<string, Promise<string | null>>();
  private readonly stickers = new Map<string, Promise<Map<string, Applicable[number]>>>();

  constructor(private readonly env: Env) {}

  /** Syarat item bagi serial di BU itu (`activeItemWritableForBu`); user sama selama satu permintaan. */
  activeItemWritableForBu(itemId: string, buId: string, user: UserContext): Promise<boolean> {
    const key = `${itemId}\u0000${buId}`;
    let found = this.items.get(key);
    if (!found) {
      found = activeItemWritableForBu(this.env.DB, itemId, buId, user);
      this.items.set(key, found);
    }
    return found;
  }

  /** Jumlah foto bukti minimum item (0 = tidak wajib); dibaca sekali per item per permintaan (`proofMinimumOf`). */
  proofMinOf(itemId: string): Promise<number> {
    let found = this.proofMins.get(itemId);
    if (!found) {
      found = this.env.DB.prepare(
        `SELECT proof_required, proof_min FROM items WHERE ${liveWhere()} AND id = ?`,
      )
        .bind(itemId)
        .first<{ proof_required: number | string; proof_min: number | string }>()
        .then((item) =>
          item
            ? proofMinimumOf({
                proofRequired: Number(item.proof_required) === 1,
                proofMin: Number(item.proof_min),
              })
            : 0,
        );
      this.proofMins.set(itemId, found);
    }
    return found;
  }

  activeLocationName(locationId: string): Promise<string | null> {
    let found = this.locations.get(locationId);
    if (!found) {
      found = activeLocationName(this.env.DB, locationId);
      this.locations.set(locationId, found);
    }
    return found;
  }

  applicable(itemId: string, buId: string): Promise<Map<string, Applicable[number]>> {
    const key = `${itemId}\u0000${buId}`;
    let found = this.stickers.get(key);
    if (!found) {
      found = applicableStickersOf(this.env, itemId, buId).then(
        (list) => new Map(list.map((sticker) => [sticker.id, sticker])),
      );
      this.stickers.set(key, found);
    }
    return found;
  }
}

/**
 * Satu baris, atomik sendiri: serial + stiker + kejadian `recorded` + pernyataan pendengar bus (pemotongan stok)
 * dalam SATU `batch()`. Aturan: bentuk, hak tulis BU, `clientId` idempoten, item/lokasi/stiker, lalu tulis.
 */
export async function createSerialOnce(
  env: Env,
  rawRow: unknown,
  user: UserContext,
  today: string,
  memo: SerialLookupMemo = new SerialLookupMemo(env),
  /** Nomor baris (1-based) dalam permintaan, untuk pesan "Baris N: ... sudah dihapus" (keputusan T7). */
  rowNumber?: number,
): Promise<SerialRowResult> {
  const parsed = parseSerialRow(rawRow, today);
  if (!parsed.ok) {
    return { clientId: parsed.clientId, result: 'invalid', message: parsed.message };
  }
  const row = parsed.row;
  // Hak tulis BU lebih dulu: baris di luar hak dijawab generik tanpa membaca apa pun tentang BU/item itu.
  if (!canWriteBu(user, row.buId)) return failRow(row, ITEM_MESSAGE);
  const existing = await findSerialByClientId(env.DB, row.clientId);
  if (existing) {
    if (!(await isReplayOfRow(env.DB, existing, row))) {
      return failRow(row, 'Baris tidak valid');
    }
    // Kiriman ulang ke serial yang sudah terhapus = tak ditemukan (keputusan T8; antrean memperlakukannya ditolak).
    return existing.deleted ? failRow(row, NOT_FOUND_MESSAGE) : idempotent(row, existing.id);
  }
  // Serial yang sudah ada (unik se-sistem) menjadi cek ulang lolos pada catatan itu (spek serial unik se-sistem §5.1);
  // syarat item aktif/terlihat di bawah TIDAK berlaku di jalur itu.
  const rechecked = await recheckExistingSerial(env, user, row, memo);
  if (rechecked) return rechecked;
  // Kiriman ulang baris CEK ULANG ke serial yang kemudian terhapus: kejadiannya sudah ada (`client_id`), jadi bukan
  // serial baru (T8).
  if (await recheckReplayOfDeleted(env, row.clientId)) return failRow(row, NOT_FOUND_MESSAGE);
  if (!(await memo.activeItemWritableForBu(row.itemId, row.buId, user))) {
    const deletedRef = await deletedReferenceOf(env, user, row, 'item-bu');
    return failRow(row, deletedRef === null ? ITEM_MESSAGE : deletedMessage(deletedRef, rowNumber));
  }
  // Item wajib foto bukti: jumlah foto kurang dari minimum = baris `invalid` (mencakup draft lama dan impor `.qcsn`).
  // Pesan sengaja tidak diawali kalimat penolakan foto web (`isProofRejection`), supaya foto baris tak dikosongkan.
  const proofMin = await memo.proofMinOf(row.itemId);
  if (proofMin > (row.proofPhotoIds?.length ?? 0)) {
    return failRow(row, `Item ini wajib foto bukti minimal ${proofMin}`);
  }
  const locationName = await memo.activeLocationName(row.locationId);
  if (locationName === null) {
    const deletedRef = await deletedReferenceOf(env, user, row, 'location');
    return failRow(
      row,
      deletedRef === null ? LOCATION_MESSAGE : deletedMessage(deletedRef, rowNumber),
    );
  }
  // Stiker hanya dimuat bila perlu: `[]` eksplisit tak butuh daftar yang berlaku; tidak dikirim = semua yang berlaku.
  const applicable =
    row.stickers === undefined || row.stickers.length > 0
      ? await memo.applicable(row.itemId, row.buId)
      : new Map<string, Applicable[number]>();
  const stickerPicks: SerialStickerPick[] =
    row.stickers ??
    [...applicable.values()].map((sticker) => ({ stickerId: sticker.id, qty: sticker.defaultQty }));
  const picked = stickerPicks.map((pick) => ({ pick, sticker: applicable.get(pick.stickerId) }));
  if (picked.some((entry) => entry.sticker === undefined)) return failRow(row, STICKER_MESSAGE);

  const now = nowIso(env);
  const serialId = newId();
  const eventId = newId();
  const actorEmail = user.email;
  // Foto bukti QC (opsional): divalidasi SEBELUM menulis apa pun; foto bermasalah = baris `invalid` tanpa entri tersimpan.
  // Klaim dan job cap ikut batch yang sama dengan kejadian, jadi tak ada celah komit tanpa job.
  const planProofs = async (): Promise<DbStatement[]> =>
    planProofAttach(env, row.proofPhotoIds, {
      user,
      serialId,
      eventId,
      snapshot: {
        serial: row.serial,
        ...(await loadStampItemInfo(env.DB, row.itemId, row.buId)),
        locationName,
        actorName: user.name,
        actorTeam: 'qc',
      },
      now,
    });
  let proofStatements: DbStatement[];
  try {
    proofStatements = await planProofs();
  } catch (error) {
    if (isAppError(error) && error.code === 'VALIDATION') {
      return { clientId: row.clientId, result: 'invalid', message: error.message };
    }
    throw error;
  }
  // Menyusun SELURUH batch satu baris (baris `saveBatch` selalu `good`; yang bermasalah lewat Lapor Rusak).
  const buildStatements = async (): Promise<DbStatement[]> => [
    ...(await newSerialStatements(env, {
      serialId,
      eventId,
      clientId: row.clientId,
      buId: row.buId,
      serial: row.serial,
      itemId: row.itemId,
      testDate: row.testDate,
      locationId: row.locationId,
      locationName,
      note: row.note,
      sample: row.sample,
      actor: { id: user.userId ?? '', name: user.name, email: actorEmail },
      stickerPicks,
      stickerNames: new Map(
        picked.map(({ pick, sticker }) => [pick.stickerId, sticker?.name ?? '']),
      ),
      eventData: row.source === undefined ? {} : { source: row.source },
      occurredOn: today,
      now,
    })),
    ...proofStatements,
  ];
  try {
    await env.DB.batch(await buildStatements());
    return {
      clientId: row.clientId,
      result: 'created',
      message: '',
      id: serialId,
      serial: row.serial,
    };
  } catch (error) {
    if (isGuardFailure(error) && proofStatements.length > 0) {
      // Penjaga klaim foto gagal: foto diambil Simpan lain (serentak) atau disapu di sela validasi dan komit. Seluruh batch
      // batal (tak ada entri tersimpan); validasi ulang menghasilkan pesan yang tepat.
      try {
        await planProofs();
      } catch (recheck) {
        if (isAppError(recheck) && recheck.code === 'VALIDATION') {
          return { clientId: row.clientId, result: 'invalid', message: recheck.message };
        }
      }
      return {
        clientId: row.clientId,
        result: 'error',
        message: 'Serial Number gagal disimpan. Coba lagi',
        serial: row.serial,
      };
    }
    if (error instanceof DbError && error.kind === 'duplicate') {
      // Balapan retry: InnoDB dapat melaporkan indeks unik serial (`serials_serial_live`, atau `serials_bu_serial` pada data lama dengan serial ganda) alih-alih `serials_client_id` untuk baris
      // yang sama, jadi pada galat duplikat APA PUN baca ulang `clientId` dulu. Pemenang sudah commit saat galat
      // ini terbit (penulis kedua menunggu kuncinya), sehingga bacaan ulang melihatnya.
      const again = await findSerialByClientId(env.DB, row.clientId);
      if (again && (await isReplayOfRow(env.DB, again, row))) {
        return again.deleted ? failRow(row, NOT_FOUND_MESSAGE) : idempotent(row, again.id);
      }
      // Serial yang sama dicatat serentak dari tempat lain dan pemenangnya sudah komit: baris ini menjadi cek ulang.
      const fallback = await recheckExistingSerial(env, user, row, memo);
      if (fallback) return fallback;
      const mapped = mapDuplicateError(error, SERIAL_CONFLICTS) as { message?: string };
      return {
        clientId: row.clientId,
        result: 'duplicate',
        message: mapped.message ?? DUPLICATE_MESSAGE,
        serial: row.serial,
      };
    }
    console.error(
      'serials.saveBatch: baris gagal disimpan',
      error instanceof Error ? error.name : '',
    );
    return {
      clientId: row.clientId,
      result: 'error',
      message: 'Serial Number gagal disimpan. Coba lagi',
      serial: row.serial,
    };
  }
}

/** Menyimpan banyak serial (maks. 200): tiap baris atomik sendiri dan diproses berurutan sesuai masukan. */
export async function saveSerialBatch(
  env: Env,
  input: SaveSerialBatchInput,
  user: UserContext,
): Promise<SaveSerialBatchOutput> {
  const today = wibDateIso(nowOf(env));
  const results: SerialRowResult[] = [];
  const memo = new SerialLookupMemo(env);
  for (const [index, row] of input.rows.entries()) {
    results.push(await createSerialOnce(env, row, user, today, memo, index + 1));
  }
  return { results };
}

const SERIAL_STATUS_SET: readonly string[] = SERIAL_STATUSES;
const SERIAL_CUSTODY_SET: readonly string[] = SERIAL_CUSTODIES;
const EVENT_TYPE_SET: readonly string[] = SERIAL_EVENT_TYPES;

/** Kolom teks `NOT NULL DEFAULT ''` -> `null` bila kosong. */
function orNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

function toCase(row: SerialCaseRow): SerialCaseDto {
  const outcome = row.outcome.trim();
  return {
    id: row.id.trim(),
    number: row.number,
    openedOn: row.opened_on,
    closedOn: orNull(row.closed_on),
    outcome: outcome === 'good' || outcome === 'broken' ? outcome : null,
  };
}

export function toSummary(row: SerialRow): SerialSummaryDto {
  const status = row.status.trim();
  const custody = row.custody.trim();
  return {
    id: row.id.trim(),
    buId: row.bu_id.trim(),
    buCode: row.bu_code.trim(),
    buName: row.bu_name.trim(),
    serial: row.serial,
    itemId: row.item_id.trim(),
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    testDate: row.test_date,
    sample: Number(row.sample) === 1,
    locationId: row.location_id.trim(),
    locationName: row.location_name ?? '',
    status: (SERIAL_STATUS_SET.includes(status) ? status : 'good') as SerialStatus,
    custody: (SERIAL_CUSTODY_SET.includes(custody) ? custody : 'qc') as SerialCustody,
    transitToLocationId: orNull(row.transit_to_location_id),
    transitToLocationName: orNull(row.transit_to_name ?? ''),
    transitOn: orNull(row.transit_on),
    openCaseNumber: orNull(row.open_case_number ?? ''),
    hasProofPhotos: Number(row.has_proof) === 1,
    proofProblemCount: Number(row.proof_problem),
    createdAt: row.created_at,
    ...(row.deleted_at === ''
      ? {}
      : { deleted: { deletedAt: row.deleted_at, deletedBy: row.deleted_by } }),
  };
}

export function toStickerStatus(status: string | null): SerialStickerStatus {
  const value = (status ?? '').trim();
  return value === 'active' || value === 'deprecated' ? value : 'inactive';
}

/**
 * Riwayat BU untuk DTO. Serial tanpa baris untuk BU saat ini (ditulis image lama saat rollback; belum dilengkapi
 * pengisi saat start) tetap menampilkan BU saat ini.
 */
function toBuHistory(row: SerialRow, history: SerialBuHistoryRow[]): SerialBuHistoryDto[] {
  const entries = history.map((entry) => ({
    buId: entry.bu_id.trim(),
    buCode: entry.bu_code,
    buName: entry.bu_name,
    firstAt: entry.first_at,
    leftAt: entry.left_at.trim(),
  }));
  const current = row.bu_id.trim();
  if (!entries.some((entry) => entry.buId === current)) {
    entries.push({
      buId: current,
      buCode: row.bu_code,
      buName: row.bu_name,
      firstAt: row.created_at,
      leftAt: '',
    });
  }
  return entries;
}

export function toDto(
  row: SerialRow,
  stickers: SerialStickerRow[],
  caseRows: SerialCaseRow[],
  buHistory: SerialBuHistoryRow[],
): SerialDto {
  const cases = caseRows.map(toCase);
  const openCaseId = orNull(row.open_case_id);
  return {
    ...toSummary(row),
    buHistory: toBuHistory(row, buHistory),
    note: row.note,
    recordedLocationId: row.recorded_location_id.trim(),
    stickers: stickers.map((sticker) => ({
      stickerId: sticker.sticker_id.trim(),
      name: sticker.name ?? '',
      alias: sticker.alias ?? '',
      qty: Number(sticker.qty),
      stickerStatus: toStickerStatus(sticker.status),
    })),
    openCaseId,
    transitFromLocationId: orNull(row.transit_from_location_id),
    transitFromLocationName: orNull(row.transit_from_name ?? ''),
    openCase: openCaseId === null ? null : (cases.find((c) => c.id === openCaseId) ?? null),
    cases,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function parseJson<T>(text: string, fallback: T): T {
  if (text.trim() === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function toEvent(
  row: SerialEventRow,
  proofPhotos: SerialProofPhotoDto[] = [],
): SerialEventDto {
  const type = row.type.trim();
  const team = row.actor_team.trim();
  const changes = parseJson<SerialChangeDto[]>(row.changes_json, []);
  const data = parseJson<Record<string, unknown>>(row.data_json, {});
  return {
    id: row.id.trim(),
    caseId: orNull(row.case_id),
    seq: Number(row.seq),
    type: (EVENT_TYPE_SET.includes(type) ? type : 'note') as SerialEventType,
    occurredOn: row.occurred_on,
    createdAt: row.created_at,
    actorName: row.actor_name,
    actorTeam: team === 'service' || team === 'system' ? team : 'qc',
    message: row.message,
    changes: Array.isArray(changes) ? changes : [],
    data: typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {},
    proofPhotos,
  };
}

/** Jenis kejadian yang boleh membawa foto bukti (Tambah dan Cek ulang). */
const PROOF_EVENT_TYPES: readonly string[] = [
  'recorded',
  'recheck',
  'recheck_pass',
  'recheck_fail',
];

/** `toEvent` untuk banyak baris dengan foto bukti kejadian (SATU kueri bagi seluruh halaman). */
export async function toEventsWithProofs(
  env: Env,
  rows: readonly SerialEventRow[],
  viewer: { user: UserContext; buId: string },
): Promise<SerialEventDto[]> {
  const ids = rows
    .filter((row) => PROOF_EVENT_TYPES.includes(row.type.trim()))
    .map((row) => row.id.trim());
  const photos = await listProofsByEvents(env.DB, ids, (proof) =>
    canManageProof(viewer.user, proof.createdBy, viewer.buId),
  );
  return rows.map((row) => toEvent(row, photos.get(row.id.trim()) ?? []));
}

/** Serial lengkap dengan stiker (nama) untuk DTO; BU di luar hak baca = `NOT_FOUND`. */
export async function loadSerialDto(env: Env, user: UserContext, id: string): Promise<SerialDto> {
  // Baca: BU saat ini ATAU BU di riwayat (spek serial unik se-sistem §5.3); serial terhapus hanya bagi pemulih.
  const row = await loadReadableSerialRow(env, user, id);
  const [stickers, cases, buHistory] = await Promise.all([
    loadSerialStickers(env.DB, row.id.trim()),
    loadCases(env.DB, row.id.trim()),
    loadBuHistory(env.DB, row.id.trim()),
  ]);
  return toDto(row, stickers, cases, buHistory);
}

/** Detail serial beserta linimasa: maks. 500 kejadian TERBARU, terbaru di atas (`seq` menurun); `eventsTruncated` bila ada yang lebih lama. */
export async function getSerial(
  env: Env,
  user: UserContext,
  input: GetSerialInput,
): Promise<GetSerialOutput> {
  const serial = await loadSerialDto(env, user, input.id);
  const { events, truncated } = await loadSerialEvents(env.DB, serial.id);
  const problemPhotos = serial.proofProblemCount
    ? await listFailedProofsBySerial(env.DB, serial.id, (proof) =>
        canManageProof(user, proof.createdBy, serial.buId),
      )
    : [];
  return {
    serial,
    events: await toEventsWithProofs(env, events, { user, buId: serial.buId }),
    eventsTruncated: truncated,
    problemPhotos,
  };
}

function encodeSerialCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}~${row.id.trim()}`;
}

/**
 * `true` hanya bila konteks MENGETAHUI seluruh id BU (`allBuIds`, tak kosong) dan semuanya ada di `readable`. Dalam
 * kasus itu predikat BU pada daftar tak membatasi apa pun (BU terhapus tetap memberi hak, BU baru ikut terhitung karena
 * konteks dimuat per permintaan), sehingga dapat dibuang demi indeks urutan. Tak diketahui atau ragu = `false` (jalur
 * dengan predikat BU); fungsi ini TIDAK PERNAH boleh melonggarkan hak baca.
 */
export function readsAllBus(
  user: Pick<UserContext, 'allBuIds'>,
  readable: readonly string[],
): boolean {
  const all = user.allBuIds;
  if (all === undefined || all.length === 0) return false;
  const have = new Set(readable);
  return all.every((id) => have.has(id));
}

/** Daftar serial pada BU yang boleh dibaca (himpunan kosong = hasil kosong tanpa kueri). */
export async function listSerials(
  env: Env,
  user: UserContext,
  input: SerialListInput,
): Promise<SerialListOutput> {
  const buIds = readableBuIds(user);
  const restorable = input.deleted === true ? restorableSerialsSql(user) : null;
  // Daftar "Terhapus" hanya bagi pemegang `serial: manage` pada minimal satu BU (selain itu `FORBIDDEN`) dan terbatas
  // pada serial yang boleh dipulihkannya.
  if (restorable !== null && buIdsWithLevel(user.businessUnits, 'serial', 'manage').length === 0) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat Serial Number terhapus');
  }
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? SERIAL_LIST_DEFAULT_LIMIT;
  const filter: SerialListFilter = { buIds, limit };
  if (readsAllBus(user, buIds)) filter.allBus = true;
  else if (buIds.length <= SERIAL_PER_BU_ARMS_MAX) filter.perBuArms = true;
  if (restorable !== null) filter.deleted = restorable;
  if (input.whRecorded !== undefined) filter.whRecorded = input.whRecorded;
  if (input.needsProof === true) filter.needsProof = true;
  const query = normalizeSerial(input.query ?? '');
  if (query !== '') {
    const stripped = query.replace(/[:.-]/g, '');
    const looksLikeMac = /^[0-9A-F:.-]+$/.test(query) && stripped !== query && stripped !== '';
    filter.prefixes = looksLikeMac ? [query, stripped] : [query];
  }
  if (input.serials !== undefined && input.serials.trim() !== '') {
    filter.serials = splitSerialInput(input.serials, SERIAL_LIMITS.inputLines).serials;
  }
  // Filter jamak menang atas yang tunggal; keduanya hanya menyempit (irisan dengan BU terbaca tetap berlaku).
  const one = <T>(
    many: readonly T[] | undefined,
    single: T | undefined,
  ): readonly T[] | undefined => many ?? (single === undefined ? undefined : [single]);
  const filterBuIds = one(input.buIds, input.buId);
  if (filterBuIds) filter.filterBuIds = filterBuIds;
  const itemIds = one(input.itemIds, input.itemId);
  if (itemIds) filter.itemIds = itemIds;
  const locationIds = one(input.locationIds, input.locationId);
  if (locationIds) filter.locationIds = locationIds;
  const statuses = one<string>(input.statuses, input.status);
  if (statuses) filter.statuses = statuses;
  const custodies = one<string>(input.custodies, input.custody);
  if (custodies) filter.custodies = custodies;
  if (input.from !== undefined) filter.from = input.from;
  if (input.to !== undefined) filter.to = input.to;
  if (input.createdBys !== undefined) filter.createdBys = input.createdBys;
  else if (input.createdBy !== undefined) filter.createdBy = input.createdBy;
  if (input.cursor !== undefined) {
    const match = /^(.+)~(.+)$/.exec(input.cursor);
    if (match?.[1] && match[2]) filter.cursor = { createdAt: match[1], id: match[2] };
  }
  const rows = await listSerialRows(env.DB, filter);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  // `canManage` (hak Hapus/Pulihkan; aditif): `serial: manage` pada SEMUA BU riwayat tiap serial, jadi klien tak menebak
  // dari BU saat ini saja. Tanpa BU ber-`manage` sama sekali, semuanya `false` tanpa kueri riwayat.
  const mayManage = buIdsWithLevel(user.businessUnits, 'serial', 'manage').length > 0;
  const involved = mayManage
    ? await involvedBuIdsMany(
        env.DB,
        page.map((row) => row.id.trim()),
      )
    : new Map<string, string[]>();
  return {
    items: page.map((row) => ({
      ...toSummary(row),
      // Penanda Keluar Gudang hanya pada daftar (kontrak `SerialSummaryDto`).
      whCreated: Number(row.wh_created) === 1,
      whRecorded: Number(row.wh_recorded) === 1,
      needsProof: Number(row.needs_proof) === 1,
      canManage:
        mayManage && canManageSerial(user, involved.get(row.id.trim()) ?? [row.bu_id.trim()]),
    })),
    nextCursor: rows.length > limit && last ? encodeSerialCursor(last) : null,
  };
}

export const STALE_MESSAGE =
  'Serial Number sudah diubah orang lain. Muat ulang halaman, lalu coba lagi';

/** Stempel baru yang selalu lebih besar dari yang lama (jam yang sama = +1 ms) agar CAS `updated_at` tak tertipu. */
export function nextStamp(now: string, previous: string): string {
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

export function validationError(field: string, message: string) {
  return appError('VALIDATION', message, { [field]: message });
}

/** Memuat serial yang boleh ditulis user; di luar hak tulis atau tak ada = `NOT_FOUND`, versi tak cocok = basi. */
export async function loadWritableRow(
  env: Env,
  user: UserContext,
  id: string,
  expectedUpdatedAt: string,
): Promise<SerialRow> {
  const row = await loadSerialRow(env.DB, id);
  if (!row || !canWriteBu(user, row.bu_id.trim())) {
    throw appError('NOT_FOUND', 'Serial Number tidak ditemukan');
  }
  if (row.updated_at !== expectedUpdatedAt) throw staleError(STALE_MESSAGE);
  return row;
}

interface UpdateTarget {
  id: string;
  expectedUpdatedAt: string;
  fields: Partial<SerialEditable>;
}

/**
 * Satu pembaruan: hanya kolom yang benar-benar berubah ditulis, dengan kejadian `data_changed` (`changes` berlabel
 * terbaca). Tanpa perubahan: tidak menulis apa pun. Stok dan `serial_stickers` TIDAK disentuh; `recorded_location_id`
 * tetap. Mengembalikan stempel `updated_at` sesudahnya.
 */
async function updateOnce(
  env: Env,
  user: UserContext,
  target: UpdateTarget,
  today: string,
): Promise<string> {
  const parsed = parseEditable(target.fields, today, false);
  if (!parsed.ok) throw validationError(parsed.field, parsed.message);
  const fields = parsed.fields;
  const row = await loadWritableRow(env, user, target.id, target.expectedUpdatedAt);
  const buId = row.bu_id.trim();
  const set: Partial<Record<SerialColumn, string | number>> = {};
  const changes: SerialChangeDto[] = [];
  const currentItemLabel = `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim();

  if (fields.serial !== undefined && fields.serial !== row.serial) {
    // Serial Number unik se-sistem: bentrok dengan catatan di BU mana pun. Indeks unik (`serials_serial`) tetap penjaga
    // akhir; pemeriksaan ini menjaga juga selama indeks belum terpasang (ada serial ganda lama yang belum disatukan).
    const taken = await env.DB.prepare(
      `SELECT 1 AS present FROM serials WHERE ${liveWhere()} AND serial = ? AND id <> ?`,
    )
      .bind(fields.serial, row.id.trim())
      .first<{ present: number }>();
    if (taken) {
      throw appError('CONFLICT', DUPLICATE_MESSAGE, { serial: DUPLICATE_MESSAGE });
    }
    set.serial = fields.serial;
    changes.push({ field: 'serial', from: row.serial, to: fields.serial });
  }
  if (fields.itemId !== undefined && fields.itemId !== row.item_id.trim()) {
    if (!(await activeItemWritableForBu(env.DB, fields.itemId, buId, user))) {
      throw validationError('itemId', ITEM_MESSAGE);
    }
    set.item_id = fields.itemId;
    changes.push({
      field: 'item',
      from: currentItemLabel,
      to: (await itemLabelOf(env.DB, fields.itemId)) ?? '',
    });
  }
  if (fields.testDate !== undefined && fields.testDate !== row.test_date) {
    set.test_date = fields.testDate;
    changes.push({ field: 'testDate', from: row.test_date, to: fields.testDate });
  }
  const currentSample = Number(row.sample) === 1;
  if (fields.sample !== undefined && fields.sample !== currentSample) {
    set.sample = fields.sample ? 1 : 0;
    changes.push({
      field: 'sample',
      from: currentSample ? 'Ya' : 'Tidak',
      to: fields.sample ? 'Ya' : 'Tidak',
    });
  }
  if (fields.note !== undefined && fields.note !== row.note) {
    set.note = fields.note;
    changes.push({
      field: 'note',
      from: row.note === '' ? null : row.note,
      to: fields.note === '' ? null : fields.note,
    });
  }
  if (fields.locationId !== undefined && fields.locationId !== row.location_id.trim()) {
    // Keputusan pemilik 2026-11-13: lokasi hanya berubah lewat alur kirim/terima selama custody bukan QC.
    if (row.custody !== 'qc') throw validationError('locationId', LOCATION_LOCKED_MESSAGE);
    const name = await activeLocationName(env.DB, fields.locationId);
    if (name === null) throw validationError('locationId', LOCATION_MESSAGE);
    set.location_id = fields.locationId;
    changes.push({ field: 'location', from: row.location_name ?? '', to: name });
  }
  if (changes.length === 0) return row.updated_at;

  const now = nextStamp(nowIso(env), row.updated_at);
  await batchGuarded(
    env.DB,
    [
      updateSerialStmt(env.DB, {
        id: row.id.trim(),
        expectedUpdatedAt: row.updated_at,
        now,
        actorEmail: user.email,
        set,
      }),
      insertNextEventStmt(env.DB, {
        id: newId(),
        serialId: row.id.trim(),
        caseId: '',
        type: 'data_changed',
        occurredOn: today,
        now,
        actorId: user.userId ?? '',
        actorName: user.name,
        actorTeam: 'qc',
        message: '',
        changes,
        data: {},
      }),
    ],
    SERIAL_CONFLICTS,
    STALE_MESSAGE,
  );
  return now;
}

/** `serials.update`: PUT utuh bidang yang dapat diubah; CAS `updated_at` (usang = 412 bila `If-Match`). */
export async function updateSerial(
  env: Env,
  input: UpdateSerialInput,
  user: UserContext,
): Promise<SerialDto> {
  const today = wibDateIso(nowOf(env));
  const { id, expectedUpdatedAt, ...fields } = input;
  await updateOnce(env, user, { id, expectedUpdatedAt, fields }, today);
  return loadSerialDto(env, user, id);
}

/** `serials.updateBatch` (maks. 200): tiap baris atomik sendiri; hasil per baris, urut masukan. */
export async function updateSerialBatch(
  env: Env,
  input: UpdateSerialBatchInput,
  user: UserContext,
): Promise<UpdateSerialBatchOutput> {
  const today = wibDateIso(nowOf(env));
  const results: UpdateSerialBatchRowResult[] = [];
  for (const raw of input.rows) {
    const source =
      typeof raw === 'object' && raw !== null ? (raw as unknown as Record<string, unknown>) : {};
    const id = typeof source.id === 'string' ? source.id : '';
    if (
      id === '' ||
      typeof source.expectedUpdatedAt !== 'string' ||
      typeof source.fields !== 'object' ||
      source.fields === null
    ) {
      results.push({ id, result: 'invalid', message: 'Baris tidak valid' });
      continue;
    }
    try {
      const updatedAt = await updateOnce(
        env,
        user,
        {
          id,
          expectedUpdatedAt: source.expectedUpdatedAt,
          fields: source.fields as Partial<SerialEditable>,
        },
        today,
      );
      results.push({ id, result: 'updated', message: '', updatedAt });
    } catch (error) {
      if (!isAppError(error)) {
        console.error('serials.updateBatch: baris gagal', error instanceof Error ? error.name : '');
        results.push({ id, result: 'error', message: 'Serial Number gagal diubah. Coba lagi' });
      } else if (error.stale) {
        results.push({ id, result: 'stale', message: error.message });
      } else if (error.code === 'CONFLICT') {
        results.push({ id, result: 'duplicate', message: error.message });
      } else if (error.code === 'NOT_FOUND') {
        results.push({ id, result: 'invalid', message: 'Serial Number tidak ditemukan' });
      } else {
        results.push({ id, result: 'invalid', message: error.message });
      }
    }
  }
  return { results };
}
