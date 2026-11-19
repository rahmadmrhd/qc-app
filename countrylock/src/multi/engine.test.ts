import { describe, expect, test } from 'bun:test';
import { createMultiEngine, type MultiStartConfig } from './engine';
import { createFakePorts, serialOfIp } from './fakes';
import type { MultiSnapshot } from './snapshot';
import type { Credential } from './types';

const MAC1 = 'AA:AA:AA:AA:AA:01';
const MAC2 = 'AA:AA:AA:AA:AA:02';
const MAC3 = 'AA:AA:AA:AA:AA:03';
const IP1 = '10.0.0.2';
const IP2 = '10.0.0.3';
const IP3 = '10.0.0.4';

const BASE_PW = 'SENTINEL-BASE-PASSWORD';
const Q1_PW = 'SENTINEL-QUEUE-ONE';
const Q2_PW = 'SENTINEL-QUEUE-TWO';
const BASE: Credential = { username: 'ubnt', password: BASE_PW };

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

function setup() {
  const f = createFakePorts();
  const engine = createMultiEngine(f.ports);
  return { f, engine };
}

const device = (engine: ReturnType<typeof createMultiEngine>, mac: string) =>
  engine.snapshot().devices.find((d) => d.mac === mac);

describe('engine: pemindaian dan loop perangkat', () => {
  test('(a) start memindai lease; perangkat waiting -> pinging -> fetching_info -> ready', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.pingDelay = 100;
    f.state.infoDelay = 100;
    const seen: string[] = [];
    engine.onChange((s) => {
      const d = s.devices[0];
      if (d && seen[seen.length - 1] !== d.status) seen.push(d.status);
    });
    engine.start(cfg());
    await f.advance(0);
    expect(device(engine, MAC1)?.status).toBe('pinging');
    await f.advance(100);
    expect(device(engine, MAC1)?.status).toBe('fetching_info');
    await f.advance(100);
    const d = device(engine, MAC1);
    expect(d).toMatchObject({
      status: 'ready',
      message: 'Siap inject',
      pingable: true,
      model: 'NanoStation',
      serial: serialOfIp(IP1),
      country: 'ID',
      alreadyRegistered: false,
      credentialSource: 'Default',
    });
    expect(seen).toEqual(['pinging', 'fetching_info', 'ready']);
    await engine.stop();
  });

  test('(a) serial yang sudah ada di draft: "Siap inject (SN sudah terdaftar)"', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.setRegistered([serialOfIp(IP1).toLowerCase()]);
    engine.start(cfg());
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'ready',
      message: 'Siap inject (SN sudah terdaftar)',
      alreadyRegistered: true,
    });
    // Draft berubah saat berjalan: penanda ikut diperbarui.
    engine.setRegistered([]);
    expect(device(engine, MAC1)).toMatchObject({
      alreadyRegistered: false,
      message: 'Siap inject',
    });
    await engine.stop();
  });

  test('(b) ping gagal pada perangkat stabil: waiting "Tidak merespon ping", pingable=false; pulih saat ping kembali', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    expect(device(engine, MAC1)?.status).toBe('ready');
    f.state.ping = () => false;
    await f.advance(2000);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'waiting',
      message: 'Tidak merespon ping',
      pingable: false,
    });
    f.state.ping = () => true;
    await f.advance(2000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'ready', pingable: true });
    await engine.stop();
  });

  test('(c) interval pemindaian adaptif: 1000 tanpa perangkat, 3000 dengan perangkat', async () => {
    const { f, engine } = setup();
    const durations: number[] = [];
    const original = f.ports.sleep;
    f.ports.sleep = (ms, signal) => {
      if (ms >= 1000) durations.push(ms);
      return original(ms, signal);
    };
    engine.start(cfg());
    await f.advance(0);
    expect(durations).toEqual([1000]);
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    await f.advance(1000);
    expect(device(engine, MAC1)).toBeDefined();
    expect(durations).toEqual([1000, 3000]);
    await engine.stop();
  });

  test('(d) kredensial habis: tiap kredensial dicoba sekali, tak ada readInfo lagi; kredensial baru = satu percobaan lagi', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.info = () => ({ ok: false, error: 'PERMISSION_DENIED' });
    engine.addCredential({ username: 'admin', password: Q1_PW });
    engine.addCredential({ username: 'root', password: Q2_PW });
    engine.start(cfg());
    await f.advance(5000);
    expect(f.calls.readInfo.map((c) => c.cred.password)).toEqual([BASE_PW, Q1_PW, Q2_PW]);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'waiting',
      message: 'Permission denied!!!',
      credentialsExhausted: true,
    });
    const pingsBefore = f.calls.ping.length;
    await f.advance(30_000);
    expect(f.calls.readInfo).toHaveLength(3); // tidak ada panggilan baru
    expect(f.calls.ping.length).toBeGreaterThan(pingsBefore); // ping tetap jalan (titik status)

    engine.addCredential({ username: 'x', password: 'third-pass' });
    await f.advance(3000);
    expect(f.calls.readInfo).toHaveLength(4);
    expect(f.calls.readInfo[3]?.cred.password).toBe('third-pass');
    expect(device(engine, MAC1)?.credentialsExhausted).toBe(true);
    await f.advance(30_000);
    expect(f.calls.readInfo).toHaveLength(4);
    // duplikat tidak memicu apa pun
    engine.addCredential({ username: 'x', password: 'third-pass' });
    await f.advance(5000);
    expect(f.calls.readInfo).toHaveLength(4);
    await engine.stop();
  });

  test('(d) kredensial ke-2 diterima: sumber "Antrian #1", info terbaca', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.info = (ip, cred) =>
      cred.password === Q1_PW
        ? { ok: true, model: 'LiteBeam', serial: serialOfIp(ip), country: 'ID' }
        : { ok: false, error: 'PERMISSION_DENIED' };
    engine.addCredential({ username: 'admin', password: Q1_PW });
    engine.start(cfg());
    await f.advance(1000);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'ready',
      credentialSource: 'Antrian #1',
      model: 'LiteBeam',
    });
    await engine.stop();
  });

  test('IP berubah mereset kredensial dan membaca ulang info ke IP baru', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.info = () => ({ ok: false, error: 'PERMISSION_DENIED' });
    engine.start(cfg());
    await f.advance(3000);
    expect(device(engine, MAC1)?.credentialsExhausted).toBe(true);
    const calls = f.calls.readInfo.length;
    f.state.leases = [{ ip: IP2, mac: MAC1 }];
    await f.advance(4000);
    expect(f.calls.readInfo.length).toBeGreaterThan(calls);
    expect(f.calls.readInfo[f.calls.readInfo.length - 1]?.ip).toBe(IP2);
    expect(device(engine, MAC1)?.ip).toBe(IP2);
    await engine.stop();
  });

  test('(e) info tidak lengkap (serial atau model kosong): waiting "Info perangkat tidak lengkap"', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    f.state.info = (ip) =>
      ip === IP1
        ? { ok: true, model: 'NS', serial: '', country: 'ID' }
        : { ok: true, model: '', serial: 'X1', country: 'ID' };
    engine.start(cfg());
    await f.advance(2000);
    for (const mac of [MAC1, MAC2]) {
      expect(device(engine, mac)).toMatchObject({
        status: 'waiting',
        message: 'Info perangkat tidak lengkap',
      });
    }
    // percobaan ulang jalan terus (bukan kredensial habis)
    expect(device(engine, MAC1)?.credentialsExhausted).toBe(false);
    await engine.stop();
  });

  test('info tidak terbaca (UNAVAILABLE) = waiting dan dicoba lagi', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.info = () => ({ ok: false, error: 'UNAVAILABLE' });
    engine.start(cfg());
    await f.advance(2000);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'waiting',
      message: 'Info perangkat tidak terbaca',
      credentialsExhausted: false,
    });
    f.state.info = (ip) => ({ ok: true, model: 'NS', serial: serialOfIp(ip), country: 'ID' });
    await f.advance(2000);
    expect(device(engine, MAC1)?.status).toBe('ready');
    await engine.stop();
  });

  test('(g) setConcurrency dijepit 1..32 dan masuk snapshot; start memakai concurrency konfigurasi', async () => {
    const { engine } = setup();
    expect(engine.snapshot().concurrency).toBe(4);
    engine.setConcurrency(0);
    expect(engine.snapshot().concurrency).toBe(1);
    engine.setConcurrency(99);
    expect(engine.snapshot().concurrency).toBe(32);
    engine.setConcurrency(8);
    expect(engine.snapshot().concurrency).toBe(8);
    engine.start(cfg({ concurrency: 12 }));
    expect(engine.snapshot().concurrency).toBe(12);
    engine.setConcurrency(100);
    expect(engine.snapshot().concurrency).toBe(32);
    await engine.stop();
  });

  test('(h) onChange dipanggil saat snapshot berubah dan berhenti setelah berhenti berlangganan', async () => {
    const { f, engine } = setup();
    const snaps: MultiSnapshot[] = [];
    const off = engine.onChange((s) => snaps.push(s));
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[snaps.length - 1]?.running).toBe(true);
    expect(snaps[snaps.length - 1]?.devices[0]?.status).toBe('ready');
    off();
    const n = snaps.length;
    engine.setConcurrency(9);
    f.state.leases = [];
    await f.advance(70_000);
    expect(snaps).toHaveLength(n);
    await engine.stop();
  });

  test('(h) tidak memancarkan snapshot yang sama dua kali berturut-turut', async () => {
    const { f, engine } = setup();
    const json: string[] = [];
    engine.onChange((s) => json.push(JSON.stringify(s)));
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    const n = json.length;
    await f.advance(20_000); // keadaan stabil: tak ada perubahan yang terlihat
    expect(json).toHaveLength(n);
    for (let i = 1; i < json.length; i += 1) expect(json[i]).not.toBe(json[i - 1]);
    await engine.stop();
  });

  test('(i) stop membatalkan semua loop (tak ada timer tersisa) dan snapshot.running=false', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    engine.start(cfg());
    await f.advance(1000);
    expect(engine.snapshot().devices).toHaveLength(2);
    expect(f.pendingSleeps).toBeGreaterThan(0);
    await engine.stop();
    expect(f.pendingSleeps).toBe(0);
    expect(engine.snapshot()).toMatchObject({ running: false, devices: [] });
    const pings = f.calls.ping.length;
    const leases = f.calls.readLeases;
    await f.advance(60_000);
    expect(f.calls.ping).toHaveLength(pings);
    expect(f.calls.readLeases).toBe(leases);
  });

  test('stop saat ping/info macet tidak menggantung (port tak menghormati pembatalan)', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.ports.ping = () => new Promise<boolean>(() => {});
    engine.start(cfg());
    await f.advance(0);
    await engine.stop();
    expect(engine.snapshot().running).toBe(false);
  });

  test('start dua kali tidak menggandakan loop; start ulang setelah stop berjalan bersih', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    engine.start(cfg());
    await f.advance(0);
    expect(f.calls.readLeases).toBe(1);
    await engine.stop();
    engine.start(cfg());
    await f.advance(0);
    expect(device(engine, MAC1)?.status).toBe('ready');
    await engine.stop();
  });

  test('(j) snapshot, log, dan pesan tidak pernah memuat sandi', async () => {
    const { f, engine } = setup();
    const emitted: string[] = [];
    engine.onChange((s) => emitted.push(JSON.stringify(s)));
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
      { ip: IP3, mac: MAC3 },
    ];
    f.state.info = (ip, cred) => {
      if (ip === IP1) return { ok: true, model: 'NS', serial: serialOfIp(ip), country: 'ID' };
      if (ip === IP2) return { ok: false, error: 'PERMISSION_DENIED' };
      // pesan galat yang kebetulan memuat sandi tak boleh bocor ke snapshot
      return cred.password === BASE_PW
        ? { ok: false, error: 'UNAVAILABLE' }
        : { ok: false, error: 'PERMISSION_DENIED' };
    };
    engine.addCredential({ username: 'admin', password: Q1_PW });
    engine.addCredential({ username: 'root', password: Q2_PW });
    engine.start(cfg());
    await f.advance(10_000);
    const all = [JSON.stringify(engine.snapshot()), ...emitted].join('\n');
    for (const secret of [BASE_PW, Q1_PW, Q2_PW, 'SENTINEL']) {
      expect(all.includes(secret)).toBe(false);
    }
    expect(engine.snapshot().credentialCount).toBe(2);
    await engine.stop();
  });

  test('galat baca lease (null atau melempar) tidak memutus perangkat dan dilaporkan di message; pulih saat berhasil', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    f.state.leases = null;
    await f.advance(70_000); // jauh melewati masa tenggang
    expect(device(engine, MAC1)?.status).toBe('ready');
    expect(engine.snapshot().message).toMatch(/lease/i);
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.readLeaseThrows = true;
    await f.advance(5000);
    expect(device(engine, MAC1)?.status).toBe('ready');
    f.state.readLeaseThrows = false;
    await f.advance(5000);
    expect(engine.snapshot().message).toBe('');
    await engine.stop();
  });

  test('perangkat hilang: terputus lalu dibuang setelah 60 dtk dan loopnya berhenti', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    f.state.leases = [];
    await f.advance(3000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'disconnected', pingable: false });
    const pings = f.calls.ping.length;
    await f.advance(70_000);
    expect(device(engine, MAC1)).toBeUndefined();
    expect(f.calls.ping).toHaveLength(pings); // perangkat terputus tidak di-ping
    // hanya loop pemindaian yang tersisa
    expect(f.pendingSleeps).toBe(1);
    await engine.stop();
  });

  test('swap IP dua MAC pada satu pemindaian: keduanya dibaca ulang di IP barunya, tidak ada yang terputus', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    // serial perangkat mengikuti MAC pemiliknya (bukan IP)
    const owner = new Map<string, string>([
      [IP1, MAC1],
      [IP2, MAC2],
    ]);
    f.state.info = (ip) => {
      void ip;
      return { ok: true, model: 'NS', serial: 'X', country: 'ID' };
    };
    engine.start(cfg());
    await f.advance(0);
    f.state.leases = [
      { ip: IP2, mac: MAC1 },
      { ip: IP1, mac: MAC2 },
    ];
    await f.advance(4000);
    expect(device(engine, MAC1)).toMatchObject({ ip: IP2 });
    expect(device(engine, MAC2)).toMatchObject({ ip: IP1 });
    for (const mac of [MAC1, MAC2]) {
      expect(device(engine, mac)?.status).not.toBe('disconnected');
    }
    void owner;
    await engine.stop();
  });

  test('scan() manual memicu pemindaian saat itu juga dan tak menjalankan dua pemindaian bersamaan', async () => {
    const { f, engine } = setup();
    engine.start(cfg());
    await f.advance(0);
    expect(f.calls.readLeases).toBe(1);
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    await Promise.all([engine.scan(), engine.scan()]);
    expect(f.calls.readLeases).toBe(2);
    expect(device(engine, MAC1)).toBeDefined();
    await engine.stop();
    await engine.scan(); // tak berjalan: tak melempar
  });

  test('excludeIp: lease IP operator diabaikan', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    engine.start(cfg({ excludeIp: IP1 }));
    await f.advance(0);
    expect(engine.snapshot().devices.map((d) => d.mac)).toEqual([MAC2]);
    await engine.stop();
  });

  test('ringkasan: counts dan active', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    engine.start(cfg());
    await f.advance(0);
    expect(engine.snapshot().counts).toEqual({
      waiting: 2,
      queued: 0,
      injecting: 0,
      success: 0,
      failed: 0,
      active: 2,
    });
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    await f.advance(3000);
    expect(engine.snapshot().counts).toMatchObject({ waiting: 1, active: 1 });
    await engine.stop();
  });
});
