import type {
  WarehouseSerialDto,
  WarehouseSkippedRowDto,
  WarehouseSubmitHeader,
} from '@shared/contract';
import { SERIAL_CUSTODIES, SERIAL_STATUSES } from '@shared/serials';

// Draf form Keluar Gudang di `localStorage` (`qc.serialwh.draft:<email>`, versi 1). Dibungkus try/catch: storage bisa
// diblokir, penuh, atau rusak; halaman tetap jalan tanpa draf. Satu pengeluaran bisa ribuan baris, jadi snapshot yang
// disimpan dipangkas (`trimSnapshot`) agar 5.000 baris tetap jauh di bawah kuota (~5 MB).

const PREFIX = 'qc.serialwh.draft:';

/** Jumlah rujukan pengeluaran per snapshot yang disimpan (cukup untuk peringatan "pernah keluar"). */
export const SNAPSHOT_DISPATCHES_KEPT = 3;

export type WarehouseDraftRow =
  | { kind: 'existing'; id: string; serial: string; snapshot: WarehouseSerialDto }
  | {
      kind: 'new';
      clientId: string;
      serial: string;
      locationId: string;
      testDate: string;
      itemId: string;
      buId: string;
    };

export interface WarehouseDraftSubmission {
  clientId: string;
  header: WarehouseSubmitHeader;
  chunkSize: number;
  sentChunks: number;
  orderId?: string;
  dispatchId?: string;
}

export interface WarehouseDraft {
  v: 1;
  itemId: string;
  filters: { buId: string; locationId: string; testDate: string; hideRecorded: boolean };
  rows: WarehouseDraftRow[];
  submission?: WarehouseDraftSubmission;
  /** Baris yang dilewati server pada kiriman terakhir; barisnya tetap di `rows` sampai diperbaiki atau dikeluarkan. */
  skipped?: WarehouseSkippedRowDto[];
}

export const EMPTY_FILTERS: WarehouseDraft['filters'] = {
  buId: '',
  locationId: '',
  testDate: '',
  hideRecorded: true,
};

const key = (email: string) => `${PREFIX}${email.trim().toLowerCase()}`;

const isString = (value: unknown): value is string => typeof value === 'string';
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validSnapshot(value: unknown): value is WarehouseSerialDto {
  if (!isObject(value)) return false;
  return (
    isString(value.id) &&
    isString(value.serial) &&
    isString(value.itemId) &&
    isString(value.buId) &&
    isString(value.locationId) &&
    isString(value.testDate) &&
    SERIAL_STATUSES.includes(value.status as never) &&
    SERIAL_CUSTODIES.includes(value.custody as never) &&
    Array.isArray(value.dispatches)
  );
}

/** Satu baris draf yang bentuknya sah; baris rusak membuat seluruh draf dianggap rusak (lebih aman dari baris separuh). */
function validRow(value: unknown): value is WarehouseDraftRow {
  if (!isObject(value)) return false;
  if (value.kind === 'existing') {
    return isString(value.id) && isString(value.serial) && validSnapshot(value.snapshot);
  }
  if (value.kind === 'new') {
    return (
      isString(value.clientId) &&
      value.clientId !== '' &&
      isString(value.serial) &&
      isString(value.locationId) &&
      isString(value.testDate) &&
      isString(value.itemId) &&
      isString(value.buId)
    );
  }
  return false;
}

function validSubmission(value: unknown): value is WarehouseDraftSubmission {
  if (!isObject(value) || !isObject(value.header)) return false;
  const header = value.header;
  return (
    isString(value.clientId) &&
    typeof value.chunkSize === 'number' &&
    typeof value.sentChunks === 'number' &&
    isString(header.orderNumber) &&
    isString(header.itemId) &&
    typeof header.total === 'number' &&
    Array.isArray(header.handoverIds)
  );
}

function validFilters(value: unknown): value is WarehouseDraft['filters'] {
  return (
    isObject(value) &&
    isString(value.buId) &&
    isString(value.locationId) &&
    isString(value.testDate) &&
    typeof value.hideRecorded === 'boolean'
  );
}

/**
 * Memangkas snapshot ke yang dipakai peringatan: satu rujukan pengeluaran per BU (maks. `SNAPSHOT_DISPATCHES_KEPT`),
 * karena warning hanya bertanya "pernah keluar di BU form atau BU lain". Menjaga ukuran penyimpanan.
 */
export function trimSnapshot(snapshot: WarehouseSerialDto): WarehouseSerialDto {
  const seen = new Set<string>();
  const kept = snapshot.dispatches
    .filter((dispatch) => {
      // Rujukan BU tak terbaca tak punya `buId`: dikelompokkan menurut kodenya.
      const bu = dispatch.buId ?? `code:${dispatch.buCode}`;
      if (seen.has(bu)) return false;
      seen.add(bu);
      return true;
    })
    .slice(0, SNAPSHOT_DISPATCHES_KEPT);
  return kept.length === snapshot.dispatches.length ? snapshot : { ...snapshot, dispatches: kept };
}

/** Draf yang valid, atau `null` (tidak ada, rusak, atau versi lain). */
export function parseWarehouseDraft(raw: string | null): WarehouseDraft | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.v !== 1) return null;
    if (!isString(parsed.itemId) || !validFilters(parsed.filters) || !Array.isArray(parsed.rows))
      return null;
    if (!parsed.rows.every(validRow)) return null;
    if (parsed.submission !== undefined && !validSubmission(parsed.submission)) return null;
    // `skipped` hanya penanda tampilan: bentuk rusak dibuang, bukan membuat seluruh draf dianggap rusak.
    const skipped = Array.isArray(parsed.skipped)
      ? parsed.skipped.filter(
          (entry): entry is WarehouseSkippedRowDto =>
            isObject(entry) && isString(entry.serial) && isString(entry.reason),
        )
      : [];
    const { skipped: _drop, ...rest } = parsed;
    // Draf lama (sebelum `recorded`): turunkan dari rujukan yang ada.
    const rows = (rest.rows as Record<string, unknown>[]).map((row) => {
      if (row.kind !== 'existing') return row;
      const snapshot = row.snapshot as Record<string, unknown>;
      if (typeof snapshot.recorded === 'boolean') return row;
      return {
        ...row,
        snapshot: { ...snapshot, recorded: (snapshot.dispatches as unknown[]).length > 0 },
      };
    });
    return {
      ...rest,
      rows,
      ...(skipped.length > 0 ? { skipped } : {}),
    } as unknown as WarehouseDraft;
  } catch {
    return null;
  }
}

export function serializeWarehouseDraft(draft: WarehouseDraft): string {
  return JSON.stringify({
    ...draft,
    rows: draft.rows.map((row) =>
      row.kind === 'existing' ? { ...row, snapshot: trimSnapshot(row.snapshot) } : row,
    ),
  });
}

export function readWarehouseDraft(email: string): WarehouseDraft | null {
  try {
    return parseWarehouseDraft(localStorage.getItem(key(email)));
  } catch {
    return null;
  }
}

/** `true` bila tertulis; `false` bila storage menolak (penuh atau diblokir): draf hanya di memori. */
// Setelah keluar dari aplikasi draf tidak boleh tertulis lagi oleh halaman yang sedang dilepas (efek pembersih atau
// kiriman yang selesai belakangan). Dipasang `clearAllWarehouseDrafts`, dilepas `enableWarehouseDraftWrites` saat
// halaman Keluar Gudang dibuka lagi (sesi baru).
let writesBlocked = false;

export function warehouseDraftWritesBlocked(): boolean {
  return writesBlocked;
}

export function enableWarehouseDraftWrites(): void {
  writesBlocked = false;
}

export function writeWarehouseDraft(email: string, draft: WarehouseDraft): boolean {
  try {
    localStorage.setItem(key(email), serializeWarehouseDraft(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearWarehouseDraft(email: string): void {
  try {
    localStorage.removeItem(key(email));
  } catch {
    // Storage diblokir.
  }
}

/** Membuang draf semua pemilik di perangkat ini (keluar dari aplikasi). */
export function clearAllWarehouseDrafts(): void {
  writesBlocked = true;
  try {
    const names: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (name?.startsWith(PREFIX)) names.push(name);
    }
    for (const name of names) localStorage.removeItem(name);
  } catch {
    // Storage diblokir.
  }
}

let dispatchIdCache: { name: string; raw: string; id: string | null } | null = null;

/**
 * Id pengeluaran dari draf yang sedang dikirim (`submission.dispatchId`), bila ada. Draf bisa ribuan baris (MB), dan
 * detail SO memanggil ini dari tiap bagian pengeluaran tiap render: parse hanya diulang bila isi draf berubah.
 */
export function draftDispatchId(email: string): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(email));
  } catch {
    return null;
  }
  if (raw === null) return null;
  const name = key(email);
  if (dispatchIdCache && dispatchIdCache.name === name && dispatchIdCache.raw === raw) {
    return dispatchIdCache.id;
  }
  const id = parseWarehouseDraft(raw)?.submission?.dispatchId ?? null;
  dispatchIdCache = { name, raw, id };
  return id;
}
