// Perencana migrasi data QC lama -> skema saat ini. MURNI: dump masuk, rencana keluar (tanpa basis data).
// Pemetaan dan keputusan pemilik produk: docs/superpowers/specs/2026-11-17-migrasi-data-qc-lama-pemetaan.md.
import { isValidFirmware } from '@shared/firmware';
import { itemKey, normalizeKey } from '@shared/items';
import { normalizeSerial, serialProblem } from '@shared/serials';
import type { Cell, Tables } from './dump';
import { uuidV5 } from './uuid';

export const SOURCE_TAG = 'legacy';

/** BU yang berlaku (tabel BU lama TIDAK diikuti; keputusan pemilik 2026-11-17). */
export const BU_SPECTRUM = 'Spectrum';
export const BU_TEAKWAVE = 'Teakwave';
export const BU_IJW = 'IJW';
export const LOCATION_SURABAYA = 'Surabaya';
export const LOCATION_JAKARTA = 'Jakarta';

/** BU bawaan menurut merk (kunci = `normalizeKey(merk)`). Merk lain: tanpa BU bawaan. */
const BRAND_BU: Record<string, string> = {
  alta: BU_SPECTRUM,
  ubiquiti: BU_SPECTRUM,
  mikrotik: BU_TEAKWAVE,
  vsol: BU_IJW,
  voltech: BU_IJW,
};

export function defaultBuOfBrand(brand: string): string | null {
  return BRAND_BU[normalizeKey(brand)] ?? null;
}

/** BU lama 1 dan 3 (Spectrum Surabaya/Jakarta) = Spectrum; 2 = Teakwave; 0 (None) menurut merk. */
export function buNameOf(legacyBu: number, brand: string): string | null {
  if (legacyBu === 1 || legacyBu === 3) return BU_SPECTRUM;
  if (legacyBu === 2) return BU_TEAKWAVE;
  if (legacyBu === 0) return defaultBuOfBrand(brand);
  return null;
}

/** Lokasi lama 1 = Surabaya, 2 = Jakarta; 0 (None) = Surabaya (keputusan pemilik 2026-11-17). */
export function locationNameOf(legacyLocation: number): string {
  return legacyLocation === 2 ? LOCATION_JAKARTA : LOCATION_SURABAYA;
}

/** Kode bawaan BU/lokasi baru (hanya dipakai bila belum ada di tujuan). */
export const BU_CODES: Record<string, string> = {
  [BU_SPECTRUM]: 'SPC',
  [BU_TEAKWAVE]: 'TKW',
  [BU_IJW]: 'IJW',
};
export const LOCATION_CODES: Record<string, string> = {
  [LOCATION_SURABAYA]: 'SBY',
  [LOCATION_JAKARTA]: 'JKT',
};

export type ItemBuMode = 'brand' | 'brand+serials';

export interface PlanOptions {
  itemBu: ItemBuMode;
  /** ISO 8601; dipakai bila sumber tak punya waktu (item tanpa riwayat). */
  now: string;
}

export interface PlannedItem {
  legacyId: number;
  brand: string;
  model: string;
  key: string;
  isCountryLock: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  /**
   * Kode firmware Country Lock untuk kolom `items.firmware` ('' = tak dibawa). Hanya terisi bila item Country Lock dan
   * kodenya ada di daftar merk itu (`isValidFirmware`, aturan yang sama dengan validator `items.save`); firmware lama
   * yang tak memenuhi syarat tidak dibuang diam-diam: ia masuk `detail` dan dilaporkan sebagai peringatan.
   */
  firmware: string;
  /** Markdown "Data migrasi" (firmware yang tak bisa dibawa + lampiran lama); hanya dipakai bila item dibuat baru. */
  detail: string;
  /** BU bawaan merk (atau null). */
  defaultBu: string | null;
  /** Himpunan BU akhir item (bawaan + BU pemakai serial menurut `itemBu`). */
  buNames: string[];
  /** Tipe lama lain yang kuncinya sama dan dilebur ke item ini. */
  mergedLegacyIds: number[];
}

export interface PlannedEvent {
  id: string;
  seq: number;
  type: 'recorded' | 'data_changed' | 'note';
  occurredOn: string;
  createdAt: string;
  actorName: string;
  message: string;
  changes: { field: string; from: string | null; to: string | null }[];
  data: Record<string, unknown>;
}

export interface PlannedSerial {
  legacyId: number;
  id: string;
  clientId: string;
  buName: string;
  locationName: string;
  /** Id tipe lama KANONIK (setelah peleburan kunci item). */
  itemLegacyId: number;
  serial: string;
  testDate: string;
  sample: boolean;
  note: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  events: PlannedEvent[];
  foldedLegacyIds: number[];
}

export type SkipReason =
  | 'deleted'
  | 'invalid-serial'
  | 'junk-serial'
  | 'unknown-bu'
  | 'unknown-item';

export interface SkippedRow {
  legacyId: number;
  serial: string;
  reason: SkipReason;
  detail: string;
}

export interface FoldedRow {
  winnerLegacyId: number;
  loserLegacyId: number;
  serial: string;
  buName: string;
  winnerItem: string;
  loserItem: string;
}

export interface Plan {
  buNames: string[];
  locationNames: string[];
  brands: string[];
  items: PlannedItem[];
  serials: PlannedSerial[];
  skipped: SkippedRow[];
  folded: FoldedRow[];
  warnings: string[];
}

/** Serial sampah (dilewati + dilaporkan): spasi di dalam, di bawah 6 karakter, atau hanya huruf. */
export function junkSerialReason(normalized: string): string | null {
  if (/\s/.test(normalized)) return 'mengandung spasi';
  if ([...normalized].length < 6) return 'kurang dari 6 karakter';
  if (/^[A-Z]+$/.test(normalized)) return 'hanya huruf';
  return null;
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** Waktu dump `YYYY-MM-DD HH:MM:SS` (diasumsikan WIB, UTC+7) -> ISO 8601 UTC. `null` bila bukan waktu sah. */
export function wibToIso(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - 7 * 3_600_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Tanggal kalender WIB (`YYYY-MM-DD`) dari ISO UTC. */
export function wibDateOf(iso: string): string {
  const wib = new Date(Date.parse(iso) + 7 * 3_600_000);
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

/** `dd/mm/yyyy` (format riwayat lama; diverifikasi terhadap `dataqc.date`) -> ISO; selain itu apa adanya. */
export function legacyDateToIso(text: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return text.trim();
  const [, d, m, y] = match as unknown as [string, string, string, string];
  return `${y}-${pad(Number(m))}-${pad(Number(d))}`;
}

interface ParsedChange {
  field: string;
  from: string;
  to: string;
}

/** `Update on:Tipe=A->B, Test Date=x->y, ` -> perubahan bidang. Bagian tak dikenal dikembalikan di `unknown`. */
export function parseUpdateAction(action: string): { changes: ParsedChange[]; unknown: string[] } {
  const body = action.replace(/^Update on:/, '');
  const changes: ParsedChange[] = [];
  const unknown: string[] = [];
  for (const part of body.split(', ')) {
    const piece = part.trim();
    if (piece === '') continue;
    const eq = piece.indexOf('=');
    const arrow = piece.lastIndexOf('->');
    if (eq < 1 || arrow < eq) {
      unknown.push(piece);
      continue;
    }
    changes.push({
      field: piece.slice(0, eq),
      from: piece.slice(eq + 1, arrow),
      to: piece.slice(arrow + 2),
    });
  }
  return { changes, unknown };
}

interface LegacyEventSource {
  order: number;
  legacySerialId: number;
  username: string;
  action: string;
  ts: string;
}

const asNumber = (cell: Cell | undefined): number =>
  typeof cell === 'number' ? cell : Number(cell ?? 0);
const asText = (cell: Cell | undefined): string =>
  cell === null || cell === undefined ? '' : String(cell);

export function buildPlan(tables: Tables, options: PlanOptions): Plan {
  const warnings: string[] = [];
  const userName = new Map<string, string>();
  for (const row of tables.users ?? []) {
    const username = asText(row[1]);
    userName.set(username, asText(row[3]).trim() || username);
  }
  const actorOf = (username: string): string => userName.get(username) ?? username;

  // ---- tipe lama -> item ----------------------------------------------------------------------
  const files = new Map<number, { driveId: string; name: string }>();
  for (const row of tables.files ?? []) {
    files.set(asNumber(row[0]), { driveId: asText(row[1]), name: asText(row[2]) });
  }
  const attachments = new Map<number, number[]>();
  for (const row of tables.tipeAttachment ?? []) {
    const list = attachments.get(asNumber(row[0])) ?? [];
    list.push(asNumber(row[1]));
    attachments.set(asNumber(row[0]), list);
  }
  const typeAddedAt = new Map<number, string>();
  for (const row of tables.historyTypeItem ?? []) {
    if (asText(row[4]) !== 'Added to Database') continue;
    const iso = wibToIso(asText(row[5]));
    const id = asNumber(row[0]);
    if (iso && (!typeAddedAt.has(id) || iso < (typeAddedAt.get(id) as string)))
      typeAddedAt.set(id, iso);
  }

  const legacyTypes = new Map<number, { brand: string; name: string }>();
  const typeByName = new Map<string, { brand: string; name: string }>();
  const itemsByKey = new Map<string, PlannedItem>();
  const canonicalOf = new Map<number, number>();
  for (const row of tables.typeItem ?? []) {
    const legacyId = asNumber(row[0]);
    const brand = asText(row[1]).trim();
    const model = asText(row[2]).trim();
    legacyTypes.set(legacyId, { brand, name: model });
    typeByName.set(model, { brand, name: model });
    const key = itemKey(brand, model);
    const existing = itemsByKey.get(key);
    const isCountryLock = asNumber(row[3]) === 1;
    const rawFirmware = asText(row[4]).trim();
    const firmwareProblem =
      rawFirmware === ''
        ? null
        : !isCountryLock
          ? 'item bukan Country Lock'
          : !isValidFirmware(brand, rawFirmware)
            ? `kode tidak ada di daftar firmware merk ${brand}`
            : null;
    if (existing) {
      existing.mergedLegacyIds.push(legacyId);
      canonicalOf.set(legacyId, existing.legacyId);
      warnings.push(
        `Tipe lama ${legacyId} "${brand} ${model}" dilebur ke tipe ${existing.legacyId} (kunci sama).`,
      );
      // Tipe induk belum punya firmware, tipe yang dilebur punya yang sah: pakai itu (tak ada yang tertimpa).
      if (existing.firmware === '' && rawFirmware !== '' && firmwareProblem === null)
        existing.firmware = rawFirmware;
      continue;
    }
    const lines: string[] = [];
    if (rawFirmware !== '' && firmwareProblem !== null) {
      lines.push(`- Firmware (aplikasi lama): ${rawFirmware}`);
      warnings.push(
        `Firmware "${rawFirmware}" tipe lama ${legacyId} "${brand} ${model}" tidak dibawa ke kolom (${firmwareProblem}); disimpan di detail item.`,
      );
    }
    const linked = (attachments.get(legacyId) ?? [])
      .map((id) => files.get(id))
      .filter((file): file is { driveId: string; name: string } => file !== undefined);
    if (linked.length > 0) {
      lines.push('- Lampiran lama:');
      for (const file of linked) {
        const label = (file.name || 'Lampiran').replace(/[[\]\r\n]/g, ' ').trim();
        lines.push(`  - [${label}](https://drive.google.com/file/d/${file.driveId}/view)`);
      }
    }
    const item: PlannedItem = {
      legacyId,
      brand,
      model,
      key,
      isCountryLock,
      status: asNumber(row[6]) === 1 ? 'inactive' : 'active',
      createdAt: typeAddedAt.get(legacyId) ?? options.now,
      firmware: rawFirmware !== '' && firmwareProblem === null ? rawFirmware : '',
      detail:
        lines.length === 0 ? '' : `## Data migrasi (aplikasi QC lama)\n\n${lines.join('\n')}\n`,
      defaultBu: defaultBuOfBrand(brand),
      buNames: [],
      mergedLegacyIds: [],
    };
    itemsByKey.set(key, item);
    canonicalOf.set(legacyId, legacyId);
  }
  const itemByLegacy = new Map<number, PlannedItem>();
  for (const item of itemsByKey.values()) itemByLegacy.set(item.legacyId, item);
  const labelOfLegacy = (legacyId: number): string => {
    const type = legacyTypes.get(legacyId);
    return type ? `${type.brand} ${type.name}`.trim() : `tipe #${legacyId}`;
  };
  const labelOfName = (name: string): string => {
    const type = typeByName.get(name.trim());
    return type ? `${type.brand} ${type.name}`.trim() : name.trim();
  };

  // ---- riwayat per serial ---------------------------------------------------------------------
  const history = new Map<number, LegacyEventSource[]>();
  let order = 0;
  for (const row of tables.historyDataqc ?? []) {
    const id = asNumber(row[0]);
    const list = history.get(id) ?? [];
    list.push({
      order: order++,
      legacySerialId: id,
      username: asText(row[3]),
      action: asText(row[4]),
      ts: asText(row[5]),
    });
    history.set(id, list);
  }

  // ---- baris dataqc: klasifikasi -------------------------------------------------------------
  interface Candidate {
    legacyId: number;
    date: string;
    itemLegacyId: number;
    serial: string;
    sample: boolean;
    note: string;
    buName: string;
    locationName: string;
  }
  const skipped: SkippedRow[] = [];
  const groups = new Map<string, Candidate[]>();
  for (const row of tables.dataqc ?? []) {
    const legacyId = asNumber(row[0]);
    const rawSerial = asText(row[3]);
    if (asNumber(row[8]) === 1) {
      skipped.push({
        legacyId,
        serial: rawSerial,
        reason: 'deleted',
        detail: 'terhapus lunak (deleted=1)',
      });
      continue;
    }
    const serial = normalizeSerial(rawSerial);
    const problem = serialProblem(serial);
    if (problem !== null) {
      skipped.push({ legacyId, serial: rawSerial, reason: 'invalid-serial', detail: problem });
      continue;
    }
    const junk = junkSerialReason(serial);
    if (junk !== null) {
      skipped.push({ legacyId, serial: rawSerial, reason: 'junk-serial', detail: junk });
      continue;
    }
    const itemLegacyId = canonicalOf.get(asNumber(row[2]));
    const item = itemLegacyId === undefined ? undefined : itemByLegacy.get(itemLegacyId);
    if (itemLegacyId === undefined || !item) {
      skipped.push({
        legacyId,
        serial: rawSerial,
        reason: 'unknown-item',
        detail: `tipe ${asNumber(row[2])}`,
      });
      continue;
    }
    const buName = buNameOf(asNumber(row[6]), item.brand);
    if (buName === null) {
      skipped.push({
        legacyId,
        serial: rawSerial,
        reason: 'unknown-bu',
        detail: `BU lama ${asNumber(row[6])}, merk ${item.brand}`,
      });
      continue;
    }
    const candidate: Candidate = {
      legacyId,
      date: asText(row[1]),
      itemLegacyId,
      serial,
      sample: asNumber(row[4]) === 1,
      note: asText(row[5]),
      buName,
      locationName: locationNameOf(asNumber(row[7])),
    };
    const key = `${buName}\u0000${serial}`;
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }

  // ---- lipat tabrakan (BU, serial): terbaru menang -------------------------------------------
  const serials: PlannedSerial[] = [];
  const folded: FoldedRow[] = [];
  for (const members of groups.values()) {
    const ordered = [...members].sort((a, b) =>
      a.date === b.date ? a.legacyId - b.legacyId : a.date < b.date ? -1 : 1,
    );
    const winner = ordered[ordered.length - 1] as Candidate;
    const losers = ordered.slice(0, -1);
    for (const loser of losers) {
      folded.push({
        winnerLegacyId: winner.legacyId,
        loserLegacyId: loser.legacyId,
        serial: winner.serial,
        buName: winner.buName,
        winnerItem: labelOfLegacy(winner.itemLegacyId),
        loserItem: labelOfLegacy(loser.itemLegacyId),
      });
    }

    // Kumpulan kejadian: riwayat pemenang + riwayat yang dilipat, urut waktu lalu urutan sumber.
    const sources: (LegacyEventSource & { owner: number })[] = [];
    for (const member of ordered) {
      for (const source of history.get(member.legacyId) ?? [])
        sources.push({ ...source, owner: member.legacyId });
    }
    const stamped = sources
      .map((source) => ({ source, iso: wibToIso(source.ts) }))
      .sort((a, b) => {
        const left = a.iso ?? '';
        const right = b.iso ?? '';
        return left === right ? a.source.order - b.source.order : left < right ? -1 : 1;
      });

    const winnerEvents: PlannedEvent[] = [];
    let recordedSeen = false;
    let seq = 0;
    const baseData = (extra: Record<string, unknown> = {}) => ({ source: SOURCE_TAG, ...extra });
    const push = (event: Omit<PlannedEvent, 'id' | 'seq'>) => {
      seq += 1;
      winnerEvents.push({ ...event, id: uuidV5(`event:${winner.legacyId}:${seq}`), seq });
    };
    for (const { source, iso } of stamped) {
      const createdAt = iso ?? options.now;
      const common = {
        occurredOn: wibDateOf(createdAt),
        createdAt,
        actorName: actorOf(source.username),
      };
      const ownerLabel = labelOfLegacy(
        ordered.find((member) => member.legacyId === source.owner)?.itemLegacyId ??
          winner.itemLegacyId,
      );
      const suffix =
        source.owner === winner.legacyId ? '' : ` (catatan lama #${source.owner}, digabung)`;
      if (source.action === 'Added to Database' && !recordedSeen) {
        recordedSeen = true;
        push({
          ...common,
          type: 'recorded',
          message: '',
          changes: [],
          data: baseData({
            stickers: [],
            locationName: winner.locationName,
            legacyId: source.owner,
          }),
        });
      } else if (
        source.action === 'Added to Database' ||
        source.action === 'Re-added to Database'
      ) {
        push({
          ...common,
          type: 'note',
          message: `${source.action === 'Added to Database' ? 'Dicatat' : 'Dicatat ulang'} sebagai ${ownerLabel}${suffix} (data lama)`,
          changes: [],
          data: baseData({ legacyId: source.owner }),
        });
      } else if (source.action.startsWith('Update on:')) {
        const { changes, unknown } = parseUpdateAction(source.action);
        const mapped = changes.flatMap((change) => {
          if (change.field === 'Tipe') {
            return [{ field: 'item', from: labelOfName(change.from), to: labelOfName(change.to) }];
          }
          if (change.field === 'Test Date') {
            return [
              {
                field: 'testDate',
                from: legacyDateToIso(change.from),
                to: legacyDateToIso(change.to),
              },
            ];
          }
          unknown.push(`${change.field}=${change.from}->${change.to}`);
          return [];
        });
        if (mapped.length > 0) {
          push({
            ...common,
            type: 'data_changed',
            message: '',
            changes: mapped,
            data: baseData({ legacyId: source.owner }),
          });
        }
        if (unknown.length > 0) {
          push({
            ...common,
            type: 'note',
            message: `Perubahan data lama: ${unknown.join('; ')}`,
            changes: [],
            data: baseData({ legacyId: source.owner }),
          });
        }
      } else {
        push({
          ...common,
          type: 'note',
          message: `Riwayat lama: ${source.action}`.slice(0, 1000),
          changes: [],
          data: baseData({ legacyId: source.owner }),
        });
      }
    }
    if (!recordedSeen) {
      // Tanpa riwayat "Added": kejadian `recorded` sintetis di awal agar linimasa selalu berpangkal pada pencatatan.
      const createdAt = wibToIso(`${winner.date} 12:00:00`) ?? options.now;
      const shifted = winnerEvents.map((event) => ({ ...event, seq: event.seq + 1 }));
      winnerEvents.length = 0;
      winnerEvents.push(
        {
          id: uuidV5(`event:${winner.legacyId}:0`),
          seq: 1,
          type: 'recorded',
          occurredOn: winner.date,
          createdAt,
          actorName: 'Migrasi data lama',
          message: '',
          changes: [],
          data: baseData({
            stickers: [],
            locationName: winner.locationName,
            legacyId: winner.legacyId,
            synthetic: true,
          }),
        },
        ...shifted,
      );
    }

    const first = winnerEvents[0] as PlannedEvent;
    const last = winnerEvents[winnerEvents.length - 1] as PlannedEvent;
    serials.push({
      legacyId: winner.legacyId,
      id: uuidV5(`serial:${winner.legacyId}`),
      clientId: uuidV5(`client:${winner.legacyId}`),
      buName: winner.buName,
      locationName: winner.locationName,
      itemLegacyId: winner.itemLegacyId,
      serial: winner.serial,
      testDate: winner.date,
      sample: winner.sample,
      note: winner.note,
      createdAt: first.createdAt,
      createdBy: first.actorName,
      updatedAt: last.createdAt,
      updatedBy: last.actorName,
      events: winnerEvents,
      foldedLegacyIds: losers.map((loser) => loser.legacyId),
    });
  }
  serials.sort((a, b) => a.legacyId - b.legacyId);

  // ---- BU item: bawaan merk (+ BU pemakai serial) ---------------------------------------------
  const usedBus = new Map<number, Set<string>>();
  for (const serial of serials) {
    const set = usedBus.get(serial.itemLegacyId) ?? new Set<string>();
    set.add(serial.buName);
    usedBus.set(serial.itemLegacyId, set);
  }
  for (const item of itemsByKey.values()) {
    const names = new Set<string>();
    if (item.defaultBu) names.add(item.defaultBu);
    if (options.itemBu === 'brand+serials')
      for (const name of usedBus.get(item.legacyId) ?? []) names.add(name);
    item.buNames = [...names].sort();
    if (item.buNames.length === 0)
      warnings.push(
        `Item "${item.brand} ${item.model}" tanpa BU (merk tak dikenal dan tanpa serial).`,
      );
  }

  const items = [...itemsByKey.values()].sort((a, b) => a.legacyId - b.legacyId);
  const buNames = new Set<string>();
  for (const item of items) for (const name of item.buNames) buNames.add(name);
  for (const serial of serials) buNames.add(serial.buName);
  const locationNames = new Set(serials.map((serial) => serial.locationName));
  const brands = [...new Set(items.map((item) => item.brand))].sort();
  return {
    buNames: [...buNames].sort(),
    locationNames: [...locationNames].sort(),
    brands,
    items,
    serials,
    skipped,
    folded,
    warnings,
  };
}
