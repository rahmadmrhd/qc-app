// Jembatan palsu untuk tes (hanya diimpor berkas `*.test.tsx`; tidak pernah dijangkau dari kode
// produksi, sehingga tidak ikut build). Perilaku bawaan: perangkat dan router menjawab ping,
// serial terbaca, inject sukses dan mengirim progres.

import { BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type {
  AuthStatus,
  CatalogStatus,
  InjectedEvent,
  InjectProgressDto,
  InjectRequest,
  InjectResult,
  MultiDeviceDto,
  MultiSnapshot,
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
  draft?: Partial<QcBridge['draft']>;
  auth?: Partial<QcBridge['auth']>;
  ui?: Partial<QcBridge['ui']>;
  catalog?: Partial<QcBridge['catalog']>;
  notifications?: Partial<QcBridge['notifications']>;
  multi?: Partial<QcBridge['multi']>;
  app?: Partial<QcBridge['app']>;
};

/** Satu panggilan ke `bridge.multi.*` (nama metode + argumen), dipakai tes untuk memeriksa aksi dan urutannya. */
export interface MultiCall {
  name: string;
  args: unknown[];
}

export interface FakeBridge extends QcBridge {
  /** Mengirim peristiwa progres ke semua pendengar (id bawaan: inject terakhir yang dijalankan). */
  emitProgress(progress: InjectProgressDto, id?: string): void;
  /** Daftar pending di memori (dipakai tes untuk memeriksa pencatatan). */
  readonly pendingList: PendingEntry[];
  /** Snapshot draft di memori (dipakai tes untuk memeriksa penyimpanan draft). */
  readonly draftRows: unknown[];
  /** Permintaan inject yang pernah diterima. */
  readonly injectRequests: InjectRequest[];
  /** Semua panggilan `multi.*` (kecuali `snapshot`, `pendingEvents`, `onChange`) menurut urutan. */
  readonly multiCalls: MultiCall[];
  /** Peristiwa `injected` yang belum di-ack (tes mengisinya; `ackInjected` membuangnya). */
  readonly multiEvents: InjectedEvent[];
  /** Snapshot Multi saat ini (tes dapat menggantinya lewat `emitMulti`). */
  readonly multiState: MultiSnapshot;
  /** Menetapkan snapshot Multi lalu memberitahu semua pendengar `multi.onChange`. */
  emitMulti(patch: Partial<MultiSnapshot>): void;
}

export function createFakeMultiDevice(overrides: Partial<MultiDeviceDto> = {}): MultiDeviceDto {
  return {
    mac: 'AA:BB:CC:DD:EE:01',
    ip: '192.168.88.21',
    status: 'ready',
    message: 'Siap inject',
    pingable: true,
    model: 'NanoStation M2',
    serial: 'AABBCCDDEE01',
    country: 'indonesia',
    credentialsExhausted: false,
    alreadyRegistered: false,
    injectedThisSession: false,
    log: [],
    credentialSource: 'Default',
    ...overrides,
  };
}

/** Hitungan ringkasan sama dengan `countDevices` engine (dipakai agar snapshot palsu selaras). */
export function createFakeMultiSnapshot(
  patch: Partial<MultiSnapshot> = {},
  devices: MultiDeviceDto[] = patch.devices ?? [],
): MultiSnapshot {
  const counts = { waiting: 0, queued: 0, injecting: 0, success: 0, failed: 0, active: 0 };
  for (const d of devices) {
    if (d.status === 'queued') counts.queued += 1;
    else if (d.status === 'injecting') counts.injecting += 1;
    else if (d.status === 'success') counts.success += 1;
    else if (d.status === 'failed') counts.failed += 1;
    else if (d.status !== 'disconnected') counts.waiting += 1;
    if (d.status !== 'disconnected') counts.active += 1;
  }
  return {
    running: false,
    blockedReason: null,
    queueStopped: false,
    autoInject: false,
    concurrency: 4,
    credentialCount: 0,
    message: '',
    injectedSeq: 0,
    counts,
    ...patch,
    devices,
  };
}

export const FAKE_BRAND_PASSWORD = 'sandi-bawaan-merk';

const DISABLED_CATALOG: CatalogStatus = {
  state: 'disabled',
  itemCount: 0,
  syncedAt: null,
  error: null,
};

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
  const draftRows: unknown[] = [];
  const injectRequests: InjectRequest[] = [];
  let lastInjectId = '';
  const multiCalls: MultiCall[] = [];
  const multiEvents: InjectedEvent[] = [];
  const multiListeners = new Set<(s: MultiSnapshot) => void>();
  let multiState = createFakeMultiSnapshot();
  const setMulti = (patch: Partial<MultiSnapshot>) => {
    const devices = patch.devices ?? multiState.devices;
    const { counts: _counts, ...rest } = multiState;
    multiState = createFakeMultiSnapshot({ ...rest, ...patch }, devices);
    for (const listener of [...multiListeners]) listener(multiState);
  };
  // Metode `multi` bawaan: mencatat panggilan dan menjaga keadaan sederhana; tes menimpa lewat `overrides.multi`.
  const record =
    <A extends unknown[]>(name: string, apply?: (...args: A) => void) =>
    async (...args: A): Promise<void> => {
      multiCalls.push({ name, args });
      apply?.(...args);
    };

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
    // Bawaan: katalog dinonaktifkan (build tanpa token); tes katalog menimpa.
    catalog: {
      get: async () => null,
      refresh: async (): Promise<CatalogStatus> => DISABLED_CATALOG,
      status: async (): Promise<CatalogStatus> => DISABLED_CATALOG,
      onChange: () => () => undefined,
      ...overrides.catalog,
    },
    notifications: {
      onChange: () => () => undefined,
      ...overrides.notifications,
    },
    // Bawaan: pembaruan otomatis tak aktif; tes layar penahan menimpa.
    app: {
      version: async () => '0.0.0',
      update: async () => ({
        status: 'unavailable' as const,
        message: 'Pembaruan otomatis tidak aktif di instalasi ini',
      }),
      openDownloads: async () => undefined,
      ...overrides.app,
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
    draft: {
      load: async () => structuredClone(draftRows),
      save: async (rows) => {
        draftRows.splice(0, draftRows.length, ...structuredClone([...rows]));
      },
      ...overrides.draft,
    },
    multi: {
      start: record('start', (cfg: Parameters<QcBridge['multi']['start']>[0]) =>
        setMulti({
          running: true,
          concurrency: cfg.concurrency,
          autoInject: cfg.autoInject,
          queueStopped: false,
        }),
      ),
      stop: record('stop', () => setMulti({ running: false, devices: [] })),
      scan: record('scan'),
      setConcurrency: record('setConcurrency', (n: number) => setMulti({ concurrency: n })),
      setAutoInject: record('setAutoInject', (on: boolean) => setMulti({ autoInject: on })),
      injectDevice: record('injectDevice'),
      cancelDevice: record('cancelDevice'),
      injectAll: record('injectAll'),
      stopQueue: record('stopQueue'),
      cancelAll: record('cancelAll'),
      addCredential: record('addCredential', () =>
        setMulti({ credentialCount: multiState.credentialCount + 1 }),
      ),
      setBlocked: record('setBlocked', (reason: string | null) =>
        setMulti({ blockedReason: reason }),
      ),
      setRegistered: record('setRegistered'),
      prepareBridge: async () => {
        multiCalls.push({ name: 'prepareBridge', args: [] });
        return { ok: true, message: 'Bridge router siap' };
      },
      snapshot: async () => multiState,
      pendingEvents: async () => structuredClone(multiEvents),
      ackInjected: record('ackInjected', (ids: readonly string[]) => {
        for (const id of ids) {
          const at = multiEvents.findIndex((e) => e.eventId === id);
          if (at >= 0) multiEvents.splice(at, 1);
        }
      }),
      openWeb: record('openWeb'),
      onChange: (cb) => {
        multiListeners.add(cb);
        return () => {
          multiListeners.delete(cb);
        };
      },
      ...overrides.multi,
    },
    emitProgress: (progress, id) => emit({ id: id ?? lastInjectId, ...progress }),
    pendingList,
    draftRows,
    injectRequests,
    multiCalls,
    multiEvents,
    get multiState() {
      return multiState;
    },
    emitMulti: setMulti,
  };
}
