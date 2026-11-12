// Preload (CommonJS, ter-sandbox): satu-satunya jembatan renderer -> proses utama. Hanya fungsi
// berparameter data yang diekspos (`window.qcBridge`); objek `ipcRenderer`, peristiwa mentah, dan
// jalur berkas tidak pernah sampai ke renderer. Validasi ada di proses utama (`ipc.ts`).

import {
  BRIDGE_CHANNELS,
  BRIDGE_VERSION,
  INJECT_PROGRESS_EVENT,
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
  pending: {
    list: () => invoke(BRIDGE_CHANNELS.pendingList),
    add: (entry) => invoke(BRIDGE_CHANNELS.pendingAdd, entry),
    remove: (serial) => invoke(BRIDGE_CHANNELS.pendingRemove, serial),
  },
};

contextBridge.exposeInMainWorld('qcBridge', bridge);
