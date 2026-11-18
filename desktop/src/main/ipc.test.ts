import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BRIDGE_CHANNELS,
  hasControlChars,
  type InjectProgressDto,
} from '@countrylock/bridge-contract';
import { secretForms } from '@countrylock/script-template';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type IpcDeps, type IpcEventLike, registerIpc } from './ipc';
import { type LoadedPackage, loadLocalPackage, PackageError } from './package/local-folder';
import { DEFAULT_SERVER_URL, type Settings } from './settings';
import type { InjectOptions, InjectOutcome } from './ssh/inject-session';
import { SENTINEL_BY_BRAND } from './ssh/strategy';
import { openDraftStore } from './store/draft-store';
import { openPendingStore } from './store/pending-store';

const FIXTURE = resolve(__dirname, '../../../countrylock/fixtures/country-lock2');
const SERVER_PASSWORD = 'Srv#Pw!9';

type Listener = (event: IpcEventLike, ...args: unknown[]) => unknown;

let tmp: string;
let fixturePkg: LoadedPackage;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'qc-ipc-'));
  const real = await loadLocalPackage(FIXTURE);
  // Paket uji: kata sandi server diisi agar penyamaran sandi server dapat diuji.
  fixturePkg = {
    ...real,
    config: { ...real.config, server: { ...real.config.server, password: SERVER_PASSWORD } },
  };
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function setup(overrides: Partial<IpcDeps> = {}, packageDir: string | null = 'D:\\Paket') {
  const handlers = new Map<string, Listener>();
  const store = openPendingStore(join(tmp, 'pending.db'));
  const draftStore = openDraftStore(join(tmp, 'draft.db'));
  // Tes menutup `store` di akhir; draft ikut ditutup agar berkasnya tak terkunci (Windows).
  const closePending = store.close.bind(store);
  store.close = () => {
    closePending();
    draftStore.close();
  };
  const progress: Array<{ id: string } & InjectProgressDto> = [];
  const saved: Settings = { packageDir, serverUrl: DEFAULT_SERVER_URL };
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, listener) => void handlers.set(channel, listener) },
    settings: {
      get: () => ({ ...saved }),
      set: (next) => Object.assign(saved, next),
    },
    loadPackage: vi.fn(async () => fixturePkg),
    chooseDirectory: vi.fn(async () => 'D:\\Paket'),
    ping: vi.fn(async () => ({ ok: true, kind: 'success' as const })),
    readDeviceInfo: vi.fn(async () => ({
      ok: true as const,
      info: { model: 'm', serial: 's', country: 'c' },
    })),
    readRouterInfo: vi.fn(async () => ({ ok: true as const, serial: 's', model: 'm' })),
    fetchHostKey: vi.fn(async () => ({ type: 'ssh-rsa', base64: 'QUFBQUhPU1RLRVk=' })),
    runInject: vi.fn(async (): Promise<InjectOutcome> => ({ ok: true, reason: 'completed' })),
    pending: store,
    draft: draftStore,
    auth: {
      status: vi.fn(() => ({ signedIn: false, email: null, serverUrl: DEFAULT_SERVER_URL })),
      start: vi.fn(async () => undefined),
      logout: vi.fn(),
    },
    catalog: {
      snapshot: vi.fn(() => null),
      status: vi.fn(() => ({ state: 'idle' as const, itemCount: 0, syncedAt: null, error: null })),
      refresh: vi.fn(async () => ({
        state: 'ok' as const,
        itemCount: 2,
        syncedAt: '2026-11-16T10:00:00.000Z',
        error: null,
      })),
    },
    ui: { reload: vi.fn(async () => undefined) },
    emitProgress: (e) => progress.push(e),
    ...overrides,
  };
  const ipc = registerIpc(deps);
  const call = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`kanal tak terdaftar: ${channel}`);
    return Promise.resolve(handler({}, ...args));
  };
  return { deps, handlers, call, progress, saved, store, ipc };
}

const injectReq = (patch: Record<string, unknown> = {}) => ({
  id: 'run-1',
  brand: 'mikrotik',
  firmwareCode: 'AC',
  target: { ip: '192.168.88.1', username: 'admin', password: 'Pa$$w"rd?' },
  ...patch,
});

describe('registerIpc', () => {
  test('setiap kanal di BRIDGE_CHANNELS punya handler terdaftar dan sebaliknya', () => {
    const { handlers, store } = setup();
    expect([...handlers.keys()].sort()).toEqual(Object.values(BRIDGE_CHANNELS).sort());
    store.close();
  });

  test('handler menolak argumen tak valid sebelum menyentuh layanan', async () => {
    const { deps, call, store } = setup();
    const device = { brand: 'mikrotik', host: '10.0.0.1', username: 'admin', password: 'x' };
    const entry = {
      serial: 'AB12',
      brand: 'none',
      tipe: 't',
      date: '2026-11-12',
      timestamp: '2026-11-12T08:00:00.000Z',
    };
    const bad: Array<[string, unknown[]]> = [
      [BRIDGE_CHANNELS.devicePing, ['a;b']],
      [BRIDGE_CHANNELS.devicePing, ['']],
      [BRIDGE_CHANNELS.devicePing, []],
      [BRIDGE_CHANNELS.devicePing, ['10.0.0.1', 'lebih']],
      [BRIDGE_CHANNELS.devicePing, [{ host: '10.0.0.1' }]],
      [BRIDGE_CHANNELS.deviceReadInfo, [{ ...device, host: 'a b' }]],
      [BRIDGE_CHANNELS.deviceReadInfo, [{ ...device, username: '' }]],
      [BRIDGE_CHANNELS.deviceReadInfo, [{ ...device, password: 'x'.repeat(257) }]],
      [BRIDGE_CHANNELS.deviceReadRouterInfo, [{ ...device, brand: 'cisco' }]],
      [BRIDGE_CHANNELS.injectRun, [injectReq({ id: '' })]],
      [BRIDGE_CHANNELS.injectRun, [injectReq({ firmwareCode: '' })]],
      [BRIDGE_CHANNELS.injectRun, [{ ...injectReq(), scriptPath: 'C:\\x.txt' }]],
      [BRIDGE_CHANNELS.injectCancel, ['']],
      [BRIDGE_CHANNELS.injectCancel, ['../x']],
      [BRIDGE_CHANNELS.pendingAdd, [{ ...entry, serial: '' }]],
      [BRIDGE_CHANNELS.pendingAdd, [{ ...entry, date: 'kemarin' }]],
      [BRIDGE_CHANNELS.pendingRemove, ['']],
      [BRIDGE_CHANNELS.pendingList, ['jalur']],
      [BRIDGE_CHANNELS.draftLoad, ['jalur']],
      [BRIDGE_CHANNELS.draftSave, []],
      [BRIDGE_CHANNELS.draftSave, [['bukan objek']]],
      [BRIDGE_CHANNELS.draftSave, [[{ serial: 'A' }], 'lebih']],
      [BRIDGE_CHANNELS.packageLoad, ['D:\\Lain']],
      [BRIDGE_CHANNELS.packageChooseDir, ['D:\\Lain']],
    ];
    for (const [channel, args] of bad) {
      await expect(call(channel, ...args), channel).rejects.toThrow(/Argumen tidak valid/);
    }
    expect(deps.ping).not.toHaveBeenCalled();
    expect(deps.readDeviceInfo).not.toHaveBeenCalled();
    expect(deps.readRouterInfo).not.toHaveBeenCalled();
    expect(deps.runInject).not.toHaveBeenCalled();
    expect(deps.fetchHostKey).not.toHaveBeenCalled();
    expect(deps.chooseDirectory).not.toHaveBeenCalled();
    expect(deps.loadPackage).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
    store.close();
  });

  test('pesan galat validasi tidak memuat nilai yang dikirim (mis. kata sandi)', async () => {
    const { call, store } = setup();
    const error = await call(BRIDGE_CHANNELS.deviceReadInfo, {
      brand: 'mikrotik',
      host: 'host salah',
      username: 'admin',
      password: 'RahasiaBanget',
    }).catch((e: unknown) => e as Error);
    expect((error as Error).message).not.toContain('RahasiaBanget');
    store.close();
  });

  test('pengirim tak dipercaya ditolak sebelum validasi dan layanan', async () => {
    const { deps, call, store } = setup({ isTrustedSender: () => false });
    await expect(call(BRIDGE_CHANNELS.devicePing, '10.0.0.1')).rejects.toThrow(/tidak dipercaya/);
    expect(deps.ping).not.toHaveBeenCalled();
    store.close();
  });

  test('galat tak terduga dari layanan menjadi pesan generik tanpa isi aslinya', async () => {
    const { call, store } = setup({
      ping: vi.fn(async () => {
        throw new Error('gagal dengan sandi RahasiaBanget');
      }),
    });
    const error = (await call(BRIDGE_CHANNELS.devicePing, '10.0.0.1').catch(
      (e: unknown) => e,
    )) as Error;
    expect(error.message).toBe('Terjadi galat pada proses utama');
    expect(error.message).not.toContain('RahasiaBanget');
    store.close();
  });

  test('ping, info perangkat, dan info router meneruskan argumen tervalidasi', async () => {
    const { deps, call, store } = setup();
    expect(await call(BRIDGE_CHANNELS.devicePing, '192.168.88.1')).toEqual({
      ok: true,
      kind: 'success',
    });
    expect(deps.ping).toHaveBeenCalledWith('192.168.88.1', 1000);
    const req = { brand: 'ubiquiti', host: '10.0.0.5', username: 'ubnt', password: 'ubnt' };
    await call(BRIDGE_CHANNELS.deviceReadInfo, req);
    expect(deps.readDeviceInfo).toHaveBeenCalledWith('ubiquiti', {
      host: '10.0.0.5',
      username: 'ubnt',
      password: 'ubnt',
    });
    await call(BRIDGE_CHANNELS.deviceReadRouterInfo, req);
    expect(deps.readRouterInfo).toHaveBeenCalledWith({
      host: '10.0.0.5',
      username: 'ubnt',
      password: 'ubnt',
    });
    store.close();
  });

  describe('paket', () => {
    test('load tanpa paket terpilih mengembalikan null tanpa memuat apa pun', async () => {
      const { deps, call, store } = setup({}, null);
      expect(await call(BRIDGE_CHANNELS.packageLoad)).toBeNull();
      expect(deps.loadPackage).not.toHaveBeenCalled();
      store.close();
    });

    test('chooseDir: dialog proses utama, simpan pengaturan, DTO tanpa skrip/sandi server/raw', async () => {
      const { deps, call, saved, store } = setup({}, null);
      const dto = (await call(BRIDGE_CHANNELS.packageChooseDir)) as Record<string, unknown>;
      expect(deps.chooseDirectory).toHaveBeenCalledOnce();
      expect(saved.packageDir).toBe('D:\\Paket');
      expect(dto).not.toHaveProperty('scripts');
      const json = JSON.stringify(dto);
      expect(json).not.toContain(SERVER_PASSWORD);
      expect((dto.config as { raw: unknown }).raw).toBeNull();
      expect((dto.config as { server: { ip: string } }).server.ip).toBe('192.168.88.2');
      // load sesudahnya memakai pengaturan tersimpan
      expect(await call(BRIDGE_CHANNELS.packageLoad)).not.toBeNull();
      store.close();
    });

    test('chooseDir dibatalkan = null; folder tak valid melempar PackageError dan tidak menyimpan', async () => {
      const cancelled = setup({ chooseDirectory: vi.fn(async () => null) }, null);
      expect(await cancelled.call(BRIDGE_CHANNELS.packageChooseDir)).toBeNull();
      expect(cancelled.saved.packageDir).toBeNull();
      cancelled.store.close();

      const bad = setup(
        {
          loadPackage: vi.fn(async () => {
            throw new PackageError('NO_CONFIG', 'config.QC tidak ditemukan di folder paket');
          }),
        },
        null,
      );
      await expect(bad.call(BRIDGE_CHANNELS.packageChooseDir)).rejects.toThrow(/config\.QC/);
      expect(bad.saved.packageDir).toBeNull();
      bad.store.close();
    });
  });

  describe('auth', () => {
    test('status, login, dan logout meneruskan ke layanan login; status tanpa token', async () => {
      const { deps, call, store } = setup();
      expect(await call(BRIDGE_CHANNELS.authStatus)).toEqual({
        signedIn: false,
        email: null,
        serverUrl: DEFAULT_SERVER_URL,
      });
      await call(BRIDGE_CHANNELS.authLogin);
      expect(deps.auth.start).toHaveBeenCalledOnce();
      await call(BRIDGE_CHANNELS.authLogout);
      expect(deps.auth.logout).toHaveBeenCalledOnce();
      store.close();
    });

    test('argumen apa pun pada kanal auth ditolak sebelum menyentuh layanan', async () => {
      const { deps, call, store } = setup();
      for (const channel of [
        BRIDGE_CHANNELS.authStatus,
        BRIDGE_CHANNELS.authLogin,
        BRIDGE_CHANNELS.authLogout,
      ]) {
        await expect(call(channel, 'https://jahat.example'), channel).rejects.toThrow(
          /Argumen tidak valid/,
        );
        await expect(
          call(channel, { serverUrl: 'https://jahat.example' }),
          channel,
        ).rejects.toThrow(/Argumen tidak valid/);
      }
      expect(deps.auth.start).not.toHaveBeenCalled();
      expect(deps.auth.logout).not.toHaveBeenCalled();
      store.close();
    });

    test('galat login ke renderer berpesan terkontrol (tanpa detail/token dari layanan)', async () => {
      const { call, store } = setup({
        auth: {
          status: () => ({ signedIn: false, email: null, serverUrl: DEFAULT_SERVER_URL }),
          start: async () => {
            throw new Error('rinci dengan TOKEN-RAHASIA');
          },
          logout: () => undefined,
        },
      });
      const error = (await call(BRIDGE_CHANNELS.authLogin).catch((e: unknown) => e)) as Error;
      expect(error.message).toBe('Tidak dapat membuka peramban sistem untuk login');
      expect(error.message).not.toContain('TOKEN-RAHASIA');
      store.close();
    });

    test('pengirim tak dipercaya tidak dapat memicu login', async () => {
      const { deps, call, store } = setup({ isTrustedSender: () => false });
      await expect(call(BRIDGE_CHANNELS.authLogin)).rejects.toThrow(/tidak dipercaya/);
      expect(deps.auth.start).not.toHaveBeenCalled();
      store.close();
    });
  });

  describe('catalog', () => {
    test('get/status/refresh meneruskan ke proses utama; argumen apa pun ditolak; pengirim tak dipercaya ditolak', async () => {
      const { deps, call, store } = setup();
      expect(await call(BRIDGE_CHANNELS.catalogGet)).toBeNull();
      expect(await call(BRIDGE_CHANNELS.catalogStatus)).toEqual({
        state: 'idle',
        itemCount: 0,
        syncedAt: null,
        error: null,
      });
      expect(await call(BRIDGE_CHANNELS.catalogRefresh)).toMatchObject({
        state: 'ok',
        itemCount: 2,
      });
      expect(deps.catalog.refresh).toHaveBeenCalledOnce();
      // Tak ada kanal yang menerima argumen (mis. jalur berkas atau token dari renderer).
      for (const channel of [
        BRIDGE_CHANNELS.catalogGet,
        BRIDGE_CHANNELS.catalogStatus,
        BRIDGE_CHANNELS.catalogRefresh,
      ]) {
        await expect(call(channel, 'C:\rahasia')).rejects.toThrow(/Argumen tidak valid/);
      }
      expect(deps.catalog.refresh).toHaveBeenCalledOnce();
      store.close();
      const untrusted = setup({ isTrustedSender: () => false });
      await expect(untrusted.call(BRIDGE_CHANNELS.catalogRefresh)).rejects.toThrow(
        /tidak dipercaya/,
      );
      expect(untrusted.deps.catalog.refresh).not.toHaveBeenCalled();
      untrusted.store.close();
    });
  });

  describe('ui', () => {
    test('ui.reload meneruskan ke proses utama; argumen apa pun ditolak; pengirim tak dipercaya ditolak', async () => {
      const { deps, call, store } = setup();
      await call(BRIDGE_CHANNELS.uiReload);
      expect(deps.ui.reload).toHaveBeenCalledOnce();
      await expect(call(BRIDGE_CHANNELS.uiReload, 'jalur-apa-saja')).rejects.toThrow(
        /Argumen tidak valid/,
      );
      expect(deps.ui.reload).toHaveBeenCalledOnce();
      store.close();
      const untrusted = setup({ isTrustedSender: () => false });
      await expect(untrusted.call(BRIDGE_CHANNELS.uiReload)).rejects.toThrow(/tidak dipercaya/);
      expect(untrusted.deps.ui.reload).not.toHaveBeenCalled();
      untrusted.store.close();
    });

    test('registerIpc melaporkan inject berjalan lewat isInjecting (dipakai pengelola bundel UI)', async () => {
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const startedPromise = new Promise<void>((r) => {
        started = r;
      });
      const { ipc, call, store } = setup({
        runInject: vi.fn(
          () =>
            new Promise<InjectOutcome>((resolveOutcome) => {
              started();
              release = () => resolveOutcome({ ok: true, reason: 'completed' });
            }),
        ),
      });
      expect(ipc.isInjecting()).toBe(false);
      const running = call(BRIDGE_CHANNELS.injectRun, injectReq());
      await startedPromise;
      expect(ipc.isInjecting()).toBe(true);
      release();
      await running;
      expect(ipc.isInjecting()).toBe(false);
      store.close();
    });

    test('onInjectIdle dipanggil saat inject terakhir selesai (sukses maupun gagal), tidak sebelumnya', async () => {
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const startedPromise = new Promise<void>((r) => {
        started = r;
      });
      const onInjectIdle = vi.fn();
      const failing = vi.fn(async () => {
        throw new Error('putus');
      });
      const { call, store, deps } = setup({
        onInjectIdle,
        runInject: vi.fn(
          () =>
            new Promise<InjectOutcome>((resolveOutcome) => {
              started();
              release = () => resolveOutcome({ ok: true, reason: 'completed' });
            }),
        ),
      });
      const running = call(BRIDGE_CHANNELS.injectRun, injectReq());
      await startedPromise;
      expect(onInjectIdle).not.toHaveBeenCalled();
      release();
      await running;
      expect(onInjectIdle).toHaveBeenCalledTimes(1);

      // Gagal juga melapor idle.
      (deps.runInject as unknown as { mockImplementation(f: unknown): void }).mockImplementation(
        failing,
      );
      await call(BRIDGE_CHANNELS.injectRun, injectReq({ id: 'lain' }));
      expect(onInjectIdle).toHaveBeenCalledTimes(2);
      store.close();
    });
  });

  describe('pending', () => {
    test('add, list, dan remove lewat IPC', async () => {
      const { call, store } = setup();
      const entry = {
        serial: ' ab12 ',
        brand: 'mikrotik',
        tipe: 'hAP',
        date: '2026-11-12',
        timestamp: '2026-11-12T08:00:00.000Z',
      };
      expect(await call(BRIDGE_CHANNELS.pendingAdd, entry)).toBe('success');
      expect(await call(BRIDGE_CHANNELS.pendingAdd, entry)).toBe('duplicated');
      expect(((await call(BRIDGE_CHANNELS.pendingList)) as unknown[]).length).toBe(1);
      await call(BRIDGE_CHANNELS.pendingRemove, 'AB12');
      expect(await call(BRIDGE_CHANNELS.pendingList)).toEqual([]);
      store.close();
    });
  });

  describe('draft', () => {
    test('save lalu load lewat IPC; save kosong menghapus draft', async () => {
      const { call, store } = setup();
      expect(await call(BRIDGE_CHANNELS.draftLoad)).toEqual([]);
      await call(BRIDGE_CHANNELS.draftSave, [{ serial: 'AB12' }, { serial: 'CD34' }]);
      expect(await call(BRIDGE_CHANNELS.draftLoad)).toEqual([
        { serial: 'AB12' },
        { serial: 'CD34' },
      ]);
      await call(BRIDGE_CHANNELS.draftSave, []);
      expect(await call(BRIDGE_CHANNELS.draftLoad)).toEqual([]);
      store.close();
    });
  });

  describe('draft: galat penyimpanan', () => {
    test('pesan berkas draft rusak diteruskan; galat lain menjadi pesan generik tanpa isi aslinya', async () => {
      const { call, deps, store } = setup();
      deps.draft = {
        load: () => {
          throw new Error('Draft tersimpan rusak: isinya tidak terbaca.');
        },
        save: () => {
          throw new Error('SQLITE_FULL: rahasia di C:\\Users\\x\\draft.db');
        },
        close: () => undefined,
      };
      await expect(call(BRIDGE_CHANNELS.draftLoad)).rejects.toThrow('Draft tersimpan rusak');
      const failure = call(BRIDGE_CHANNELS.draftSave, [{ serial: 'A' }]);
      await expect(failure).rejects.toThrow('Draft tidak dapat disimpan');
      await expect(failure).rejects.not.toThrow(/SQLITE_FULL|draft\.db/);
      store.close();
    });
  });

  describe('inject.run', () => {
    test('mengambil host key router, merencanakan inject, menjalankan eksekutor dengan SENTINEL_BY_BRAND dan menyamarkan kata sandi', async () => {
      let captured: InjectOptions | undefined;
      const runInject = vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        captured = opts;
        // Pty meng-echo sandi dalam bentuk terescape dan dengan urutan ANSI di tengahnya.
        const escaped = secretForms('Pa$$w"rd?')[1] ?? 'Pa$$w"rd?';
        opts.onProgress({ stage: 'sending', message: `\u001b[31mkirim ${escaped}\u001b[0m` });
        opts.onProgress({ stage: 'running', message: 'Pa$$w\u001b[0m"rd? dan Srv#Pw!9' });
        opts.onProgress({ stage: 'completed', message: 'selesai\r\n' });
        return { ok: true, reason: 'completed' };
      });
      // Ubiquiti memakai {sshKey}; konek ke Target (connectVia) dan sentinel echo.
      const { deps, call, progress, store } = setup({ runInject });
      const result = await call(
        BRIDGE_CHANNELS.injectRun,
        injectReq({
          brand: 'ubiquiti',
          firmwareCode: 'WA',
          target: { ip: '192.168.1.20', username: 'ubnt', password: 'Pa$$w"rd?' },
        }),
      );
      expect(result).toEqual({ ok: true, stage: 'completed', message: 'Inject selesai' });
      expect(deps.fetchHostKey).toHaveBeenCalledWith({
        host: '192.168.88.2',
        username: 'admin',
        password: SERVER_PASSWORD,
      });
      expect(captured?.sentinel).toBe(SENTINEL_BY_BRAND.ubiquiti);
      expect(captured?.script).toContain('QUFBQUhPU1RLRVk='); // {sshKey} terisi dari host key
      expect(captured?.host).toBe('192.168.1.20');
      // plan.secrets (semua bentuk) + sandi mentah target dan server diteruskan ke eksekutor
      for (const form of secretForms('Pa$$w"rd?')) expect(captured?.secrets).toContain(form);
      expect(captured?.secrets).toContain(SERVER_PASSWORD);
      // Progres ke renderer: tanpa ANSI/kontrol dan tanpa sandi (mentah maupun terescape)
      expect(progress).toHaveLength(3);
      for (const event of progress) {
        expect(event.id).toBe('run-1');
        expect(hasControlChars(event.message)).toBe(false);
        expect(event.message).not.toContain('Pa$$w');
        expect(event.message).not.toContain('Srv#Pw!9');
      }
      expect(progress[1]?.message).toBe('**** dan ****');
      store.close();
    });

    test('Mikrotik: tanpa {sshKey} host key tidak diambil; sentinel put; hasil gagal dipetakan tanpa sandi', async () => {
      const runInject = vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        expect(opts.sentinel).toBe(SENTINEL_BY_BRAND.mikrotik);
        expect(opts.sentinel).toBe('put');
        return { ok: false, reason: 'auth' };
      });
      const { deps, call, store } = setup({ runInject });
      const result = (await call(BRIDGE_CHANNELS.injectRun, injectReq())) as {
        ok: boolean;
        stage: string;
        message: string;
      };
      expect(deps.fetchHostKey).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, stage: 'failed' });
      expect(result.message).not.toContain('Pa$$w');
      store.close();
    });

    test('paket belum dipilih, firmware tak dikenal, dan host key gagal menjadi hasil failed tanpa sandi', async () => {
      const none = setup({}, null);
      expect(await none.call(BRIDGE_CHANNELS.injectRun, injectReq())).toMatchObject({
        ok: false,
        stage: 'failed',
        message: 'Paket skrip belum dipilih',
      });
      none.store.close();

      const unknown = setup();
      await unknown.call(BRIDGE_CHANNELS.packageChooseDir);
      const r1 = (await unknown.call(
        BRIDGE_CHANNELS.injectRun,
        injectReq({ firmwareCode: 'TIDAK-ADA' }),
      )) as { ok: boolean; message: string };
      expect(r1.ok).toBe(false);
      expect(r1.message).toContain('TIDAK-ADA');
      expect(unknown.deps.runInject).not.toHaveBeenCalled();
      unknown.store.close();

      const { HostKeyError } = await import('./ssh/host-key');
      const hk = setup({
        fetchHostKey: vi.fn(async () => {
          throw new HostKeyError('AUTH', 'Kredensial router ditolak');
        }),
      });
      await hk.call(BRIDGE_CHANNELS.packageChooseDir);
      const r2 = (await hk.call(
        BRIDGE_CHANNELS.injectRun,
        injectReq({ brand: 'ubiquiti', firmwareCode: 'WA' }),
      )) as { ok: boolean; message: string };
      expect(r2).toEqual({ ok: false, stage: 'failed', message: 'Kredensial router ditolak' });
      expect(hk.deps.runInject).not.toHaveBeenCalled();
      hk.store.close();
    });

    test('galat tak terduga saat inject tidak membocorkan sandi', async () => {
      const { call, store } = setup({
        runInject: vi.fn(async () => {
          throw new Error('ssh gagal dengan Pa$$w"rd?');
        }),
      });
      const result = (await call(BRIDGE_CHANNELS.injectRun, injectReq())) as { message: string };
      expect(result.message).toBe('Terjadi galat saat menyiapkan inject');
      store.close();
    });

    test('inject.cancel menghentikan inject yang sedang berjalan', async () => {
      let started: () => void = () => undefined;
      const startedPromise = new Promise<void>((r) => {
        started = r;
      });
      const runInject = vi.fn(
        (opts: InjectOptions) =>
          new Promise<InjectOutcome>((resolveOutcome) => {
            started();
            opts.signal?.addEventListener('abort', () =>
              resolveOutcome({ ok: false, reason: 'cancelled' }),
            );
          }),
      );
      const { call, store } = setup({ runInject });
      const running = call(BRIDGE_CHANNELS.injectRun, injectReq());
      await startedPromise;
      // id yang sama tidak boleh berjalan ganda
      expect(await call(BRIDGE_CHANNELS.injectRun, injectReq())).toMatchObject({
        ok: false,
        stage: 'failed',
      });
      await call(BRIDGE_CHANNELS.injectCancel, 'run-1');
      expect(await running).toEqual({
        ok: false,
        stage: 'cancelled',
        message: 'Inject dibatalkan',
      });
      // batal id yang tak ada tidak melempar
      await expect(call(BRIDGE_CHANNELS.injectCancel, 'tidak-ada')).resolves.toBeUndefined();
      store.close();
    });
  });
});
