// Jembatan palsu untuk tes (hanya diimpor berkas `*.test.tsx`; tidak pernah dijangkau dari kode
// produksi, sehingga tidak ikut build). Perilaku bawaan: perangkat dan router menjawab ping,
// serial terbaca, inject sukses dan mengirim progres.

import { BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type {
  AuthStatus,
  InjectProgressDto,
  InjectRequest,
  InjectResult,
  PackageDto,
  QcBridge,
} from '@countrylock/bridge-contract';
import { addPending, type PendingEntry } from '@countrylock/pending';

export type FakeOverrides = {
  version?: number;
  package?: Partial<QcBridge['package']>;
  device?: Partial<QcBridge['device']>;
  inject?: Partial<QcBridge['inject']>;
  pending?: Partial<QcBridge['pending']>;
  auth?: Partial<QcBridge['auth']>;
  ui?: Partial<QcBridge['ui']>;
  notifications?: Partial<QcBridge['notifications']>;
};

export interface FakeBridge extends QcBridge {
  /** Mengirim peristiwa progres ke semua pendengar (id bawaan: inject terakhir yang dijalankan). */
  emitProgress(progress: InjectProgressDto, id?: string): void;
  /** Daftar pending di memori (dipakai tes untuk memeriksa pencatatan). */
  readonly pendingList: PendingEntry[];
  /** Permintaan inject yang pernah diterima. */
  readonly injectRequests: InjectRequest[];
}

export const FAKE_BRAND_PASSWORD = 'sandi-bawaan-merk';

export function createFakePackage(overrides: Partial<PackageDto> = {}): PackageDto {
  const mode = { ip: '192.168.1.20', ipServer: '192.168.1.1', connectVia: 'Server' as const };
  return {
    dir: 'C:\\paket-skrip',
    config: {
      server: {
        ip: '192.168.88.1',
        username: 'admin',
        password: '',
        interfaceComp: 'ether1',
        interfaceList: ['ether1', 'ether2', 'ether3'],
        interfaceBridge: 'bridge1',
      },
      brands: {
        mikrotik: {
          brand: 'mikrotik',
          label: 'Mikrotik',
          folder: 'MIKROTIK',
          username: 'admin',
          password: FAKE_BRAND_PASSWORD,
          web: 'http://{ip}',
          firmware: [
            { code: 'AC', label: 'AC 6.x', file: 'ac.txt' },
            { code: 'WA', label: 'WA 7.x', file: 'wa.txt' },
          ],
          single: { ...mode, interfaceBridge: 'bridge1' },
          multi: { ...mode, ip: '', interfaceBridge: 'bridge1' },
        },
        ubiquiti: {
          brand: 'ubiquiti',
          label: 'Ubiquiti',
          folder: 'UBIQUITI',
          username: 'ubnt',
          password: 'ubnt',
          web: 'https://{ip}',
          firmware: [{ code: 'XW', label: 'XW', file: 'xw.txt' }],
          single: { ...mode, connectVia: 'Target', interfaceBridge: 'bridge1' },
          multi: { ...mode, ip: '', connectVia: 'Target', interfaceBridge: 'bridge1' },
        },
      },
      raw: null,
    },
    missing: [],
    warnings: [],
    ...overrides,
  };
}

export function createFakeBridge(overrides: FakeOverrides = {}): FakeBridge {
  const listeners = new Set<(e: { id: string } & InjectProgressDto) => void>();
  const pendingList: PendingEntry[] = [];
  const injectRequests: InjectRequest[] = [];
  let lastInjectId = '';

  const emit = (e: { id: string } & InjectProgressDto) => {
    for (const listener of [...listeners]) listener(e);
  };

  const defaultRun = async (req: InjectRequest): Promise<InjectResult> => {
    emit({ id: req.id, stage: 'connecting', message: 'Menghubungkan ke perangkat' });
    emit({ id: req.id, stage: 'running', message: 'Skrip berjalan' });
    return { ok: true, stage: 'completed', message: 'Inject selesai' };
  };
  const run = overrides.inject?.run ?? defaultRun;

  return {
    version: overrides.version ?? BRIDGE_VERSION,
    package: {
      load: async () => createFakePackage(),
      chooseDir: async () => createFakePackage(),
      ...overrides.package,
    },
    device: {
      ping: async () => ({ ok: true, kind: 'success' as const }),
      readInfo: async () => ({
        ok: true as const,
        info: { model: 'RB941', serial: 'ABC123', country: 'indonesia' },
      }),
      readRouterInfo: async () => ({ ok: true as const, serial: 'ROUTER1', model: 'RB2011' }),
      ...overrides.device,
    },
    inject: {
      cancel: async () => undefined,
      onProgress: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      ...overrides.inject,
      // Dibungkus agar id terakhir tercatat (dipakai `emitProgress`) dan permintaan dapat diperiksa.
      run: async (req) => {
        lastInjectId = req.id;
        injectRequests.push(req);
        return run(req);
      },
    },
    auth: {
      status: async (): Promise<AuthStatus> => ({
        signedIn: false,
        email: null,
        serverUrl: 'https://qc.rhd.my.id',
      }),
      login: async () => undefined,
      logout: async () => undefined,
      onChange: () => () => undefined,
      ...overrides.auth,
    },
    ui: {
      onUpdateReady: () => () => undefined,
      reload: async () => undefined,
      ...overrides.ui,
    },
    notifications: {
      onChange: () => () => undefined,
      ...overrides.notifications,
    },
    pending: {
      list: async () => [...pendingList],
      add: async (entry) => {
        const { list, result } = addPending(pendingList, entry);
        pendingList.splice(0, pendingList.length, ...list);
        return result;
      },
      remove: async (serial) => {
        const index = pendingList.findIndex((e) => e.serial === serial);
        if (index >= 0) pendingList.splice(index, 1);
      },
      ...overrides.pending,
    },
    emitProgress: (progress, id) => emit({ id: id ?? lastInjectId, ...progress }),
    pendingList,
    injectRequests,
  };
}
