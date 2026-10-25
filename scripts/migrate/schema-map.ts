/**
 * Pemetaan Sheets -> D1 untuk impor (Task 5.1). Kolom Sheets mengikuti `TableSchema` di
 * `gas/src/modules/*` (disalin sebagai data karena skrip ini berjalan di Bun, bukan GAS); kolom D1 mengikuti
 * `worker/migrations`. Tes `schema-map.test.ts` mencocokkan keduanya dengan migrasi.
 */

/**
 * Jenis kolom Sheets:
 * - `id`/`ref`/`enum`/`email`/`key`: dipangkas (trim); `email` juga huruf kecil.
 * - `text`/`json`: apa adanya (catatan, Markdown, JSON tidak boleh diubah).
 * - `int`: bilangan bulat >= 0 ('' = 0). `date`: ISO 8601 UTC ('' tetap '').
 */
export type ColumnKind = 'id' | 'ref' | 'enum' | 'email' | 'key' | 'text' | 'json' | 'int' | 'date';

export interface ColumnDef {
  name: string;
  kind: ColumnKind;
}

export interface TableDef {
  /** Nama sheet sekaligus tabel D1. */
  name: string;
  /** Kolom yang dibaca dari Sheets (urutan = skema Sheets). */
  columns: readonly ColumnDef[];
  /** Kolom id baris; `null` bila tidak ada (audit_log). */
  idColumn: string | null;
  /** Kolom tambahan D1 di luar Sheets (diisi impor). */
  derivedColumns: readonly string[];
  /** Kolom yang masuk checksum verifikasi (Task 5.2), selain urutan baris/kunci. */
  checksumColumns: readonly string[];
}

function cols(spec: string): ColumnDef[] {
  return spec.split(/\s+/).map((entry) => {
    const [name, kind] = entry.split(':');
    return { name: name as string, kind: (kind ?? 'text') as ColumnKind };
  });
}

export const TABLES: readonly TableDef[] = [
  {
    name: 'users',
    idColumn: 'id',
    columns: cols(
      'id:id email:email name status:enum role_ids:text created_at:date updated_at:date updated_by assignments:json',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'email', 'status'],
  },
  {
    name: 'roles',
    idColumn: 'id',
    columns: cols(
      'id:id name description permissions:json created_at:date updated_at:date updated_by',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'name'],
  },
  {
    name: 'locations',
    idColumn: 'id',
    columns: cols('id:id code name status:enum created_at:date updated_at:date updated_by'),
    derivedColumns: [],
    checksumColumns: ['id', 'code', 'status'],
  },
  {
    name: 'audit_log',
    idColumn: null,
    columns: cols('ts:date actor action target before after'),
    derivedColumns: [],
    checksumColumns: ['ts', 'actor', 'action', 'target'],
  },
  {
    name: 'brands',
    idColumn: 'id',
    columns: cols(
      'id:id external_id:ref name key:key status:enum sync_rev:int created_at:date updated_at:date updated_by',
    ),
    derivedColumns: ['item_count'],
    checksumColumns: ['id', 'external_id', 'key', 'status', 'sync_rev'],
  },
  {
    name: 'customers',
    idColumn: 'id',
    columns: cols('id:id name key:key status:enum created_at:date updated_at:date updated_by'),
    derivedColumns: [],
    checksumColumns: ['id', 'key', 'status'],
  },
  {
    name: 'files',
    idColumn: 'id',
    columns: cols(
      'id:id drive_id:ref mime size:int width:int height:int owner_type:enum owner_id:ref created_at:date created_by',
    ),
    derivedColumns: ['status'],
    checksumColumns: ['id', 'drive_id', 'owner_type', 'owner_id', 'size'],
  },
  {
    name: 'handovers',
    idColumn: 'id',
    columns: cols(
      'id:id number:id location_id:ref customer_id:ref customer_name note status:enum checks:json comments:json completed_at:date completed_by created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: ['version', 'checked_count', 'total_count', 'board_status'],
    checksumColumns: [
      'id',
      'number',
      'location_id',
      'customer_id',
      'status',
      'checked_count',
      'total_count',
      'board_status',
    ],
  },
  {
    name: 'items',
    idColumn: 'id',
    columns: cols(
      'id:id external_id:ref brand_id:ref model key:key is_country_lock:enum aliases:json stickers:json accessories:json attachments:json detail_md status:enum sync_rev:int created_at:date updated_at:date updated_by',
    ),
    derivedColumns: ['alias_keys'],
    checksumColumns: ['id', 'external_id', 'brand_id', 'key', 'status', 'sync_rev', 'alias_keys'],
  },
  {
    name: 'qr_designs',
    idColumn: 'id',
    columns: cols(
      'id:id title link_source:enum link document_id:ref subtitle footer logo_file_id:ref layout:json style:json overflow:enum exported_hash exported_at:date exported_by export_pdf_drive_id:ref export_png_drive_id:ref created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'document_id', 'logo_file_id', 'exported_hash'],
  },
  {
    name: 'qr_documents',
    idColumn: 'id',
    columns: cols(
      'id:id drive_id:ref name size:int shared:enum created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'drive_id', 'size', 'shared'],
  },
  {
    name: 'qr_defaults',
    idColumn: 'id',
    columns: cols(
      'id:id title subtitle footer layout:json style:json logo_file_ids:json default_logo_id:ref updated_at:date updated_by',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'default_logo_id'],
  },
  {
    name: 'qr_presets',
    idColumn: 'id',
    columns: cols(
      'id:id name title subtitle footer layout:json style:json default_logo_id:ref created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    checksumColumns: ['id', 'name', 'default_logo_id'],
  },
  {
    name: 'sync_state',
    idColumn: 'resource',
    columns: cols('resource:id seq:int updated_at:date'),
    derivedColumns: [],
    checksumColumns: ['resource', 'seq'],
  },
];

export function tableDef(name: string): TableDef {
  const found = TABLES.find((table) => table.name === name);
  if (!found) throw new Error(`Tabel ${name} tidak dikenal`);
  return found;
}

/** Tabel `handover_comments` (hasil pemecahan kolom `comments`). */
export const COMMENT_COLUMNS = [
  'id',
  'handover_id',
  'author',
  'created_at',
  'quote',
  'before',
  'after',
  'body',
  'stale',
] as const;

/**
 * Urutan INSERT yang aman untuk foreign key D1 (induk dulu). `handover_comments` mengikuti `handovers`;
 * `counters` terakhir. `audit_log` memakai id otomatis sehingga urutan baris dump menjadi urutan id.
 */
export const INSERT_ORDER = [
  'users',
  'roles',
  'locations',
  'brands',
  'customers',
  'files',
  'handovers',
  'handover_comments',
  'items',
  'qr_documents',
  'qr_designs',
  'qr_defaults',
  'qr_presets',
  'sync_state',
  'audit_log',
  'counters',
] as const;

export const HANDOVER_STORED_STATUSES = ['open', 'cancelled'] as const;
export const FILE_OWNER_TYPES = ['', 'item', 'qrlogo'] as const;
