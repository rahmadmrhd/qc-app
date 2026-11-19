// Konstanta jembatan renderer <-> proses utama yang juga dibutuhkan preload. Dipisah dari
// `bridge-contract.ts` (yang memuat zod) agar bundel preload tetap kecil.

/** Versi kontrak jembatan; renderer menolak jembatan di bawah `MIN_BRIDGE_VERSION`. */
export const BRIDGE_VERSION = 9;
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
  draftLoad: 'qc:draft:load',
  draftSave: 'qc:draft:save',
  authStatus: 'qc:auth:status',
  authLogin: 'qc:auth:login',
  authLogout: 'qc:auth:logout',
  uiReload: 'qc:ui:reload',
  catalogGet: 'qc:catalog:get',
  catalogRefresh: 'qc:catalog:refresh',
  catalogStatus: 'qc:catalog:status',
  // Mode Multi-Device (jembatan v9, `MULTI_BRIDGE_VERSION`).
  multiStart: 'qc:multi:start',
  multiStop: 'qc:multi:stop',
  multiScan: 'qc:multi:scan',
  multiSetConcurrency: 'qc:multi:setConcurrency',
  multiSetAutoInject: 'qc:multi:setAutoInject',
  multiInjectDevice: 'qc:multi:injectDevice',
  multiCancelDevice: 'qc:multi:cancelDevice',
  multiInjectAll: 'qc:multi:injectAll',
  multiStopQueue: 'qc:multi:stopQueue',
  multiCancelAll: 'qc:multi:cancelAll',
  multiAddCredential: 'qc:multi:addCredential',
  multiSetBlocked: 'qc:multi:setBlocked',
  multiSetRegistered: 'qc:multi:setRegistered',
  multiPrepareBridge: 'qc:multi:prepareBridge',
  multiSnapshot: 'qc:multi:snapshot',
  multiPendingEvents: 'qc:multi:pendingEvents',
  multiAckInjected: 'qc:multi:ackInjected',
  multiOpenWeb: 'qc:multi:openWeb',
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
/**
 * Snapshot mesin Multi-Device berubah (proses utama -> renderer); isinya `MultiSnapshot` (tanpa sandi). Diperkenalkan
 * di jembatan v9.
 */
export const MULTI_CHANGE_EVENT = 'qc:multi:changed';
/**
 * Jembatan paling rendah yang punya `multi` (mode Multi-Device Ubiquiti, 2026-11-19). UI menyembunyikan mode Multi bila
 * jembatannya lebih rendah; `UI_MIN_BRIDGE_VERSION` TIDAK dinaikkan (mode tunggal tetap jalan di jembatan lama).
 */
export const MULTI_BRIDGE_VERSION = 9;
/** Maks. id peristiwa `injected` per panggilan `multi.ackInjected` (renderer meng-ack per potongan sebesar ini). */
export const MULTI_ACK_MAX = 500;
/** Jembatan paling rendah yang punya `catalog` (katalog Tipe offline); UI yang lebih baru memeriksa versinya sebelum memakai. */
export const CATALOG_BRIDGE_VERSION = 5;
/**
 * Jalur gambar katalog di origin `app://qc`: `/catalog-files/<id>` disajikan proses utama dari cache lokal (id divalidasi
 * ketat; tak ada jalur berkas yang melewati jembatan).
 */
export const CATALOG_FILES_PATH = '/catalog-files/';
/**
 * Jembatan paling rendah yang menerima BU dan lokasi pada `pending.add` (`buId`/`buLabel`/`locationId`/`locationLabel`):
 * skema argumennya ketat, jadi UI yang lebih baru hanya mengirim field itu (dan hanya menampilkan pilihannya) bila
 * jembatannya sudah v6.
 */
export const PENDING_TARGET_BRIDGE_VERSION = 6;
/**
 * Jembatan paling rendah yang menerima `itemId` dan `clientId` pada `pending.add` (bahan unggah ke Serial Number, Fase 5):
 * UI yang lebih baru hanya mengirim field itu dan hanya mengaktifkan tombol Unggah bila jembatannya sudah v7.
 */
export const PENDING_UPLOAD_BRIDGE_VERSION = 7;
/** Jembatan paling rendah yang punya `notifications.onChange`; UI lama/baru tetap berjalan tanpanya (hanya polling). */
export const NOTIFICATIONS_BRIDGE_VERSION = 4;
/**
 * Jembatan paling rendah yang punya `draft` (draft Catat Serial Number di SQLite proses utama; Catat Serial Number
 * bersama, 2026-11-18). UI yang dibangun dari repo ini memakainya, jadi `UI_MIN_BRIDGE_VERSION` mengikutinya.
 */
export const DRAFT_BRIDGE_VERSION = 8;
/** Batas baris snapshot draft (sama dengan `SERIAL_LIMITS.tableRows`; dijaga tes web) dan ukuran JSON-nya. */
export const DRAFT_MAX_ROWS = 1000;
export const DRAFT_MAX_BYTES = 8 * 1024 * 1024;
