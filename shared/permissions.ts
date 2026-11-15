export const MODULES = [
  'access',
  'item',
  'qrcode',
  'handover',
  'qc',
  'stock',
  'sticker',
  'stickerstock',
  'serial',
  'serialservice',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  access: 'Pengaturan Akses',
  item: 'Data Item',
  qrcode: 'QR Code Label',
  handover: 'Serah Terima QC–WH',
  qc: 'Pengerjaan QC',
  stock: 'Monitoring Stok',
  sticker: 'Katalog Stiker',
  stickerstock: 'Stok Stiker',
  serial: 'Serial Number',
  serialservice: 'Servis Serial Number',
};

export const LEVELS = ['none', 'view', 'edit', 'manage'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  none: 'Tidak ada',
  view: 'Lihat',
  edit: 'Ubah',
  manage: 'Kelola',
};

/**
 * Level yang bermakna per modul, urut dari terendah; `none` selalu ada. Sesuaikan saat fitur modul
 * bertambah: level di luar daftar tidak muncul di form role dan ditolak server.
 */
export const MODULE_LEVELS: Record<ModuleKey, readonly Level[]> = {
  access: ['none', 'view', 'manage'],
  item: ['none', 'view', 'edit', 'manage'],
  qrcode: ['none', 'view', 'edit', 'manage'],
  handover: ['none', 'view', 'edit', 'manage'],
  qc: ['none', 'edit'],
  stock: ['none', 'view'],
  sticker: ['none', 'view', 'edit', 'manage'],
  stickerstock: ['none', 'view', 'edit', 'manage'],
  serial: ['none', 'view', 'edit', 'manage'],
  serialservice: ['none', 'view', 'edit'],
};

/** Arti umum tiap level (PRD §4.2); `MODULE_LEVEL_HINTS` menimpanya bila modul punya makna khusus. */
export const LEVEL_HINTS: Record<Level, string> = {
  none: 'Modul tidak terlihat dan tidak dapat diakses.',
  view: 'Hanya membaca data.',
  edit: 'Membaca serta menambah atau mengubah data.',
  manage: 'Semua akses Ubah, ditambah menghapus, menyetujui, dan pengaturan modul.',
};

export const MODULE_LEVEL_HINTS: Partial<Record<ModuleKey, Partial<Record<Level, string>>>> = {
  access: {
    view: 'Melihat daftar user, role, dan log audit.',
    manage: 'Melihat, serta menambah, mengubah, dan menonaktifkan user dan role.',
  },
  item: {
    view: 'Melihat katalog item dan daftar customer.',
    edit: 'Melihat serta menambah dan mengubah item.',
    manage: 'Semua akses Ubah, ditambah menonaktifkan item dan mengelola customer.',
  },
  qrcode: {
    view: 'Melihat konfigurasi label QR dan mengunduh hasil ekspor.',
    edit: 'Melihat serta membuat, mengubah, dan mengekspor konfigurasi label (Manual Book) ke Drive, termasuk melihat riwayat versi.',
    manage:
      'Semua akses Ubah, ditambah menghapus konfigurasi serta mengelola preset default per BU dan pustaka logo.',
  },
  handover: {
    view: 'Melihat task serah terima di lokasi penugasan.',
    edit: 'Melihat serta membuat dan mengubah isi task serah terima.',
    manage: 'Semua akses Ubah, ditambah membatalkan task.',
  },
  qc: {
    edit: 'Melihat task di lokasi penugasan dan memperbarui progres pengerjaan (qty selesai, tandai selesai).',
  },
  stock: { view: 'Melihat monitoring stok yang belum QC.' },
  sticker: {
    view: 'Melihat katalog jenis dan stiker.',
    edit: 'Menambah dan mengubah jenis dan stiker, termasuk batas minimum.',
    manage:
      'Semua akses Ubah, ditambah menonaktifkan dan mengaktifkan jenis dan stiker serta mengatur Konfigurasi Stiker.',
  },
  stickerstock: {
    view: 'Melihat stok dan riwayat stiker di lokasi penugasan.',
    edit: 'Melihat serta mencatat stok masuk dan keluar.',
    manage: 'Semua akses Ubah, ditambah koreksi dan stok opname.',
  },
  serial: {
    view: 'Melihat serial number pada BU penugasan.',
    edit: 'Melihat serta mencatat serial number dan mengubah datanya.',
    manage: 'Semua akses Ubah, ditambah pengaturan serial number.',
  },
  serialservice: {
    view: 'Melihat serial number dan riwayat servisnya pada BU penugasan.',
    edit: 'Melihat serta menangani servis serial number.',
  },
};

export function levelHint(module: ModuleKey, level: Level): string {
  return MODULE_LEVEL_HINTS[module]?.[level] ?? LEVEL_HINTS[level];
}

export type PermissionMap = Record<ModuleKey, Level>;
export type PartialPermissionMap = Partial<Record<ModuleKey, Level>>;

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function levelsFor(module: ModuleKey): readonly Level[] {
  return MODULE_LEVELS[module];
}

export function isLevelAllowed(module: ModuleKey, level: Level): boolean {
  return MODULE_LEVELS[module].includes(level);
}

/** Level tertinggi yang tersedia di modul dan tidak melebihi `level`; dipakai untuk data lama. */
function clampLevel(module: ModuleKey, level: Level): Level {
  const ceiling = LEVELS.indexOf(level);
  let result: Level = 'none';
  for (const candidate of MODULE_LEVELS[module]) {
    if (LEVELS.indexOf(candidate) <= ceiling) result = candidate;
  }
  return result;
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function hasLevel(actual: Level, required: Level): boolean {
  return levelRank(actual) >= levelRank(required);
}

function permissionsWith(level: Level): PermissionMap {
  const result = {} as PermissionMap;
  for (const module of MODULES) result[module] = level;
  return result;
}

export function emptyPermissions(): PermissionMap {
  return permissionsWith('none');
}

export function fullPermissions(): PermissionMap {
  return permissionsWith('manage');
}

/** Ambil hanya pasangan modul→level yang valid dan bukan `none`; level yang tak tersedia di modul diturunkan. */
export function sanitizePermissions(raw: unknown): PartialPermissionMap {
  const result: PartialPermissionMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (!isModuleKey(key) || !isLevel(value)) continue;
    const level = clampLevel(key, value);
    if (level !== 'none') result[key] = level;
  }
  return result;
}

/** Level efektif = level tertinggi per modul dari semua sumber (role). */
export function mergePermissions(sources: readonly unknown[]): PermissionMap {
  const result = emptyPermissions();
  for (const source of sources) {
    const clean = sanitizePermissions(source);
    for (const module of MODULES) {
      const level = clean[module];
      if (level && levelRank(level) > levelRank(result[module])) result[module] = level;
    }
  }
  return result;
}
