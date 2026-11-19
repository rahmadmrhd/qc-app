import { resolve } from 'node:path';
// Port palsu + jam terkendali milik mesin (tanpa SSH/timer nyata).
import { createFakePorts } from '@countrylock/multi/fakes';
import type { MultiSnapshot } from '@countrylock/multi/snapshot';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { IpcError } from '../ipc-support';
import { type LoadedPackage, loadLocalPackage } from '../package/local-folder';
import { createMultiHost, type MultiHostDeps } from './host';

const FIXTURE = resolve(__dirname, '../../../../countrylock/fixtures/country-lock2');
const BASE_SECRET = 'Base#Sentinel-1';
const SERVER_SECRET = 'Srv#Sentinel-2';
const QUEUE_SECRET = 'Queue#Sentinel-3';

let pkg: LoadedPackage;
beforeAll(async () => {
  const real = await loadLocalPackage(FIXTURE);
  const ubiquiti = real.config.brands.ubiquiti;
  if (!ubiquiti) throw new Error('fixture tanpa ubiquiti');
  pkg = {
    ...real,
    config: {
      ...real.config,
      server: { ...real.config.server, password: SERVER_SECRET },
      brands: { ...real.config.brands, ubiquiti: { ...ubiquiti, password: BASE_SECRET } },
    },
  };
});

const startCfg = (patch: Record<string, unknown> = {}) => ({
  firmwareCode: 'WA',
  concurrency: 4,
  excludeIp: '',
  autoInject: false,
  target: {
    itemId: 'item-1',
    itemLabel: 'NS Loco',
    buId: 'bu-1',
    buLabel: 'Retail',
    locationId: 'loc-1',
    locationLabel: 'Gudang',
  },
  ...patch,
});

const LEASES = [{ ip: '192.168.88.10', mac: '58:D6:1F:0E:4E:FE' }];
const MAC = '58:D6:1F:0E:4E:FE';

function setup(patch: Partial<MultiHostDeps> = {}) {
  const fake = createFakePorts();
  const emitted: MultiSnapshot[] = [];
  let singleInjecting = false;
  const openExternal = vi.fn(async (_url: string) => undefined);
  const onIdle = vi.fn();
  const deps: MultiHostDeps = {
    ports: fake.ports,
    ensurePackage: async () => pkg,
    emitChange: (s) => emitted.push(s),
    isSingleInjecting: () => singleInjecting,
    openExternal,
    onIdle,
    ...patch,
  };
  const host = createMultiHost(deps);
  return {
    host,
    fake,
    emitted,
    openExternal,
    onIdle,
    setSingle: (v: boolean) => {
      singleInjecting = v;
    },
  };
}

describe('multiStart', () => {
  test('ditolak saat inject tunggal berjalan, paket belum dipilih, merk/firmware/skrip tak ada, atau sudah berjalan', async () => {
    const a = setup();
    a.setSingle(true);
    await expect(a.host.handle('multiStart', [startCfg()])).rejects.toThrow(
      'Hentikan inject tunggal dulu',
    );
    expect(a.host.isRunning()).toBe(false);

    const none = setup({ ensurePackage: async () => null });
    await expect(none.host.handle('multiStart', [startCfg()])).rejects.toThrow(
      'Paket skrip belum dipilih',
    );

    const noBrand = setup({
      ensurePackage: async () => ({ ...pkg, config: { ...pkg.config, brands: {} } }),
    });
    await expect(noBrand.host.handle('multiStart', [startCfg()])).rejects.toThrow('Ubiquiti');

    const unknownFw = setup();
    await expect(
      unknownFw.host.handle('multiStart', [startCfg({ firmwareCode: 'TIDAK-ADA' })]),
    ).rejects.toThrow('TIDAK-ADA');

    const noScript = setup({ ensurePackage: async () => ({ ...pkg, scripts: {} }) });
    await expect(noScript.host.handle('multiStart', [startCfg()])).rejects.toThrow('WA.txt');

    const twice = setup();
    await twice.host.handle('multiStart', [startCfg()]);
    await expect(twice.host.handle('multiStart', [startCfg()])).rejects.toThrow(
      'Multi sudah berjalan',
    );
    twice.host.dispose();
  });

  test('pelanggaran terdeteksi walau inject tunggal baru mulai saat paket dimuat (balapan)', async () => {
    let flip: () => void = () => undefined;
    const slow = setup({
      ensurePackage: async () => {
        flip();
        return pkg;
      },
    });
    flip = () => slow.setSingle(true);
    await expect(slow.host.handle('multiStart', [startCfg()])).rejects.toThrow(
      'Hentikan inject tunggal dulu',
    );
    expect(slow.host.isRunning()).toBe(false);
  });

  test('menjalankan engine dengan kredensial dasar dari paket (bukan dari renderer)', async () => {
    const { host, fake } = setup();
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    expect(host.isRunning()).toBe(true);
    await fake.advance(0);
    expect(fake.calls.readInfo[0]?.cred).toEqual({ username: 'ubnt', password: BASE_SECRET });
    host.dispose();
  });
});

describe('perintah engine', () => {
  test('setConcurrency, setBlocked, setRegistered, autoInject, kredensial, stop diteruskan', async () => {
    const { host, fake } = setup();
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    await host.handle('multiSetConcurrency', [8]);
    await host.handle('multiSetBlocked', ['Draft penuh']);
    await host.handle('multiSetAutoInject', [true]);
    await host.handle('multiAddCredential', [{ username: 'admin', password: QUEUE_SECRET }]);
    let snap = (await host.handle('multiSnapshot', [])) as MultiSnapshot;
    expect(snap).toMatchObject({
      running: true,
      concurrency: 8,
      blockedReason: 'Draft penuh',
      autoInject: true,
      credentialCount: 1,
    });
    await host.handle('multiSetBlocked', [null]);
    await host.handle('multiStop', []);
    snap = (await host.handle('multiSnapshot', [])) as MultiSnapshot;
    expect(snap.running).toBe(false);
    expect(snap.blockedReason).toBeNull();
    expect(host.isRunning()).toBe(false);
  });

  test('pendingEvents dan ackInjected membaca/membuang peristiwa tersimpan', async () => {
    const { host, fake } = setup();
    fake.state.leases = LEASES;
    fake.state.injectMode = 'auto';
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    await host.handle('multiInjectDevice', [MAC]);
    await fake.advance(2000);
    const events = (await host.handle('multiPendingEvents', [])) as Array<{ eventId: string }>;
    expect(events).toHaveLength(1);
    await host.handle('multiAckInjected', [[events[0]?.eventId]]);
    expect(await host.handle('multiPendingEvents', [])).toEqual([]);
    host.dispose();
  });

  test('prepareBridge melapor hasil tanpa sandi dan boleh dijalankan sebelum start', async () => {
    const { host, fake } = setup();
    fake.state.bridgeResult = { ok: true, message: `Bridge siap ${SERVER_SECRET}` };
    const result = (await host.handle('multiPrepareBridge', [])) as {
      ok: boolean;
      message: string;
    };
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain(SERVER_SECRET);
    expect(fake.calls.ensureBridgePorts).toBe(1);
  });
});

describe('isInjecting dan onIdle', () => {
  test('benar selama ada perangkat injecting; onIdle dipanggil saat kembali tak sibuk', async () => {
    const { host, fake, onIdle } = setup();
    fake.state.leases = LEASES;
    fake.state.injectMode = 'manual';
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    expect(host.isInjecting()).toBe(false);
    await host.handle('multiInjectDevice', [MAC]);
    await fake.advance(1000);
    expect(host.isInjecting()).toBe(true);
    expect(onIdle).not.toHaveBeenCalled();
    fake.finishInject('192.168.88.10', { ok: true, stage: 'completed', message: 'ok' });
    await fake.advance(1000);
    expect(host.isInjecting()).toBe(false);
    expect(onIdle).toHaveBeenCalled();
    host.dispose();
  });
});

describe('isInjecting setelah stop', () => {
  test('tetap benar sampai inject yang dibatalkan stop benar-benar selesai (inject tunggal tak boleh menyela)', async () => {
    const fake = createFakePorts();
    let settle: (() => void) | null = null;
    // Port yang tak segera menyelesaikan diri saat dibatalkan (sesi SSH masih ditutup).
    fake.ports.inject = () =>
      new Promise((resolve) => {
        settle = () => resolve({ ok: false, stage: 'cancelled', message: 'Dibatalkan' });
      });
    const host = createMultiHost({
      ports: fake.ports,
      ensurePackage: async () => pkg,
      emitChange: () => undefined,
      isSingleInjecting: () => false,
      openExternal: async () => undefined,
    });
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    await host.handle('multiInjectDevice', [MAC]);
    await fake.advance(1000);
    expect(host.isInjecting()).toBe(true);
    const stopped = host.handle('multiStop', []);
    await fake.advance(0);
    expect(host.isRunning()).toBe(false);
    expect(host.isInjecting()).toBe(true);
    (settle as unknown as () => void)();
    await stopped;
    expect(host.isInjecting()).toBe(false);
    host.dispose();
  });
});

describe('saling-kecualikan arah sebaliknya', () => {
  test('inject tunggal yang berjalan saat Multi aktif menggagalkan inject perangkat tanpa menyentuh port', async () => {
    const { host, fake, setSingle } = setup();
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    setSingle(true);
    await host.handle('multiInjectDevice', [MAC]);
    await fake.advance(2000);
    expect(fake.calls.inject).toHaveLength(0);
    const snap = (await host.handle('multiSnapshot', [])) as MultiSnapshot;
    expect(snap.devices[0]).toMatchObject({
      status: 'failed',
      message: 'Hentikan inject tunggal dulu',
    });
    host.dispose();
  });

  test('isRunning benar juga selama multiStart menunggu paket dimuat', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const { host } = setup({
      ensurePackage: async () => {
        await gate;
        return pkg;
      },
    });
    const starting = host.handle('multiStart', [startCfg()]);
    expect(host.isRunning()).toBe(true);
    release();
    await starting;
    host.dispose();
  });
});

describe('snapshot tidak membocorkan sandi', () => {
  test('snapshot, peristiwa, hasil prepareBridge, dan pesan galat bebas dari sandi sentinel', async () => {
    const { host, fake, emitted } = setup();
    fake.state.leases = LEASES;
    fake.state.injectMode = 'auto';
    // Pesan dari port yang (salah) memuat sandi tetap disamarkan engine.
    fake.state.bridgeResult = { ok: false, message: `gagal ${QUEUE_SECRET}` };
    await host.handle('multiStart', [startCfg()]);
    await host.handle('multiAddCredential', [{ username: 'admin', password: QUEUE_SECRET }]);
    await fake.advance(0);
    await host.handle('multiInjectDevice', [MAC]);
    await fake.advance(2000);
    const bridge = await host.handle('multiPrepareBridge', []);
    const everything = JSON.stringify([
      emitted,
      await host.handle('multiSnapshot', []),
      await host.handle('multiPendingEvents', []),
      bridge,
    ]);
    for (const secret of [BASE_SECRET, SERVER_SECRET, QUEUE_SECRET]) {
      expect(everything).not.toContain(secret);
    }
    expect(emitted.length).toBeGreaterThan(0);

    const errors: string[] = [];
    for (const attempt of [
      () => host.handle('multiStart', [startCfg()]),
      () => host.handle('multiOpenWeb', ['AA:BB:CC:DD:EE:00']),
    ]) {
      await attempt().catch((e: unknown) => errors.push((e as Error).message));
    }
    for (const message of errors) {
      for (const secret of [BASE_SECRET, SERVER_SECRET, QUEUE_SECRET]) {
        expect(message).not.toContain(secret);
      }
    }
    host.dispose();
  });
});

describe('multiOpenWeb', () => {
  test('hanya untuk MAC yang ada di snapshot dan hanya https://<ip>', async () => {
    const { host, fake, openExternal } = setup();
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    await host.handle('multiOpenWeb', [MAC]);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://192.168.88.10');

    await expect(host.handle('multiOpenWeb', ['AA:BB:CC:DD:EE:00'])).rejects.toBeInstanceOf(
      IpcError,
    );
    expect(openExternal).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test('IP yang bukan host sah ditolak walau MAC dikenal', async () => {
    const { host, fake, openExternal } = setup();
    fake.state.leases = [{ ip: 'bukan host!', mac: MAC }];
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    await expect(host.handle('multiOpenWeb', [MAC])).rejects.toBeInstanceOf(IpcError);
    expect(openExternal).not.toHaveBeenCalled();
    host.dispose();
  });
});

describe('dispose', () => {
  test('menghentikan engine dan menghentikan emisi snapshot', async () => {
    const { host, fake, emitted } = setup();
    fake.state.leases = LEASES;
    await host.handle('multiStart', [startCfg()]);
    await fake.advance(0);
    host.dispose();
    await fake.advance(0);
    expect(host.isRunning()).toBe(false);
    const count = emitted.length;
    await fake.advance(10_000);
    expect(emitted.length).toBe(count);
    expect(fake.pendingSleeps).toBe(0);
  });
});
