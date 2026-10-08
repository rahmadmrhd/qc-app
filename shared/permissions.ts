export const MODULES = ['access', 'item', 'handover', 'stock'] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  access: 'Pengaturan Akses',
  item: 'Data Item',
  handover: 'Serah Terima QC–WH',
  stock: 'Monitoring Stok',
};

export const LEVELS = ['none', 'view', 'edit', 'manage'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  none: 'Tidak ada',
  view: 'Lihat',
  edit: 'Ubah',
  manage: 'Kelola',
};

export type PermissionMap = Record<ModuleKey, Level>;
export type PartialPermissionMap = Partial<Record<ModuleKey, Level>>;

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
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

/** Ambil hanya pasangan modul→level yang valid dan bukan `none`. */
export function sanitizePermissions(raw: unknown): PartialPermissionMap {
  const result: PartialPermissionMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (isModuleKey(key) && isLevel(value) && value !== 'none') result[key] = value;
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
