// Konstanta jembatan renderer <-> proses utama yang juga dibutuhkan preload. Dipisah dari
// `bridge-contract.ts` (yang memuat zod) agar bundel preload tetap kecil.

/** Versi kontrak jembatan; renderer menolak jembatan di bawah `MIN_BRIDGE_VERSION`. */
export const BRIDGE_VERSION = 3;
export const MIN_BRIDGE_VERSION = 1;

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
} as const satisfies Record<string, string>;

/** Kanal peristiwa satu arah proses utama -> renderer (`webContents.send`); bukan `handle`. */
export const INJECT_PROGRESS_EVENT = 'qc:inject:progress';
/** Peristiwa status login berubah (proses utama -> renderer); isinya hanya `AuthStatus`, tanpa token. */
export const AUTH_CHANGE_EVENT = 'qc:auth:change';
/** Bundel UI baru sudah diunduh dan diverifikasi (proses utama -> renderer); isinya `UiUpdateInfo`. */
export const UI_UPDATE_READY_EVENT = 'qc:ui:updateReady';
