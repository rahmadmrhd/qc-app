import { batchGuarded } from '@server/core/cas';
import { DbError, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, isAppError, staleError } from '@server/core/errors';
import { statementsFor } from '@server/core/events';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
// Impor efek-samping: mendaftarkan pendengar stok bus event (`core/events.ts`). Kode di berkas ini tidak memakai
// apa pun dari modul stiker; pemotongan stok hanya datang lewat `statementsFor`.
import '@server/modules/sticker/serial-listener';
import type {
  GetSerialInput,
  GetSerialOutput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SaveSerialBatchOutput,
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
  SERIAL_CUSTODIES,
  SERIAL_EVENT_TYPES,
  SERIAL_LIMITS,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialEventType,
  type SerialStatus,
  splitSerialInput,
} from '@shared/serials';
import { assertSerialVisible, canWriteBu, readableBuIds, writableBuIds } from './access';
import { applicableStickersOf } from './applicable';
import {
  insertCaseStmt,
  loadCases,
  reserveCaseNumber,
  runWithCaseNumber,
  type SerialCaseRow,
} from './case-repo';
import {
  activeItemInBu,
  activeLocationName,
  findSerialByClientId,
  insertEventStmt,
  insertNextEventStmt,
  insertSerialStickerStmt,
  insertSerialStmt,
  itemLabelOf,
  listSerialRows,
  loadSerialEvents,
  loadSerialRow,
  loadSerialStickers,
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
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\` FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, effectiveLimit + 1)
    .all<OptionRow>();
  const page = rows.results.slice(0, effectiveLimit);
  const last = page[page.length - 1];
  const links = new Map<string, { id: string; code: string }[]>();
  if (page.length > 0) {
    const linkRows = await env.DB.prepare(
      `SELECT l.item_id, l.bu_id, bu.code FROM item_business_units l JOIN business_units bu ON bu.id = l.bu_id WHERE l.item_id IN (${placeholders(page.length)}) AND l.bu_id IN (${placeholders(scope.length)}) ORDER BY bu.code, l.bu_id`,
    )
      .bind(...page.map((row) => row.id), ...scope)
      .all<{ item_id: string; bu_id: string; code: string }>();
    for (const row of linkRows.results) {
      const list = links.get(row.item_id.trim()) ?? [];
      list.push({ id: row.bu_id.trim(), code: row.code.trim() });
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
    };
  });
  return {
    items,
    nextCursor: !byIds && rows.results.length > limit && last ? last.key : null,
  };
}

/** Stiker yang berlaku bagi item pada BU tertentu; BU di luar hak tulis user atau item di luar BU itu = `NOT_FOUND`. */
export async function stickerOptions(
  env: Env,
  user: UserContext,
  input: SerialStickerOptionsInput,
): Promise<SerialStickerOptionsDto> {
  if (!canWriteBu(user, input.buId)) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const link = await env.DB.prepare(
    'SELECT 1 AS ok FROM item_business_units WHERE item_id = ? AND bu_id = ?',
  )
    .bind(input.itemId, input.buId)
    .first<{ ok: number }>();
  if (!link) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  return { stickers: await applicableStickersOf(env, input.itemId, input.buId) };
}

/** Semua lokasi AKTIF (id, kode, nama), urut kode; pilihan lokasi saat mencatat serial tidak dibatasi penugasan lokasi. */
export async function locationOptions(env: Env): Promise<SerialLocationOptionsDto> {
  const rows = await env.DB.prepare(
    "SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code, id",
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
const ITEM_MESSAGE = 'Item tidak ditemukan atau tidak dapat dipakai';
export const LOCATION_MESSAGE = 'Lokasi tidak ditemukan';
const STICKER_MESSAGE = 'Stiker tidak berlaku bagi item ini';
export const SERIAL_CONFLICTS = {
  serials_bu_serial: { message: DUPLICATE_MESSAGE, field: 'serial' },
  serials_client_id: { message: DUPLICATE_MESSAGE, field: 'clientId' },
};

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
  private readonly locations = new Map<string, Promise<string | null>>();
  private readonly stickers = new Map<string, Promise<Map<string, Applicable[number]>>>();

  constructor(private readonly env: Env) {}

  activeItemInBu(itemId: string, buId: string): Promise<boolean> {
    const key = `${itemId}\u0000${buId}`;
    let found = this.items.get(key);
    if (!found) {
      found = activeItemInBu(this.env.DB, itemId, buId);
      this.items.set(key, found);
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
    return existing.buId === row.buId && existing.serial === row.serial
      ? idempotent(row, existing.id)
      : failRow(row, 'Baris tidak valid');
  }
  if (!(await memo.activeItemInBu(row.itemId, row.buId))) return failRow(row, ITEM_MESSAGE);
  const locationName = await memo.activeLocationName(row.locationId);
  if (locationName === null) return failRow(row, LOCATION_MESSAGE);
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
  const serialId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const picks = stickerPicks.map((pick) => ({ stickerId: pick.stickerId, qty: pick.qty }));
  const actorEmail = user.email;
  const failed = row.status === 'failed';
  const caseId = failed ? crypto.randomUUID() : '';
  const damage = failed ? (row.damage ?? '') : '';
  // Menyusun SELURUH batch satu baris; baris tidak lolos memesan nomor LP (diulang bila penghitung diperebutkan).
  const buildStatements = async (): Promise<DbStatement[]> => {
    const reservation = failed ? await reserveCaseNumber(env, today.replaceAll('-', '')) : null;
    const actor = {
      actorId: user.userId ?? '',
      actorName: user.name,
      actorTeam: 'qc' as const,
    };
    return [
      // Penghitung nomor LP paling depan: rebutan muncul sebagai kegagalan penjaganya dan diulang.
      ...(reservation?.statements ?? []),
      insertSerialStmt(env.DB, {
        id: serialId,
        clientId: row.clientId,
        buId: row.buId,
        serial: row.serial,
        itemId: row.itemId,
        testDate: row.testDate,
        sample: row.sample,
        note: row.note,
        locationId: row.locationId,
        status: failed ? 'failed' : 'good',
        openCaseId: caseId,
        now,
        actorEmail,
      }),
      ...(reservation
        ? [
            insertCaseStmt(env.DB, {
              id: caseId,
              number: reservation.number,
              serialId,
              buId: row.buId,
              openedOn: today,
              damage,
              now,
              actorEmail,
            }),
          ]
        : []),
      ...stickerPicks.map((pick) =>
        insertSerialStickerStmt(env.DB, serialId, pick.stickerId, pick.qty),
      ),
      insertEventStmt(env.DB, {
        id: eventId,
        serialId,
        caseId: '',
        seq: 1,
        type: 'recorded',
        occurredOn: today,
        now,
        ...actor,
        message: '',
        changes: [],
        data: {
          stickers: picked.map(({ pick, sticker }) => ({
            stickerId: pick.stickerId,
            name: sticker?.name ?? '',
            qty: pick.qty,
          })),
          locationId: row.locationId,
          locationName,
          ...(failed ? { status: 'failed', damage } : {}),
          ...(row.source === undefined ? {} : { source: row.source }),
        },
      }),
      ...(await statementsFor(env, 'serial.recorded', {
        serialId,
        eventId,
        locationId: row.locationId,
        picks,
        actor: actorEmail,
        now,
      })),
      ...(reservation
        ? [
            insertEventStmt(env.DB, {
              id: crypto.randomUUID(),
              serialId,
              caseId,
              seq: 2,
              type: 'report_failure',
              occurredOn: today,
              now,
              ...actor,
              message: '',
              changes: [
                {
                  field: 'status',
                  from: SERIAL_STATUS_LABELS.good,
                  to: SERIAL_STATUS_LABELS.failed,
                },
                { field: 'damage', from: null, to: damage },
              ],
              data: { caseNumber: reservation.number, damage },
            }),
          ]
        : []),
    ];
  };
  try {
    if (failed) {
      await runWithCaseNumber(
        env,
        serialId,
        null,
        async () => env.DB.batch(await buildStatements()),
        'Serial Number sedang diproses orang lain; coba lagi',
      );
    } else {
      await env.DB.batch(await buildStatements());
    }
    return {
      clientId: row.clientId,
      result: 'created',
      message: '',
      id: serialId,
      serial: row.serial,
    };
  } catch (error) {
    if (error instanceof DbError && error.kind === 'duplicate') {
      // Balapan retry: InnoDB dapat melaporkan indeks `serials_bu_serial` (bukan `serials_client_id`) untuk baris
      // yang sama, jadi pada galat duplikat APA PUN baca ulang `clientId` dulu. Pemenang sudah commit saat galat
      // ini terbit (penulis kedua menunggu kuncinya), sehingga bacaan ulang melihatnya.
      const again = await findSerialByClientId(env.DB, row.clientId);
      if (again && again.buId === row.buId && again.serial === row.serial) {
        return idempotent(row, again.id);
      }
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
      message: 'Serial Number gagal disimpan; coba lagi',
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
  for (const row of input.rows) {
    results.push(await createSerialOnce(env, row, user, today, memo));
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
    damage: row.damage,
    outcome: outcome === 'good' || outcome === 'broken' ? outcome : null,
  };
}

function toSummary(row: SerialRow): SerialSummaryDto {
  const status = row.status.trim();
  const custody = row.custody.trim();
  return {
    id: row.id.trim(),
    buId: row.bu_id.trim(),
    buCode: row.bu_code.trim(),
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
    createdAt: row.created_at,
  };
}

export function toStickerStatus(status: string | null): SerialStickerStatus {
  const value = (status ?? '').trim();
  return value === 'active' || value === 'deprecated' ? value : 'inactive';
}

function toDto(row: SerialRow, stickers: SerialStickerRow[], caseRows: SerialCaseRow[]): SerialDto {
  const cases = caseRows.map(toCase);
  const openCaseId = orNull(row.open_case_id);
  return {
    ...toSummary(row),
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

export function toEvent(row: SerialEventRow): SerialEventDto {
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
  };
}

/** Serial lengkap dengan stiker (nama) untuk DTO; BU di luar hak baca = `NOT_FOUND`. */
export async function loadSerialDto(env: Env, user: UserContext, id: string): Promise<SerialDto> {
  const row = await loadSerialRow(env.DB, id);
  if (!row) throw appError('NOT_FOUND', 'Serial Number tidak ditemukan');
  assertSerialVisible(user, row.bu_id.trim());
  const [stickers, cases] = await Promise.all([
    loadSerialStickers(env.DB, row.id.trim()),
    loadCases(env.DB, row.id.trim()),
  ]);
  return toDto(row, stickers, cases);
}

/** Detail serial beserta linimasa: maks. 500 kejadian TERBARU, terbaru di atas (`seq` menurun); `eventsTruncated` bila ada yang lebih lama. */
export async function getSerial(
  env: Env,
  user: UserContext,
  input: GetSerialInput,
): Promise<GetSerialOutput> {
  const serial = await loadSerialDto(env, user, input.id);
  const { events, truncated } = await loadSerialEvents(env.DB, serial.id);
  return { serial, events: events.map(toEvent), eventsTruncated: truncated };
}

function encodeSerialCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}~${row.id.trim()}`;
}

/** Daftar serial pada BU yang boleh dibaca (himpunan kosong = hasil kosong tanpa kueri). */
export async function listSerials(
  env: Env,
  user: UserContext,
  input: SerialListInput,
): Promise<SerialListOutput> {
  const buIds = readableBuIds(user);
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? SERIAL_LIST_DEFAULT_LIMIT;
  const filter: SerialListFilter = { buIds, limit };
  const query = normalizeSerial(input.query ?? '');
  if (query !== '') {
    const stripped = query.replace(/[:.-]/g, '');
    const looksLikeMac = /^[0-9A-F:.-]+$/.test(query) && stripped !== query && stripped !== '';
    filter.prefixes = looksLikeMac ? [query, stripped] : [query];
  }
  if (input.serials !== undefined && input.serials.trim() !== '') {
    filter.serials = splitSerialInput(input.serials, SERIAL_LIMITS.inputLines).serials;
  }
  if (input.buId !== undefined) filter.buId = input.buId;
  if (input.itemId !== undefined) filter.itemId = input.itemId;
  if (input.locationId !== undefined) filter.locationId = input.locationId;
  if (input.status !== undefined) filter.status = input.status;
  if (input.custody !== undefined) filter.custody = input.custody;
  if (input.from !== undefined) filter.from = input.from;
  if (input.to !== undefined) filter.to = input.to;
  if (input.createdBy !== undefined) filter.createdBy = input.createdBy;
  if (input.cursor !== undefined) {
    const match = /^(.+)~(.+)$/.exec(input.cursor);
    if (match?.[1] && match[2]) filter.cursor = { createdAt: match[1], id: match[2] };
  }
  const rows = await listSerialRows(env.DB, filter);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > limit && last ? encodeSerialCursor(last) : null,
  };
}

export const STALE_MESSAGE = 'Serial Number diubah orang lain; muat ulang halaman lalu ulangi';

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
    set.serial = fields.serial;
    changes.push({ field: 'serial', from: row.serial, to: fields.serial });
  }
  if (fields.itemId !== undefined && fields.itemId !== row.item_id.trim()) {
    if (!(await activeItemInBu(env.DB, fields.itemId, buId))) {
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
        id: crypto.randomUUID(),
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
        results.push({ id, result: 'error', message: 'Serial Number gagal diubah; coba lagi' });
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
