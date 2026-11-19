// Tes putaran perbaikan review mode Multi (2026-11-19): throttle emisi, verifikasi lease bersama, percobaan ulang Auto
// Inject, antrean manual vs blokir, pencatatan peristiwa gagal, kebocoran listener abort, dan `isBusy` saat berhenti.

import { describe, expect, test } from 'bun:test';
import { getEventListeners } from 'node:events';
import { createMultiEngine, EMIT_MIN_INTERVAL_MS, type MultiStartConfig } from './engine';
import { createFakePorts, serialOfIp } from './fakes';
import type { MultiSnapshot } from './snapshot';
import type { Credential } from './types';

const BASE: Credential = { username: 'ubnt', password: 'SENTINEL-BASE-PASSWORD' };
const MACS = [
  'AA:AA:AA:AA:AA:01',
  'AA:AA:AA:AA:AA:02',
  'AA:AA:AA:AA:AA:03',
  'AA:AA:AA:AA:AA:04',
  'AA:AA:AA:AA:AA:05',
];
const IPS = ['10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6'];

function cfg(patch: Partial<MultiStartConfig> = {}): MultiStartConfig {
  return {
    firmwareCode: 'XW',
    concurrency: 4,
    excludeIp: '',
    autoInject: false,
    target: {
      itemId: 'item-1',
      itemLabel: 'NanoStation',
      buId: 'bu-1',
      buLabel: 'BU',
      locationId: 'loc-1',
      locationLabel: 'Lokasi',
    },
    base: BASE,
    ...patch,
  };
}

type Engine = ReturnType<typeof createMultiEngine>;

const device = (engine: Engine, mac: string) =>
  engine.snapshot().devices.find((d) => d.mac === mac);
const statusOf = (engine: Engine, mac: string) => device(engine, mac)?.status;

async function withReady(n: number, patch: Partial<MultiStartConfig> = {}) {
  const f = createFakePorts();
  const engine = createMultiEngine(f.ports);
  f.state.leases = MACS.slice(0, n).map((mac, i) => ({ ip: IPS[i] as string, mac }));
  engine.start(cfg(patch));
  await f.advance(0);
  return { f, engine };
}

describe('engine: emisi snapshot', () => {
  test('progres beruntun digabung, pesan terakhir tetap sampai; tak ada emisi saat info tak berubah', async () => {
    const { f, engine } = await withReady(1);
    const snaps: MultiSnapshot[] = [];
    engine.onChange((s) => snaps.push(s));
    await f.advance(EMIT_MIN_INTERVAL_MS);
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    const call = f.pendingInject(IPS[0] as string);
    const before = snaps.length;
    for (let i = 0; i < 50; i += 1) call?.progress(`baris ${i}`);
    await f.advance(0);
    await f.advance(EMIT_MIN_INTERVAL_MS);
    // 50 baris progres menjadi paling banyak beberapa emisi (bukan 50), dan pesan terakhir sampai ke pendengar.
    expect(snaps.length - before).toBeLessThanOrEqual(3);
    expect(snaps.at(-1)?.devices[0]?.message).toBe('baris 49');
    expect(snaps.at(-1)?.devices[0]?.log.at(-1)).toContain('baris 49');
    f.finishInject(IPS[0] as string);
    await f.advance(EMIT_MIN_INTERVAL_MS);
    expect(snaps.at(-1)?.devices[0]?.status).toBe('success');
    // Perangkat success dibaca ulang tiap 800 ms dengan hasil sama: tidak ada emisi baru.
    const settled = snaps.length;
    await f.advance(10_000);
    expect(snaps).toHaveLength(settled);
    await engine.stop();
  });

  test('emisi pertama langsung, berikutnya paling cepat tiap EMIT_MIN_INTERVAL_MS', async () => {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    const stamps: number[] = [];
    engine.onChange(() => stamps.push(f.time));
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    f.state.pingDelay = 20;
    f.state.infoDelay = 20;
    engine.start(cfg());
    await f.advance(1000);
    expect(stamps.length).toBeGreaterThan(1);
    for (let i = 1; i < stamps.length; i += 1) {
      expect((stamps[i] as number) - (stamps[i - 1] as number)).toBeGreaterThanOrEqual(
        EMIT_MIN_INTERVAL_MS,
      );
    }
    await engine.stop();
  });

  test('stop memancarkan keadaan terakhir seketika dan tak menyisakan timer', async () => {
    const { f, engine } = await withReady(1);
    const snaps: MultiSnapshot[] = [];
    engine.onChange((s) => snaps.push(s));
    engine.setConcurrency(7);
    engine.setAutoInject(true);
    await engine.stop();
    expect(snaps.at(-1)?.running).toBe(false);
    expect(f.pendingSleeps).toBe(0);
  });
});

describe('engine: verifikasi lease bersama', () => {
  test('inject yang menunggu verifikasi berbagi satu pembacaan lease', async () => {
    const { f, engine } = await withReady(5, { concurrency: 5 });
    f.state.leaseDelay = 500;
    f.state.injectMode = 'auto';
    const before = f.calls.readLeases;
    engine.injectAll();
    await f.advance(0);
    expect(engine.snapshot().counts.queued).toBe(5);
    expect(f.calls.readLeases - before).toBe(1);
    await f.advance(500);
    expect(engine.snapshot().counts.success).toBe(5);
    expect(f.calls.inject).toHaveLength(5);
    await engine.stop();
  });

  test('verifikasi tidak memulai pembacaan kedua saat pemindaian sedang berjalan', async () => {
    const { f, engine } = await withReady(1);
    f.state.leaseDelay = 400;
    const scan = engine.scan();
    const before = f.calls.readLeases;
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(f.calls.readLeases).toBe(before);
    f.state.injectMode = 'auto';
    await f.advance(400);
    await scan;
    expect(statusOf(engine, MACS[0] as string)).toBe('success');
    await engine.stop();
  });
});

describe('engine: Auto Inject dan verifikasi gagal', () => {
  test('lease tak terbaca saat verifikasi: kembali ready lalu diantre ulang otomatis (tanpa loop rapat)', async () => {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    f.state.infoDelay = 100;
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    // Lease mulai tak terbaca sebelum perangkat ready (Auto Inject mengantre lalu verifikasi gagal).
    f.state.leases = null;
    await f.advance(100);
    expect(device(engine, MACS[0] as string)?.message).toMatch(/lease/i);
    expect(statusOf(engine, MACS[0] as string)).toBe('ready');
    expect(f.calls.inject).toHaveLength(0);
    // Pulih: percobaan ulang terjadwal mengantre lagi tanpa campur tangan operator.
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    const reads = f.calls.readLeases;
    await f.advance(3500);
    expect(statusOf(engine, MACS[0] as string)).toBe('injecting');
    // Selama gagal tak ada putaran rapat: pembacaan lease terbatas pada irama pemindaian + satu percobaan ulang.
    expect(f.calls.readLeases - reads).toBeLessThanOrEqual(3);
    await engine.stop();
  });

  test('inject manual yang verifikasinya gagal tidak diantre ulang otomatis', async () => {
    const { f, engine } = await withReady(1);
    f.state.leases = null;
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[0] as string)).toBe('ready');
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    await f.advance(10_000);
    expect(statusOf(engine, MACS[0] as string)).toBe('ready');
    expect(f.calls.inject).toHaveLength(0);
    await engine.stop();
  });
});

describe('engine: blokir draft dan antrean manual', () => {
  test('yang dikembalikan blokir diantre lagi saat blokir dicabut; yang tak pernah diantre tidak disentuh', async () => {
    const { f, engine } = await withReady(4, { concurrency: 1 });
    engine.injectDevice(MACS[0] as string);
    engine.injectDevice(MACS[1] as string);
    engine.injectDevice(MACS[2] as string);
    await f.advance(0);
    expect(engine.snapshot().counts).toMatchObject({ injecting: 1, queued: 2 });
    engine.setBlocked('Draft belum termuat');
    expect(statusOf(engine, MACS[1] as string)).toBe('ready');
    expect(statusOf(engine, MACS[2] as string)).toBe('ready');
    engine.setBlocked(null);
    await f.advance(0);
    // Dua perangkat yang tadi antre diantre lagi (satu slot: satu injecting + satu antri); perangkat keempat tidak.
    expect(statusOf(engine, MACS[1] as string)).toBe('queued');
    expect(statusOf(engine, MACS[2] as string)).toBe('queued');
    expect(statusOf(engine, MACS[3] as string)).toBe('ready');
    expect(f.calls.inject).toHaveLength(1);
    f.finishInject(IPS[0] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[1] as string)).toBe('injecting');
    await engine.stop();
  });

  test('pembatalan operator selama blokir menghapus perangkat dari daftar antre ulang', async () => {
    const { f, engine } = await withReady(3, { concurrency: 1 });
    engine.injectAll();
    await f.advance(0);
    engine.setBlocked('Draft penuh');
    engine.cancelDevice(MACS[1] as string);
    engine.stopQueue();
    engine.setBlocked(null);
    await f.advance(0);
    expect(statusOf(engine, MACS[1] as string)).toBe('ready');
    expect(statusOf(engine, MACS[2] as string)).toBe('ready');
    await engine.stop();
  });
});

describe('engine: antrean Auto Inject yang tertahan blokir', () => {
  async function heldAuto() {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    f.state.infoDelay = 100;
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    // Verifikasi lease lambat: perangkat tertahan di antrean saat blokir datang.
    f.state.leaseDelay = 500;
    await f.advance(100);
    expect(statusOf(engine, MACS[0] as string)).toBe('queued');
    engine.setBlocked('Draft belum termuat');
    expect(statusOf(engine, MACS[0] as string)).toBe('ready');
    return { f, engine };
  }

  test('Auto Inject dimatikan selama blokir: tak ada inject setelah blokir dicabut', async () => {
    const { f, engine } = await heldAuto();
    engine.setAutoInject(false);
    engine.setBlocked(null);
    await f.advance(2000);
    expect(f.calls.inject).toHaveLength(0);
    expect(statusOf(engine, MACS[0] as string)).toBe('ready');
    await engine.stop();
  });

  test('serial yang baru terdaftar dalam perubahan yang sama (setRegistered sebelum setBlocked(null)) tidak di-inject', async () => {
    const { f, engine } = await heldAuto();
    engine.setRegistered([serialOfIp(IPS[0] as string)]);
    engine.setBlocked(null);
    await f.advance(2000);
    expect(f.calls.inject).toHaveLength(0);
    await engine.stop();
  });

  test('Auto Inject tetap menyala dan serial belum terdaftar: diantre lagi lewat autoSweep', async () => {
    const { f, engine } = await heldAuto();
    engine.setBlocked(null);
    f.state.leaseDelay = 0;
    await f.advance(1000);
    expect(f.calls.inject).toHaveLength(1);
    await engine.stop();
  });
});

describe('engine: peristiwa gagal ditulis lintas perangkat dan Stop', () => {
  test('perangkat dicabut: peristiwa tetap ditulis ulang otomatis', async () => {
    const { f, engine } = await withReady(1);
    f.state.injectMode = 'auto';
    const original = f.ports.events.add;
    f.ports.events.add = () => {
      throw new Error('disk penuh');
    };
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[0] as string)).toBe('failed');
    f.state.leases = [];
    await f.advance(70_000); // terputus lalu dibuang setelah masa tenggang
    expect(engine.snapshot().devices).toHaveLength(0);
    f.ports.events.add = original;
    await f.advance(70_000);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]?.mac).toBe(MACS[0]);
    await engine.stop();
  });

  test('Stop: peristiwa tertahan ditulis ulang setelah engine berhenti dan tak ganda; injectedSeq naik', async () => {
    const { f, engine } = await withReady(1);
    f.state.injectMode = 'auto';
    const original = f.ports.events.add;
    f.ports.events.add = () => {
      throw new Error('disk penuh');
    };
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(engine.snapshot().injectedSeq).toBe(0);
    await engine.stop();
    f.ports.events.add = original;
    await f.advance(5000);
    expect(f.events).toHaveLength(1);
    expect(engine.snapshot().injectedSeq).toBe(1);
    await f.advance(120_000);
    expect(f.events).toHaveLength(1);
  });

  test('penulisan ulang otomatis berhasil: perangkat yang masih ada menjadi success', async () => {
    const { f, engine } = await withReady(1);
    f.state.injectMode = 'auto';
    const original = f.ports.events.add;
    f.ports.events.add = () => {
      throw new Error('disk penuh');
    };
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    f.ports.events.add = original;
    await f.advance(5000);
    expect(statusOf(engine, MACS[0] as string)).toBe('success');
    expect(f.events).toHaveLength(1);
    await engine.stop();
  });
});

describe('engine: batas percobaan ulang verifikasi lease', () => {
  test('setelah 5 percobaan berturut-turut berhenti dengan pesan "tekan Retry"; Retry manual tetap jalan', async () => {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    f.state.infoDelay = 100;
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    f.state.leases = null;
    await f.advance(100);
    await f.advance(60_000);
    const d = device(engine, MACS[0] as string);
    expect(d?.status).toBe('ready');
    expect(d?.message).toBe('Gagal memeriksa lease, tekan Retry');
    const reads = f.calls.readLeases;
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    await f.advance(20_000);
    expect(f.calls.inject).toHaveLength(0);
    expect(f.calls.readLeases - reads).toBeLessThanOrEqual(8); // hanya irama pemindaian
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[0] as string)).toBe('injecting');
    await engine.stop();
  });
});

describe('engine: inject menggantung tak menahan isBusy selamanya', () => {
  test('setelah batal, engine menunggu paling lama 30 detik lalu melepas isBusy', async () => {
    const { f, engine } = await withReady(1);
    f.ports.inject = () => new Promise(() => undefined); // tak pernah selesai dan tak menghormati abort
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    const stopped = engine.stop();
    await f.advance(29_000);
    expect(engine.isBusy()).toBe(true);
    await f.advance(2000);
    await stopped;
    expect(engine.isBusy()).toBe(false);
    expect(f.pendingSleeps).toBe(0);
  });

  test('inject yang batal dan menyelesaikan diri sendiri tak meninggalkan timer tenggang', async () => {
    const { f, engine } = await withReady(1);
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    await engine.stop();
    expect(f.pendingSleeps).toBe(0);
  });
});

describe('engine: Inject All dan perangkat terdaftar', () => {
  test('Inject All melewati perangkat alreadyRegistered; inject manual per perangkat tetap boleh', async () => {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    f.state.leases = MACS.slice(0, 3).map((mac, i) => ({ ip: IPS[i] as string, mac }));
    engine.setRegistered([serialOfIp(IPS[1] as string)]);
    engine.start(cfg());
    await f.advance(0);
    expect(device(engine, MACS[1] as string)?.alreadyRegistered).toBe(true);
    engine.injectAll();
    await f.advance(0);
    expect(f.calls.inject.map((c) => c.ip).sort()).toEqual([IPS[0] as string, IPS[2] as string]);
    expect(statusOf(engine, MACS[1] as string)).toBe('ready');
    engine.injectDevice(MACS[1] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[1] as string)).toBe('injecting');
    await engine.stop();
  });
});

describe('engine: pencatatan peristiwa gagal', () => {
  test('pesan snapshot generik (tanpa detail galat); detail ke logError; Retry mencatat ulang tanpa inject ulang', async () => {
    const { f, engine } = await withReady(1);
    const logged: unknown[] = [];
    f.ports.logError = (_scope, error) => {
      logged.push(error);
    };
    f.state.injectMode = 'auto';
    const original = f.ports.events.add;
    f.ports.events.add = () => {
      throw new Error('SQLITE_FULL: D:\\Users\\rahasia\\AppData\\draft.db');
    };
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    const d = device(engine, MACS[0] as string);
    expect(d?.status).toBe('failed');
    expect(d?.message).toContain('gagal dicatat');
    expect(JSON.stringify(engine.snapshot())).not.toContain('rahasia');
    expect(logged).toHaveLength(1);
    expect(f.calls.inject).toHaveLength(1);

    // Retry: tulis ulang peristiwa yang sama; perangkat TIDAK di-inject lagi.
    f.ports.events.add = original;
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(statusOf(engine, MACS[0] as string)).toBe('success');
    expect(f.calls.inject).toHaveLength(1);
    expect(f.events).toHaveLength(1);
    await engine.stop();
  });
});

describe('engine: listener abort dan isBusy', () => {
  test('job inject berulang tidak menumpuk listener abort pada signal induk', async () => {
    const f = createFakePorts();
    const engine = createMultiEngine(f.ports);
    const signals: AbortSignal[] = [];
    const original = f.ports.sleep;
    f.ports.sleep = (ms, signal) => {
      if (ms >= 1000) signals.push(signal);
      return original(ms, signal);
    };
    f.state.leases = [{ ip: IPS[0] as string, mac: MACS[0] as string }];
    engine.start(cfg());
    await f.advance(0);
    const parent = signals[0] as AbortSignal;
    const baseline = getEventListeners(parent, 'abort').length;
    for (let i = 0; i < 25; i += 1) {
      engine.injectDevice(MACS[0] as string);
      await f.advance(0);
      f.finishInject(IPS[0] as string, { ok: false, stage: 'failed', message: 'gagal' });
      await f.advance(0);
      expect(statusOf(engine, MACS[0] as string)).toBe('failed');
    }
    expect(getEventListeners(parent, 'abort').length).toBeLessThanOrEqual(baseline);
    await engine.stop();
  });

  test('isBusy tetap true sampai inject yang dibatalkan stop() benar-benar selesai', async () => {
    const { f, engine } = await withReady(1);
    let settle: (() => void) | null = null;
    f.ports.inject = () =>
      new Promise((resolve) => {
        settle = () => resolve({ ok: false, stage: 'cancelled', message: 'Dibatalkan' });
      });
    engine.injectDevice(MACS[0] as string);
    await f.advance(0);
    expect(engine.isBusy()).toBe(true);
    const stopped = engine.stop();
    await f.advance(0);
    expect(engine.snapshot().running).toBe(false);
    expect(engine.isBusy()).toBe(true);
    (settle as unknown as () => void)();
    await stopped;
    expect(engine.isBusy()).toBe(false);
  });

  test('isBusy: false saat diam, true selama ada yang antre atau injecting', async () => {
    const { f, engine } = await withReady(1);
    expect(engine.isBusy()).toBe(false);
    engine.injectDevice(MACS[0] as string);
    expect(engine.isBusy()).toBe(true);
    await f.advance(0);
    f.finishInject(IPS[0] as string);
    await f.advance(0);
    expect(engine.isBusy()).toBe(false);
    await engine.stop();
  });
});
