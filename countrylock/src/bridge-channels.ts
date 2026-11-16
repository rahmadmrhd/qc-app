// Konstanta jembatan renderer <-> proses utama yang juga dibutuhkan preload. Dipisah dari
// `bridge-contract.ts` (yang memuat zod) agar bundel preload tetap kecil.

/** Versi kontrak jembatan; renderer menolak jembatan di bawah `MIN_BRIDGE_VERSION`. */
export const BRIDGE_VERSION = 5;
export const MIN_BRIDGE_VERSION = 2;

/** Kanal `ipcMain.handle` (permintaan-jawaban): `qc:<grup>:<aksi>`. */
export const BRIDGE_CHANNELS = {
  packageLoad: 'qc:package:load',
  packageChooseDir: 'qc:package:chooseDir',
  devicePing: 'qc:device:ping',
  deviceReadInfo: 'qc:device:readInfo',
  deviceReadRouterInfo: 'qc:device:readRouterInfo',
  injectRun: 'qc:inject:run',
  injectCancel: 'qc:inject:cancel',
  pendingList: 'qc:pending:list',
  pendingAdd: 'qc:pending:add',
  pendingRemove: 'qc:pending:remove',
  authStatus: 'qc:auth:status',
  authLogin: 'qc:auth:login',
  authLogout: 'qc:auth:logout',
  uiReload: 'qc:ui:reload',
  catalogGet: 'qc:catalog:get',
  catalogRefresh: 'qc:catalog:refresh',
  catalogStatus: 'qc:catalog:status',
} as const satisfies Record<string, string>;

/** Kanal peristiwa satu arah proses utama -> renderer (`webContents.send`); bukan `handle`. */
export const INJECT_PROGRESS_EVENT = 'qc:inject:progress';
/** Peristiwa status login berubah (proses utama -> renderer); isinya hanya `AuthStatus`, tanpa token. */
export const AUTH_CHANGE_EVENT = 'qc:auth:change';
/** Bundel UI baru sudah diunduh dan diverifikasi (proses utama -> renderer); isinya `UiUpdateInfo`. */
export const UI_UPDATE_READY_EVENT = 'qc:ui:updateReady';
/**
 * Ada notifikasi baru dari aliran SSE proses utama (proses utama -> renderer). TANPA muatan: renderer hanya memuat
 * ulang lonceng lewat API (izin dan isi tetap dari jalur baca). Diperkenalkan di jembatan v4.
 */
export const NOTIFICATIONS_CHANGE_EVENT = 'qc:notifications:changed';
/** Katalog Tipe offline berubah (proses utama -> renderer); isinya hanya `CatalogStatus`. Diperkenalkan di jembatan v5. */
export const CATALOG_CHANGE_EVENT = 'qc:catalog:changed';
/** Jembatan paling rendah yang punya `catalog` (katalog Tipe offline); UI yang lebih baru memeriksa versinya sebelum memakai. */
export const CATALOG_BRIDGE_VERSION = 5;
/**
 * Jalur gambar katalog di origin `app://qc`: `/catalog-files/<id>` disajikan proses utama dari cache lokal (id divalidasi
 * ketat; tak ada jalur berkas yang melewati jembatan).
 */
export const CATALOG_FILES_PATH = '/catalog-files/';
/** Jembatan paling rendah yang punya `notifications.onChange`; UI lama/baru tetap berjalan tanpanya (hanya polling). */
export const NOTIFICATIONS_BRIDGE_VERSION = 4;
