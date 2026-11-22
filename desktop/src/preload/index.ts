// Preload (CommonJS, ter-sandbox): satu-satunya jembatan renderer -> proses utama. Hanya fungsi
// berparameter data yang diekspos (`window.qcBridge`); objek `ipcRenderer`, peristiwa mentah, dan
// jalur berkas tidak pernah sampai ke renderer. Validasi ada di proses utama (`ipc.ts`).

import {
  AUTH_CHANGE_EVENT,
  BRIDGE_CHANNELS,
  BRIDGE_VERSION,
  CATALOG_CHANGE_EVENT,
  INJECT_PROGRESS_EVENT,
  MULTI_CHANGE_EVENT,
  NOTIFICATIONS_CHANGE_EVENT,
  UI_UPDATE_READY_EVENT,
} from '@countrylock/bridge-channels';
import type { QcBridge } from '@countrylock/bridge-contract';
import { contextBridge, ipcRenderer } from 'electron';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const bridge: QcBridge = {
  version: BRIDGE_VERSION,
  package: {
    load: () => invoke(BRIDGE_CHANNELS.packageLoad),
    chooseDir: () => invoke(BRIDGE_CHANNELS.packageChooseDir),
  },
  device: {
    ping: (host) => invoke(BRIDGE_CHANNELS.devicePing, host),
    readInfo: (req) => invoke(BRIDGE_CHANNELS.deviceReadInfo, req),
    readRouterInfo: (req) => invoke(BRIDGE_CHANNELS.deviceReadRouterInfo, req),
  },
  inject: {
    run: (req) => invoke(BRIDGE_CHANNELS.injectRun, req),
    cancel: (id) => invoke(BRIDGE_CHANNELS.injectCancel, id),
    onProgress: (cb) => {
      // Hanya data progres yang diteruskan; objek `event` Electron tidak bocor ke renderer.
      const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on(INJECT_PROGRESS_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(INJECT_PROGRESS_EVENT, listener);
      };
    },
  },
  auth: {
    status: () => invoke(BRIDGE_CHANNELS.authStatus),
    login: () => invoke(BRIDGE_CHANNELS.authLogin),
    logout: () => invoke(BRIDGE_CHANNELS.authLogout),
    onChange: (cb) => {
      // Hanya `AuthStatus` (tanpa token) yang diteruskan; objek `event` Electron tidak bocor.
      const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on(AUTH_CHANGE_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(AUTH_CHANGE_EVENT, listener);
      };
    },
  },
  ui: {
    onUpdateReady: (cb) => {
      // Hanya `UiUpdateInfo` yang diteruskan; objek `event` Electron tidak bocor ke renderer.
      const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on(UI_UPDATE_READY_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(UI_UPDATE_READY_EVENT, listener);
      };
    },
    reload: () => invoke(BRIDGE_CHANNELS.uiReload),
  },
  app: {
    version: () => invoke(BRIDGE_CHANNELS.appVersion),
    update: () => invoke(BRIDGE_CHANNELS.appUpdate),
    openDownloads: () => invoke(BRIDGE_CHANNELS.appOpenDownloads),
  },
  catalog: {
    get: () => invoke(BRIDGE_CHANNELS.catalogGet),
    refresh: () => invoke(BRIDGE_CHANNELS.catalogRefresh),
    status: () => invoke(BRIDGE_CHANNELS.catalogStatus),
    onChange: (cb) => {
      // Hanya `CatalogStatus` (tanpa token) yang diteruskan; objek `event` Electron tidak bocor ke renderer.
      const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on(CATALOG_CHANGE_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(CATALOG_CHANGE_EVENT, listener);
      };
    },
  },
  notifications: {
    onChange: (cb) => {
      // Sinyal tanpa muatan: argumen `event` Electron tidak diteruskan ke renderer.
      const listener = (): void => cb();
      ipcRenderer.on(NOTIFICATIONS_CHANGE_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(NOTIFICATIONS_CHANGE_EVENT, listener);
      };
    },
  },
  pending: {
    list: () => invoke(BRIDGE_CHANNELS.pendingList),
    add: (entry) => invoke(BRIDGE_CHANNELS.pendingAdd, entry),
    remove: (serial) => invoke(BRIDGE_CHANNELS.pendingRemove, serial),
  },
  draft: {
    load: () => invoke(BRIDGE_CHANNELS.draftLoad),
    save: (rows) => invoke(BRIDGE_CHANNELS.draftSave, rows),
  },
  multi: {
    start: (cfg) => invoke(BRIDGE_CHANNELS.multiStart, cfg),
    stop: () => invoke(BRIDGE_CHANNELS.multiStop),
    scan: () => invoke(BRIDGE_CHANNELS.multiScan),
    setConcurrency: (n) => invoke(BRIDGE_CHANNELS.multiSetConcurrency, n),
    setAutoInject: (on) => invoke(BRIDGE_CHANNELS.multiSetAutoInject, on),
    injectDevice: (mac) => invoke(BRIDGE_CHANNELS.multiInjectDevice, mac),
    cancelDevice: (mac) => invoke(BRIDGE_CHANNELS.multiCancelDevice, mac),
    injectAll: () => invoke(BRIDGE_CHANNELS.multiInjectAll),
    stopQueue: () => invoke(BRIDGE_CHANNELS.multiStopQueue),
    cancelAll: () => invoke(BRIDGE_CHANNELS.multiCancelAll),
    addCredential: (cred) => invoke(BRIDGE_CHANNELS.multiAddCredential, cred),
    setBlocked: (reason) => invoke(BRIDGE_CHANNELS.multiSetBlocked, reason),
    // Salinan array biasa: argumen `readonly` dari renderer dikloning struktural oleh IPC.
    setRegistered: (serials) => invoke(BRIDGE_CHANNELS.multiSetRegistered, [...serials]),
    prepareBridge: () => invoke(BRIDGE_CHANNELS.multiPrepareBridge),
    snapshot: () => invoke(BRIDGE_CHANNELS.multiSnapshot),
    pendingEvents: () => invoke(BRIDGE_CHANNELS.multiPendingEvents),
    ackInjected: (eventIds) => invoke(BRIDGE_CHANNELS.multiAckInjected, [...eventIds]),
    openWeb: (mac) => invoke(BRIDGE_CHANNELS.multiOpenWeb, mac),
    onChange: (cb) => {
      // Hanya `MultiSnapshot` (tanpa sandi) yang diteruskan; objek `event` Electron tidak bocor ke renderer.
      const listener = (_event: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on(MULTI_CHANGE_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(MULTI_CHANGE_EVENT, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('qcBridge', bridge);
