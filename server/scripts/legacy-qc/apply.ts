// Menerapkan `Plan` ke basis data tujuan. Tujuan dianggap TIDAK kosong (produksi sudah berjalan): semua entitas dicocokkan
// lebih dulu (`resolvePlan`, murni) dan yang sudah ada tidak diubah; `applyPlan` hanya menulis yang belum ada.

import { writeAudit } from '@server/core/audit';
import type { Db, DbStatement, Preparer } from '@server/core/db';
import { insertBusinessUnitStmt, insertLocationStmt } from '@server/modules/access/repo';
import { insertBrandStmts } from '@server/modules/brand/repo';
import { insertItemStmts } from '@server/modules/item/repo';
import { normalizeKey } from '@shared/items';
import {
  BU_CODES,
  LOCATION_CODES,
  type Plan,
  type PlannedEvent,
  type PlannedItem,
  type PlannedSerial,
  SOURCE_TAG,
} from './plan';
import { uuidV5 } from './uuid';

export const MIGRATION_ACTOR = 'migrasi-qc-lama';
const SERIAL_CHUNK = 150;

interface Named {
  id: string;
  code: string;
  name: string;
}

/** Isi tujuan yang relevan untuk pencocokan (hanya dibaca). */
export interface TargetState {
  businessUnits: Named[];
  locations: Named[];
  brands: { id: string; name: string; key: string }[];
  /** `items.key` -> id. */
  itemKeys: Map<string, string>;
  /** id item -> firmware dan status Country Lock di tujuan (untuk mengisi firmware yang masih kosong). */
  itemFirmware: Map<string, { firmware: string; isCountryLock: boolean }>;
  /** `item_alias_keys.key` -> id item. */
  aliasKeys: Map<string, string>;
  /** `${itemId}\u0000${buId}` yang sudah tertaut. */
  itemBuLinks: Set<string>;
  clientIds: Set<string>;
  /** Serial Number yang sudah ada di tujuan, BU mana pun (unik se-sistem). */
  serialNumbers: Set<string>;
}

export async function loadTargetState(db: Preparer): Promise<TargetState> {
  const rows = async <T>(sql: string): Promise<T[]> => (await db.prepare(sql).all<T>()).results;
  const [bus, locations, brands, items, aliases, links, clients, pairs] = await Promise.all([
    rows<Named>('SELECT id, code, name FROM business_units'),
    rows<Named>('SELECT id, code, name FROM locations'),
    rows<{ id: string; name: string; key: string }>('SELECT id, name, `key` FROM brands'),
    rows<{ id: string; key: string; firmware: string; is_country_lock: string }>(
      'SELECT id, `key`, firmware, is_country_lock FROM items',
    ),
    rows<{ key: string; item_id: string }>('SELECT `key`, item_id FROM item_alias_keys'),
    rows<{ item_id: string; bu_id: string }>('SELECT item_id, bu_id FROM item_business_units'),
    rows<{ client_id: string }>('SELECT client_id FROM serials'),
    rows<{ serial: string }>('SELECT serial FROM serials'),
  ]);
  return {
    businessUnits: bus,
    locations,
    brands,
    itemKeys: new Map(items.map((row) => [row.key.trim(), row.id.trim()])),
    itemFirmware: new Map(
      items.map((row) => [
        row.id.trim(),
        { firmware: row.firmware.trim(), isCountryLock: row.is_country_lock.trim() === 'true' },
      ]),
    ),
    aliasKeys: new Map(aliases.map((row) => [row.key.trim(), row.item_id.trim()])),
    itemBuLinks: new Set(links.map((row) => `${row.item_id.trim()}\u0000${row.bu_id.trim()}`)),
    clientIds: new Set(clients.map((row) => row.client_id.trim())),
    serialNumbers: new Set(pairs.map((row) => row.serial)),
  };
}

export interface ItemResolution {
  legacyId: number;
  brand: string;
  model: string;
  action: 'create' | 'match-key' | 'match-alias';
  /** Firmware lama yang sah untuk dibawa ('' = tidak ada). */
  firmware: string;
  /**
   * Nasib firmware itu: `new` ikut item baru, `fill` mengisi firmware tujuan yang masih kosong, `keep` tujuan sudah
   * berisi (tidak diubah), `skip` item tujuan bukan Country Lock, `none` tidak ada firmware lama.
   */
  firmwareAction: 'new' | 'fill' | 'keep' | 'skip' | 'none';
  itemId: string;
  buNames: string[];
}

export interface ResolvedSerial extends PlannedSerial {
  buId: string;
  /** `buHistory` dengan id BU (untuk `serial_business_units`). */
  buHistoryIds: { buId: string; firstAt: string; leftAt: string }[];
  locationId: string;
  itemId: string;
}

export interface SerialConflict {
  legacyId: number;
  serial: string;
  buName: string;
  reason: string;
}

export interface Resolved {
  createBus: Named[];
  createLocations: Named[];
  createBrands: { id: string; name: string; key: string; buNames: string[] }[];
  createItems: (PlannedItem & { id: string; brandId: string })[];
  /** BU bawaan merk, hanya untuk merk yang DIBUAT (merk yang sudah ada tidak diubah). */
  brandDefaultBus: { brandId: string; buId: string }[];
  itemResolutions: ItemResolution[];
  /** Firmware yang diisikan ke item tujuan yang sudah ada dan masih kosong (tak pernah menimpa isi). */
  firmwareFills: { itemId: string; firmware: string }[];
  /** Tautan item-BU yang belum ada di tujuan. */
  itemBuLinks: { itemId: string; buId: string }[];
  serials: ResolvedSerial[];
  alreadyMigrated: number;
  conflicts: SerialConflict[];
  /** Hambatan yang menghentikan penerapan (kode BU/lokasi bentrok, dst). */
  blockers: string[];
}

export function resolvePlan(plan: Plan, target: TargetState): Resolved {
  const blockers: string[] = [];

  const buId = new Map<string, string>();
  const createBus: Named[] = [];
  const usedBuCodes = new Set(target.businessUnits.map((bu) => bu.code.trim().toLowerCase()));
  for (const name of plan.buNames) {
    const found = target.businessUnits.find(
      (bu) => bu.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (found) {
      buId.set(name, found.id.trim());
      continue;
    }
    const code = BU_CODES[name] ?? name.slice(0, 8).toUpperCase();
    if (usedBuCodes.has(code.toLowerCase()))
      blockers.push(`Kode BU "${code}" untuk "${name}" sudah dipakai BU lain di tujuan.`);
    usedBuCodes.add(code.toLowerCase());
    const created = { id: uuidV5(`bu:${name}`), code, name };
    createBus.push(created);
    buId.set(name, created.id);
  }

  const locationId = new Map<string, string>();
  const createLocations: Named[] = [];
  const usedLocationCodes = new Set(
    target.locations.map((location) => location.code.trim().toLowerCase()),
  );
  for (const name of plan.locationNames) {
    const found = target.locations.find(
      (location) => location.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (found) {
      locationId.set(name, found.id.trim());
      continue;
    }
    const code = LOCATION_CODES[name] ?? name.slice(0, 8).toUpperCase();
    if (usedLocationCodes.has(code.toLowerCase()))
      blockers.push(`Kode lokasi "${code}" untuk "${name}" sudah dipakai lokasi lain di tujuan.`);
    usedLocationCodes.add(code.toLowerCase());
    const created = { id: uuidV5(`location:${name}`), code, name };
    createLocations.push(created);
    locationId.set(name, created.id);
  }

  const brandId = new Map<string, string>();
  const createBrands: Resolved['createBrands'] = [];
  for (const name of plan.brands) {
    const key = normalizeKey(name);
    const found = target.brands.find((brand) => brand.key.trim() === key);
    if (found) {
      brandId.set(name, found.id.trim());
      continue;
    }
    const id = uuidV5(`brand:${key}`);
    const buNames = [
      ...new Set(
        plan.items
          .filter((item) => item.brand === name && item.defaultBu)
          .map((item) => item.defaultBu as string),
      ),
    ];
    createBrands.push({ id, name, key, buNames });
    brandId.set(name, id);
  }

  // Item: cocokkan menurut `items.key`, lalu `item_alias_keys` (nama lain tujuan); selain itu dibuat.
  const itemIdByLegacy = new Map<number, string>();
  const itemResolutions: ItemResolution[] = [];
  const createItems: Resolved['createItems'] = [];
  const newLinks = new Map<string, { itemId: string; buId: string }>();
  const firmwareFills = new Map<string, string>();
  for (const item of plan.items) {
    let itemId = target.itemKeys.get(item.key);
    let action: ItemResolution['action'] = 'match-key';
    if (itemId === undefined) {
      itemId = target.aliasKeys.get(item.key);
      action = 'match-alias';
    }
    if (itemId === undefined) {
      action = 'create';
      itemId = uuidV5(`item:${item.legacyId}`);
      createItems.push({ ...item, id: itemId, brandId: brandId.get(item.brand) as string });
    }
    let firmwareAction: ItemResolution['firmwareAction'] = 'none';
    if (item.firmware !== '') {
      if (action === 'create') firmwareAction = 'new';
      else {
        const current = target.itemFirmware.get(itemId);
        if (current === undefined || !current.isCountryLock) firmwareAction = 'skip';
        else if (current.firmware !== '' || firmwareFills.has(itemId)) firmwareAction = 'keep';
        else {
          firmwareAction = 'fill';
          firmwareFills.set(itemId, item.firmware);
        }
      }
    }
    itemIdByLegacy.set(item.legacyId, itemId);
    for (const merged of item.mergedLegacyIds) itemIdByLegacy.set(merged, itemId);
    itemResolutions.push({
      legacyId: item.legacyId,
      brand: item.brand,
      model: item.model,
      action,
      firmware: item.firmware,
      firmwareAction,
      itemId,
      buNames: item.buNames,
    });
    for (const name of item.buNames) {
      const id = buId.get(name) as string;
      const link = `${itemId}\u0000${id}`;
      if (!target.itemBuLinks.has(link) && !newLinks.has(link))
        newLinks.set(link, { itemId, buId: id });
    }
  }

  const serials: ResolvedSerial[] = [];
  const conflicts: SerialConflict[] = [];
  let alreadyMigrated = 0;
  for (const serial of plan.serials) {
    if (target.clientIds.has(serial.clientId)) {
      alreadyMigrated += 1;
      continue;
    }
    const resolvedBu = buId.get(serial.buName) as string;
    if (target.serialNumbers.has(serial.serial)) {
      conflicts.push({
        legacyId: serial.legacyId,
        serial: serial.serial,
        buName: serial.buName,
        reason: 'sudah ada di tujuan (serial sama; unik se-sistem)',
      });
      continue;
    }
    serials.push({
      ...serial,
      buId: resolvedBu,
      buHistoryIds: serial.buHistory.map((previous) => ({
        buId: buId.get(previous.buName) as string,
        firstAt: previous.firstAt,
        leftAt: previous.leftAt,
      })),
      locationId: locationId.get(serial.locationName) as string,
      itemId: itemIdByLegacy.get(serial.itemLegacyId) as string,
    });
  }

  return {
    createBus,
    createLocations,
    createBrands,
    createItems,
    brandDefaultBus: createBrands.flatMap((brand) =>
      brand.buNames.map((name) => ({ brandId: brand.id, buId: buId.get(name) as string })),
    ),
    itemResolutions,
    firmwareFills: [...firmwareFills].map(([itemId, firmware]) => ({ itemId, firmware })),
    itemBuLinks: [...newLinks.values()],
    serials,
    alreadyMigrated,
    conflicts,
    blockers,
  };
}

function placeholders(columns: number, rows: number): string {
  const tuple = `(${Array.from({ length: columns }, () => '?').join(', ')})`;
  return Array.from({ length: rows }, () => tuple).join(', ');
}

function serialStatements(db: Preparer, chunk: ResolvedSerial[]): DbStatement[] {
  const statements: DbStatement[] = [];
  const binds: unknown[] = [];
  for (const serial of chunk) {
    binds.push(
      serial.id,
      serial.clientId,
      serial.buId,
      serial.serial,
      serial.itemId,
      serial.testDate,
      serial.sample ? 1 : 0,
      serial.note,
      serial.locationId,
      serial.locationId,
      serial.createdAt,
      serial.createdBy,
      serial.updatedAt,
      serial.updatedBy,
    );
  }
  // Konstanta (status good, custody qc, open_case_id kosong) ditulis sebagai literal.
  const tuple = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'good', 'qc', ?, ?, ?, ?, '')";
  statements.push(
    db
      .prepare(
        `INSERT INTO serials (id, client_id, bu_id, serial, item_id, test_date, sample, note, location_id, recorded_location_id, status, custody, created_at, created_by, updated_at, updated_by, open_case_id) VALUES ${chunk.map(() => tuple).join(', ')}`,
      )
      .bind(...binds),
  );

  // Riwayat BU (spek serial unik se-sistem §4.1): satu baris BU saat ini per serial (first_at = sejak kapan di BU itu) dan
  // satu baris per BU lama yang sudah ditinggalkan (left_at terisi). Kunci utama (serial_id, bu_id) dijaga perencana.
  const buRows = chunk.flatMap((serial) => [
    [serial.id, serial.buId, serial.buSince, ''],
    ...serial.buHistoryIds.map((previous) => [
      serial.id,
      previous.buId,
      previous.firstAt,
      previous.leftAt,
    ]),
  ]);
  statements.push(
    db
      .prepare(
        `INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ${placeholders(4, buRows.length)}`,
      )
      .bind(...buRows.flat()),
  );

  const events: { serial: ResolvedSerial; event: PlannedEvent }[] = chunk.flatMap((serial) =>
    serial.events.map((event) => ({ serial, event })),
  );
  const EVENTS_PER_STATEMENT = 400;
  for (let start = 0; start < events.length; start += EVENTS_PER_STATEMENT) {
    const part = events.slice(start, start + EVENTS_PER_STATEMENT);
    const eventBinds: unknown[] = [];
    for (const { serial, event } of part) {
      const data =
        event.type === 'recorded' ? { ...event.data, locationId: serial.locationId } : event.data;
      eventBinds.push(
        event.id,
        serial.id,
        event.seq,
        event.type,
        event.occurredOn,
        event.createdAt,
        event.actorName,
        event.message,
        JSON.stringify(event.changes),
        JSON.stringify(data),
      );
    }
    const eventTuple = `(?, ?, '', ?, ?, ?, ?, '', ?, 'qc', ?, ?, ?)`;
    statements.push(
      db
        .prepare(
          `INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ${part.map(() => eventTuple).join(', ')}`,
        )
        .bind(...eventBinds),
    );
  }
  return statements;
}

export type ApplyProgress = (done: number, total: number) => void;

export interface ApplyResult {
  createdBus: number;
  createdLocations: number;
  createdBrands: number;
  createdItems: number;
  filledFirmware: number;
  linkedItemBus: number;
  insertedSerials: number;
  insertedEvents: number;
}

/** Menulis `Resolved` ke tujuan: master dulu (satu batch), lalu serial per potongan transaksi. Idempoten lewat `client_id`. */
export async function applyPlan(
  db: Db,
  resolved: Resolved,
  now: string,
  progress?: ApplyProgress,
): Promise<ApplyResult> {
  if (resolved.blockers.length > 0)
    throw new Error(`Penerapan dibatalkan:\n- ${resolved.blockers.join('\n- ')}`);
  const masters: DbStatement[] = [];
  for (const bu of resolved.createBus) {
    masters.push(
      insertBusinessUnitStmt(db, {
        ...bu,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        updatedBy: MIGRATION_ACTOR,
      }),
    );
  }
  for (const location of resolved.createLocations) {
    masters.push(
      insertLocationStmt(db, {
        ...location,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        updatedBy: MIGRATION_ACTOR,
      }),
    );
  }
  for (const brand of resolved.createBrands) {
    masters.push(
      ...insertBrandStmts(db, {
        id: brand.id,
        name: brand.name,
        key: brand.key,
        status: 'active',
        itemCount: 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: MIGRATION_ACTOR,
      }),
    );
  }
  for (const item of resolved.createItems) {
    masters.push(
      ...insertItemStmts(db, {
        id: item.id,
        brandId: item.brandId,
        model: item.model,
        key: item.key,
        isCountryLock: item.isCountryLock,
        firmware: item.firmware,
        // Bendera wajib foto bukti (migrasi 0024) tidak ada di data lama: bawaan tidak wajib.
        proofRequired: false,
        proofMin: 1,
        aliases: [],
        accessories: [],
        attachments: [],
        detail: item.detail,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        updatedBy: MIGRATION_ACTOR,
      }),
    );
  }
  // Firmware item yang sudah ada: hanya mengisi yang kosong (penjaga di WHERE, jadi putaran ulang tak menimpa apa pun).
  for (const fill of resolved.firmwareFills) {
    masters.push(
      db
        .prepare(
          "UPDATE items SET firmware = ?, updated_at = ?, updated_by = ? WHERE id = ? AND firmware = '' AND is_country_lock = 'true'",
        )
        .bind(fill.firmware, now, MIGRATION_ACTOR, fill.itemId),
    );
  }
  for (let start = 0; start < resolved.brandDefaultBus.length; start += 500) {
    const part = resolved.brandDefaultBus.slice(start, start + 500);
    masters.push(
      db
        .prepare(
          `INSERT IGNORE INTO brand_default_business_units (brand_id, bu_id) VALUES ${placeholders(2, part.length)}`,
        )
        .bind(...part.flatMap((link) => [link.brandId, link.buId])),
    );
  }
  for (let start = 0; start < resolved.itemBuLinks.length; start += 500) {
    const part = resolved.itemBuLinks.slice(start, start + 500);
    masters.push(
      db
        .prepare(
          `INSERT IGNORE INTO item_business_units (item_id, bu_id) VALUES ${placeholders(2, part.length)}`,
        )
        .bind(...part.flatMap((link) => [link.itemId, link.buId])),
    );
  }
  masters.push(
    writeAudit(db, {
      ts: now,
      actor: MIGRATION_ACTOR,
      action: 'legacy.migration',
      target: 'qc-lama',
      before: null,
      after: {
        source: SOURCE_TAG,
        businessUnits: resolved.createBus.length,
        locations: resolved.createLocations.length,
        brands: resolved.createBrands.length,
        items: resolved.createItems.length,
        firmwareFilled: resolved.firmwareFills.length,
        itemBuLinks: resolved.itemBuLinks.length,
        serials: resolved.serials.length,
      },
    }),
  );
  await db.batch(masters);
  let insertedEvents = 0;
  for (let start = 0; start < resolved.serials.length; start += SERIAL_CHUNK) {
    const chunk = resolved.serials.slice(start, start + SERIAL_CHUNK);
    await db.batch(serialStatements(db, chunk));
    insertedEvents += chunk.reduce((sum, serial) => sum + serial.events.length, 0);
    progress?.(Math.min(start + SERIAL_CHUNK, resolved.serials.length), resolved.serials.length);
  }
  return {
    createdBus: resolved.createBus.length,
    createdLocations: resolved.createLocations.length,
    createdBrands: resolved.createBrands.length,
    createdItems: resolved.createItems.length,
    filledFirmware: resolved.firmwareFills.length,
    linkedItemBus: resolved.itemBuLinks.length,
    insertedSerials: resolved.serials.length,
    insertedEvents,
  };
}
