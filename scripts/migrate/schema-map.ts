/**
 * Pemetaan Sheets -> MariaDB untuk impor (T33). Kolom Sheets mengikuti `TableSchema` di `gas/src/modules/*`
 * (disalin sebagai data karena skrip ini berjalan di Bun, bukan GAS); kolom MariaDB mengikuti
 * `server/migrations`. `import-sheets.test.ts` mencocokkan keduanya dengan skema nyata (information_schema).
 *
 * LINGKUP FINAL impor (keputusan pemilik 2026-11-06, spek §14 dan §19 butir 9e): users, roles, locations,
 * qr_designs, qr_documents, qr_presets, qr_defaults, files HANYA yang dirujuk tabel QR yang diimpor (logo desain,
 * pustaka logo, logo bawaan preset/default), dan audit_log HANYA baris yang berkaitan dengan entitas yang diimpor
 * (keluarga aksi `user`, `role`, `location`, `qrcode`). TIDAK diimpor: handovers, items, brands, customers,
 * sync_state, counters, berkas milik item atau yang tak dirujuk, dan audit handover/item/brand/customer/sync. Yang
 * dibuang (`fate: 'discard'`, `divert`) tidak ditulis ke target, dikosongkan di target, dan dihitung/diringkas di
 * laporan agar isinya diperiksa pemilik sebelum dibuang.
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

export type TableFate = 'import' | 'discard';

export interface TableDef {
  /** Nama sheet sekaligus tabel MariaDB. */
  name: string;
  /** Kolom yang dibaca dari Sheets (urutan = skema Sheets). */
  columns: readonly ColumnDef[];
  /** Kolom id baris; `null` bila tidak ada (audit_log). */
  idColumn: string | null;
  /** Kolom tambahan MariaDB di luar Sheets (diisi impor). */
  derivedColumns: readonly string[];
  /** `import` = ditulis ke target; `discard` = dibuang (hanya dihitung, diringkas, dan diperiksa). */
  fate: TableFate;
  /** Baris yang nilai `column`-nya (dipangkas) memenuhi `matches` dialihkan ke ringkasan buangan `as`. */
  divert?: { column: string; matches: (value: string) => boolean; as: string };
  /**
   * Nilai `column` (dipangkas) HARUS memenuhi `matches`; yang tidak menjadi galat `code` per baris (pemilik
   * memutuskan lewat pengecualian). Dipakai audit_log agar aksi yang tak dikenal tidak diimpor atau dibuang diam-diam.
   */
  known?: { column: string; matches: (value: string) => boolean; code: string; message: string };
}

/** Keluarga aksi audit (bagian sebelum titik pertama pada `action`, mis. `qrcode.export` -> `qrcode`). */
export function auditFamily(action: string): string {
  const text = action.trim();
  const dot = text.indexOf('.');
  return dot < 0 ? text : text.slice(0, dot);
}

/** Keluarga aksi audit yang berkaitan dengan entitas yang diimpor: akses (user, role, location) dan QR. */
export const AUDIT_IMPORT_FAMILIES = ['user', 'role', 'location', 'qrcode'] as const;
/** Keluarga aksi audit milik modul yang dibuang (termasuk `*.sync.conflict`): dibuang bersama datanya. */
export const AUDIT_DISCARD_FAMILIES = ['brand', 'item', 'customer', 'handover'] as const;

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
    fate: 'import',
  },
  {
    name: 'roles',
    idColumn: 'id',
    columns: cols(
      'id:id name description permissions:json created_at:date updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'import',
  },
  {
    name: 'locations',
    idColumn: 'id',
    columns: cols('id:id code name status:enum created_at:date updated_at:date updated_by'),
    derivedColumns: [],
    fate: 'import',
  },
  {
    name: 'audit_log',
    idColumn: null,
    columns: cols('ts:date actor action target before after'),
    derivedColumns: [],
    fate: 'import',
    divert: {
      column: 'action',
      matches: (value) =>
        (AUDIT_DISCARD_FAMILIES as readonly string[]).includes(auditFamily(value)),
      as: 'audit_log',
    },
    known: {
      column: 'action',
      matches: (value) => (AUDIT_IMPORT_FAMILIES as readonly string[]).includes(auditFamily(value)),
      code: 'AUDIT_AKSI_TAK_DIKENAL',
      message:
        'aksi audit bukan keluarga user/role/location/qrcode (diimpor) maupun brand/item/customer/handover (dibuang); putuskan dan kecualikan barisnya bila perlu',
    },
  },
  {
    name: 'brands',
    idColumn: 'id',
    columns: cols(
      'id:id external_id:ref name key:key status:enum sync_rev:int created_at:date updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'discard',
  },
  {
    name: 'customers',
    idColumn: 'id',
    columns: cols('id:id name key:key status:enum created_at:date updated_at:date updated_by'),
    derivedColumns: [],
    fate: 'discard',
  },
  {
    // Berkas milik item (`owner_type = 'item'`) dibuang bersama item. Berkas lain HANYA diimpor bila dirujuk tabel QR
    // yang diimpor (qr_designs.logo_file_id, qr_defaults.logo_file_ids/default_logo_id, qr_presets.default_logo_id);
    // yang tak dirujuk dibuang (`files:tak-dirujuk`, `prepareImport`).
    name: 'files',
    idColumn: 'id',
    columns: cols(
      'id:id drive_id:ref mime size:int width:int height:int owner_type:enum owner_id:ref created_at:date created_by',
    ),
    derivedColumns: ['status'],
    fate: 'import',
    divert: { column: 'owner_type', matches: (value) => value === 'item', as: 'files:item' },
  },
  {
    name: 'handovers',
    idColumn: 'id',
    columns: cols(
      'id:id number:id location_id:ref customer_id:ref customer_name note status:enum checks:json comments:json completed_at:date completed_by created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'discard',
  },
  {
    name: 'items',
    idColumn: 'id',
    columns: cols(
      'id:id external_id:ref brand_id:ref model key:key is_country_lock:enum aliases:json stickers:json accessories:json attachments:json detail_md status:enum sync_rev:int created_at:date updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'discard',
  },
  {
    name: 'qr_designs',
    idColumn: 'id',
    columns: cols(
      'id:id title link_source:enum link document_id:ref subtitle footer logo_file_id:ref layout:json style:json overflow:enum exported_hash exported_at:date exported_by export_pdf_drive_id:ref export_png_drive_id:ref created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'import',
  },
  {
    name: 'qr_documents',
    idColumn: 'id',
    columns: cols(
      'id:id drive_id:ref name size:int shared:enum created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'import',
  },
  {
    name: 'qr_defaults',
    idColumn: 'id',
    columns: cols(
      'id:id title subtitle footer layout:json style:json logo_file_ids:json default_logo_id:ref updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'import',
  },
  {
    name: 'qr_presets',
    idColumn: 'id',
    columns: cols(
      'id:id name title subtitle footer layout:json style:json default_logo_id:ref created_at:date created_by updated_at:date updated_by',
    ),
    derivedColumns: [],
    fate: 'import',
  },
];

/** Sheet yang sengaja tidak diimpor dan tidak diperingatkan (keputusan pemilik 2026-11-06): penghitung server baru. */
export const IGNORED_SHEETS: readonly string[] = ['sync_state', 'counters'];

export function tableDef(name: string): TableDef {
  const found = TABLES.find((table) => table.name === name);
  if (!found) throw new Error(`Tabel ${name} tidak dikenal`);
  return found;
}

/** Kolom yang ditulis ke MariaDB untuk tabel impor (kolom Sheets, lalu kolom turunan). */
export function writtenColumns(def: TableDef): string[] {
  return [...def.columns.map((column) => column.name), ...def.derivedColumns];
}

export const IMPORT_TABLES: readonly TableDef[] = TABLES.filter((table) => table.fate === 'import');
export const DISCARD_TABLES: readonly TableDef[] = TABLES.filter(
  (table) => table.fate === 'discard',
);

/**
 * Urutan INSERT yang aman untuk kunci asing (induk dulu). Tabel yang dibuang tidak ada di sini. `audit_log`
 * memakai id otomatis sehingga urutan baris dump menjadi urutan id.
 */
export const INSERT_ORDER = [
  'users',
  'roles',
  'locations',
  'files',
  'qr_documents',
  'qr_designs',
  'qr_defaults',
  'qr_presets',
  'audit_log',
] as const;

/**
 * Tabel target yang HARUS kosong setelah impor (data uji dibuang atau tak diimpor), anak dulu (handover_comments
 * punya kunci asing ke handovers). `counters` (nomor serah terima harian) dan `sync_state` (revisi sinkron) sengaja
 * TIDAK diimpor (keputusan pemilik 2026-11-06): server baru menghitungnya dari nol. `files` hanya baris
 * `owner_type = 'item'` (lihat `DISCARDED_FILE_OWNER`).
 */
export const DISCARDED_TARGET_TABLES = [
  'handover_comments',
  'handovers',
  'item_alias_keys',
  'items',
  'brands',
  'customers',
  'counters',
  'sync_state',
] as const;

export const DISCARDED_FILE_OWNER = 'item';

export const FILE_OWNER_TYPES = ['', 'qrlogo'] as const;

/**
 * Panjang maksimum kolom VARCHAR di MariaDB (jumlah KARAKTER; migrasi 0001). Nilai Sheets yang lebih panjang
 * dilaporkan sebagai galat per baris sebelum SQL dibuat (mode ketat MariaDB akan membatalkan impor di tengah
 * jalan). Kolom LONGTEXT tidak dibatasi. `import-sheets.test.ts` mencocokkan peta ini dengan information_schema.
 */
export const MAX_LENGTHS: Record<string, Record<string, number>> = Object.fromEntries(
  Object.entries({
    users: 'id=100 email=254 name=255 status=32 created_at=30 updated_at=30 updated_by=255',
    roles: 'id=100 name=255 description=500 created_at=30 updated_at=30 updated_by=255',
    locations: 'id=100 code=32 name=255 status=32 created_at=30 updated_at=30 updated_by=255',
    audit_log: 'ts=30 actor=255 action=64 target=255',
    files:
      'id=100 drive_id=255 mime=100 owner_type=32 owner_id=100 created_at=30 created_by=255 status=16',
    qr_designs:
      'id=100 title=255 link_source=32 link=2048 document_id=100 subtitle=255 footer=255 logo_file_id=100 overflow=8 exported_hash=128 exported_at=30 exported_by=255 export_pdf_drive_id=255 export_png_drive_id=255 created_at=30 created_by=255 updated_at=30 updated_by=255',
    qr_documents:
      'id=100 drive_id=255 name=255 shared=8 created_at=30 created_by=255 updated_at=30 updated_by=255',
    qr_defaults:
      'id=100 title=255 subtitle=255 footer=255 default_logo_id=100 updated_at=30 updated_by=255',
    qr_presets:
      'id=100 name=255 title=255 subtitle=255 footer=255 default_logo_id=100 created_at=30 created_by=255 updated_at=30 updated_by=255',
  }).map(([table, spec]) => [
    table,
    Object.fromEntries(
      spec.split(' ').map((entry) => {
        const [column, length] = entry.split('=');
        return [column as string, Number(length)];
      }),
    ),
  ]),
);

/** Kolom INT 32-bit (bukan BIGINT): `files.width` dan `files.height`. */
export const INT32_COLUMNS: Record<string, readonly string[]> = { files: ['width', 'height'] };
export const INT32_MAX = 2_147_483_647;
