// Tes engine Multi bagian inject, antrean, blokir, dan peristiwa (Task 5). Bagian pemindaian ada di `engine.test.ts`.

import { describe, expect, test } from 'bun:test';
import { createMultiEngine, type MultiStartConfig } from './engine';
import { createFakePorts, serialOfIp } from './fakes';
import type { Credential } from './types';

const MAC1 = 'AA:AA:AA:AA:AA:01';
const MAC2 = 'AA:AA:AA:AA:AA:02';
const MAC3 = 'AA:AA:AA:AA:AA:03';
const IP1 = '10.0.0.2';
const IP2 = '10.0.0.3';
const IP3 = '10.0.0.4';

const BASE_PW = 'SENTINEL-BASE-PASSWORD';
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

type Engine = ReturnType<typeof createMultiEngine>;
type Fake = ReturnType<typeof createFakePorts>;

function setup() {
  const f = createFakePorts();
  const engine = createMultiEngine(f.ports);
  return { f, engine };
}

const device = (engine: Engine, mac: string) =>
  engine.snapshot().devices.find((d) => d.mac === mac);
const statusOf = (engine: Engine, mac: string) => device(engine, mac)?.status;
const pendingInjects = (f: Fake) => f.calls.inject.filter((c) => !c.settled);

const MACS = [MAC1, MAC2, MAC3, 'AA:AA:AA:AA:AA:04', 'AA:AA:AA:AA:AA:05'];
const IPS = [IP1, IP2, IP3, '10.0.0.5', '10.0.0.6'];

async function withReady(n: number, patch: Partial<MultiStartConfig> = {}) {
  const { f, engine } = setup();
  f.state.leases = MACS.slice(0, n).map((mac, i) => ({ ip: IPS[i] as string, mac }));
  engine.start(cfg(patch));
  await f.advance(0);
  return { f, engine };
}

describe('engine: inject, antrean, dan peristiwa', () => {
  test('(a) injectDevice: queued -> injecting -> success "Selesai" dengan tepat satu peristiwa injected', async () => {
    const { f, engine } = await withReady(1);
    const statusAtEvent: (string | undefined)[] = [];
    const originalAdd = f.ports.events.add;
    f.ports.events.add = (e) => {
      statusAtEvent.push(statusOf(engine, MAC1));
      originalAdd(e);
    };
    engine.injectDevice(MAC1);
    expect(statusOf(engine, MAC1)).toBe('queued');
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('injecting');
    const call = pendingInjects(f)[0];
    expect(call).toMatchObject({ ip: IP1, firmwareCode: 'XW' });
    expect(call?.cred).toEqual(BASE);
    f.finishInject(IP1);
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({
      status: 'success',
      message: 'Selesai',
      injectedThisSession: true,
    });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toEqual({
      eventId: expect.any(String),
      mac: MAC1,
      serial: serialOfIp(IP1),
      model: 'NanoStation',
      injectedAt: new Date(f.time).toISOString(),
      target: cfg().target,
    });
    // peristiwa ditulis SEBELUM status success terlihat
    expect(statusAtEvent).toEqual(['injecting']);
    expect(engine.pendingEvents()).toHaveLength(1);
    await engine.stop();
  });

  test('(a) tidak ada peristiwa bila inject gagal atau dibatalkan; gagal bisa dicoba lagi', async () => {
    const { f, engine } = await withReady(2);
    engine.injectDevice(MAC1);
    engine.injectDevice(MAC2);
    await f.advance(0);
    f.finishInject(IP1, { ok: false, stage: 'failed', message: 'Koneksi putus' });
    f.finishInject(IP2, { ok: false, stage: 'cancelled', message: 'x' });
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({ status: 'failed', message: 'Koneksi putus' });
    expect(device(engine, MAC2)).toMatchObject({ status: 'failed', message: 'Dibatalkan' });
    expect(f.events).toHaveLength(0);
    engine.injectDevice(MAC1); // Retry
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('injecting');
    expect(f.calls.inject).toHaveLength(3);
    await engine.stop();
  });

  test('(b) paralelisme: limit 2 dengan 5 perangkat, paling banyak 2 injecting; setConcurrency tak memutus yang berjalan', async () => {
    const { f, engine } = await withReady(5, { concurrency: 2 });
    engine.injectAll();
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(2);
    expect(engine.snapshot().counts).toMatchObject({ injecting: 2, queued: 3 });
    engine.setConcurrency(1); // turun saat 2 berjalan
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(2); // tidak diputus
    f.finishInject(IP1);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(1); // belum ada slot baru (running 1, limit 1)
    f.finishInject(IP2);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(1); // satu per waktu
    engine.setConcurrency(4);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(3);
    expect(engine.snapshot().counts).toMatchObject({ injecting: 3, queued: 0, success: 2 });
    await engine.stop();
  });

  test('(c) injectAll hanya menyapu perangkat ready; stopQueue membatalkan antrean tetapi membiarkan yang injecting selesai', async () => {
    const { f, engine } = await withReady(3, { concurrency: 1 });
    engine.injectAll();
    await f.advance(0);
    expect(engine.snapshot().counts).toMatchObject({ injecting: 1, queued: 2 });
    engine.stopQueue();
    expect(engine.snapshot().queueStopped).toBe(true);
    expect(device(engine, MAC2)).toMatchObject({
      status: 'ready',
      message: 'Dibatalkan (masih antri)',
    });
    expect(statusOf(engine, MAC3)).toBe('ready');
    expect(statusOf(engine, MAC1)).toBe('injecting');
    f.finishInject(IP1);
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    expect(pendingInjects(f)).toHaveLength(0); // tidak ada slot baru yang jalan
    expect(f.events).toHaveLength(1);
    await engine.stop();
  });

  test('(c) injectDevice saat antrean dihentikan ditolak dengan pesan; injectAll mencabut penghentian', async () => {
    const { f, engine } = await withReady(2);
    engine.stopQueue();
    engine.injectDevice(MAC1);
    expect(statusOf(engine, MAC1)).toBe('ready');
    expect(engine.snapshot().message).toBe('Antrian sedang dihentikan operator');
    engine.injectAll();
    expect(engine.snapshot().queueStopped).toBe(false);
    expect(engine.snapshot().message).toBe('');
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(2);
    await engine.stop();
  });

  test('(c) cancelAll membatalkan yang antre dan yang injecting (failed "Dibatalkan"); Auto Inject dinyalakan mencabut penghentian', async () => {
    const { f, engine } = await withReady(3, { concurrency: 1 });
    engine.injectAll();
    await f.advance(0);
    engine.cancelAll();
    await f.advance(0);
    expect(engine.snapshot().queueStopped).toBe(true);
    expect(device(engine, MAC1)).toMatchObject({ status: 'failed', message: 'Dibatalkan' });
    expect(device(engine, MAC2)).toMatchObject({
      status: 'ready',
      message: 'Dibatalkan (masih antri)',
    });
    expect(statusOf(engine, MAC3)).toBe('ready');
    expect(f.events).toHaveLength(0);
    engine.setAutoInject(true);
    expect(engine.snapshot().queueStopped).toBe(false);
    await f.advance(0);
    expect(f.calls.inject.length).toBeGreaterThan(1);
    await engine.stop();
  });

  test('cancelDevice: antre -> ready; injecting -> failed "Dibatalkan"', async () => {
    const { f, engine } = await withReady(2, { concurrency: 1 });
    engine.injectDevice(MAC1);
    engine.injectDevice(MAC2);
    await f.advance(0);
    engine.cancelDevice(MAC2);
    expect(device(engine, MAC2)).toMatchObject({
      status: 'ready',
      message: 'Dibatalkan (masih antri)',
    });
    engine.cancelDevice(MAC1);
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({ status: 'failed', message: 'Dibatalkan' });
    await engine.stop();
  });

  test('(d) blokir: queued kembali ready, tak ada slot baru, inject manual ditolak, injecting selesai normal', async () => {
    const { f, engine } = await withReady(3, { concurrency: 1 });
    engine.injectAll();
    await f.advance(0);
    expect(engine.snapshot().counts).toMatchObject({ injecting: 1, queued: 2 });
    engine.setBlocked('Draft penuh');
    expect(engine.snapshot().blockedReason).toBe('Draft penuh');
    expect(device(engine, MAC2)).toMatchObject({
      status: 'ready',
      message: 'Ditahan: Draft penuh',
    });
    expect(statusOf(engine, MAC3)).toBe('ready');
    expect(statusOf(engine, MAC1)).toBe('injecting');
    f.finishInject(IP1);
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    expect(f.events).toHaveLength(1);
    expect(pendingInjects(f)).toHaveLength(0);
    engine.injectDevice(MAC2);
    expect(statusOf(engine, MAC2)).toBe('ready');
    expect(engine.snapshot().message).toContain('Draft penuh');
    engine.injectAll();
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(0);
    // lepas blokir: inject manual jalan lagi
    engine.setBlocked(null);
    expect(engine.snapshot().message).toBe('');
    engine.injectDevice(MAC2);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(1);
    await engine.stop();
  });

  test('(d) Auto Inject tidak mengantre selama diblokir dan melanjutkan setelah blokir dilepas', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.setBlocked('Draft belum termuat');
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('ready');
    expect(f.calls.inject).toHaveLength(0);
    engine.setBlocked(null);
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('injecting');
    await engine.stop();
  });

  test('(e) swap IP: lease dicocokkan ulang sebelum inject; selisih = kembali waiting tanpa inject ke IP lama', async () => {
    const { f, engine } = await withReady(2);
    f.state.leases = [
      { ip: IP2, mac: MAC1 },
      { ip: IP1, mac: MAC2 },
    ]; // bertukar IP; pemindaian berkala belum sempat melihatnya
    engine.injectDevice(MAC1);
    engine.injectDevice(MAC2);
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(0);
    expect(device(engine, MAC1)).toMatchObject({ ip: IP2, status: 'waiting' });
    expect(device(engine, MAC2)).toMatchObject({ ip: IP1, status: 'waiting' });
    expect(device(engine, MAC1)?.message).toBe('IP berubah, memeriksa ulang');
    // setelah dibaca ulang di IP baru, inject menuju IP yang benar
    await f.advance(2000);
    expect(statusOf(engine, MAC1)).toBe('ready');
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(1);
    expect(pendingInjects(f)[0]?.ip).toBe(IP2);
    await engine.stop();
  });

  test('(e) lease perangkat sudah hilang saat giliran inject: tidak di-inject', async () => {
    const { f, engine } = await withReady(1);
    f.state.leases = [];
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(0);
    expect(statusOf(engine, MAC1)).toBe('disconnected');
    await engine.stop();
  });

  test('(e) lease tak terbaca saat verifikasi: tidak inject, kembali ready dengan pesan', async () => {
    const { f, engine } = await withReady(1);
    f.state.leases = null;
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(0);
    expect(device(engine, MAC1)?.status).toBe('ready');
    expect(device(engine, MAC1)?.message).toMatch(/lease/i);
    await engine.stop();
  });

  test('(e) dua MAC mengaku IP yang sama: tidak inject (ambigu)', async () => {
    const { f, engine } = await withReady(2);
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP1, mac: MAC2 },
    ];
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(0);
    expect(statusOf(engine, MAC1)).toBe('waiting');
    await engine.stop();
  });

  test('IP berubah saat masih antre: job dibatalkan tanpa menimpa status dari registri dan tak ikut ter-inject', async () => {
    const { f, engine } = await withReady(2, { concurrency: 1 });
    engine.injectDevice(MAC1);
    engine.injectDevice(MAC2);
    await f.advance(0);
    expect(statusOf(engine, MAC2)).toBe('queued');
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IPS[4] as string, mac: MAC2 },
    ];
    await f.advance(3000);
    expect(statusOf(engine, MAC2)).not.toBe('queued');
    f.finishInject(IP1);
    await f.advance(100);
    // MAC2 tidak ikut ter-inject lewat slot yang kosong
    expect(f.calls.inject.filter((c) => c.ip === IP2)).toHaveLength(0);
    await engine.stop();
  });

  test('(f) perangkat success yang dicabut lalu muncul lagi: ready, ditandai sesi, tak di-auto-inject; manual boleh', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.injectMode = 'auto';
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    expect(f.calls.inject).toHaveLength(1);
    f.state.leases = [];
    await f.advance(3000);
    expect(statusOf(engine, MAC1)).toBe('disconnected');
    await f.advance(70_000);
    expect(device(engine, MAC1)).toBeUndefined();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    await f.advance(3000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'ready', injectedThisSession: true });
    expect(f.calls.inject).toHaveLength(1); // Auto Inject tidak mengulang
    engine.injectAll(); // Inject All juga melewati perangkat yang sudah di-inject di sesi ini
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(1);
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(f.calls.inject).toHaveLength(2);
    await engine.stop();
  });

  test('(f) perangkat success tetap success saat ping gagal (reboot) dan tidak di-inject ulang', async () => {
    const { f, engine } = await withReady(1);
    engine.injectDevice(MAC1);
    await f.advance(0);
    f.finishInject(IP1);
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    f.state.ping = () => false;
    await f.advance(5000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'success', pingable: false });
    f.state.ping = () => true;
    await f.advance(5000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'success', pingable: true });
    engine.injectAll();
    engine.injectDevice(MAC1);
    await f.advance(100);
    expect(f.calls.inject).toHaveLength(1);
    expect(f.events).toHaveLength(1);
    await engine.stop();
  });

  test('(f) perangkat success yang IP-nya berubah tidak diproses ulang', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.injectMode = 'auto';
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    f.state.leases = [{ ip: IP2, mac: MAC1 }];
    await f.advance(4000);
    expect(device(engine, MAC1)).toMatchObject({ status: 'success', ip: IP2 });
    expect(f.calls.inject).toHaveLength(1);
    await engine.stop();
  });

  test('(g) Auto Inject melewati alreadyRegistered; inject manual boleh', async () => {
    const { f, engine } = setup();
    f.state.leases = [
      { ip: IP1, mac: MAC1 },
      { ip: IP2, mac: MAC2 },
    ];
    engine.setRegistered([serialOfIp(IP1)]);
    f.state.injectMode = 'auto';
    engine.start(cfg({ autoInject: true }));
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('ready');
    expect(statusOf(engine, MAC2)).toBe('success');
    expect(f.calls.inject.map((c) => c.ip)).toEqual([IP2]);
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(statusOf(engine, MAC1)).toBe('success');
    expect(f.calls.inject.map((c) => c.ip)).toEqual([IP2, IP1]);
    await engine.stop();
  });

  test('Auto Inject: menyalakannya menyapu perangkat yang sudah ready', async () => {
    const { f, engine } = await withReady(2);
    expect(f.calls.inject).toHaveLength(0);
    engine.setAutoInject(true);
    await f.advance(0);
    expect(pendingInjects(f)).toHaveLength(2);
    await engine.stop();
  });

  test('(h) ackInjected membuang peristiwa; satu inject = satu peristiwa; bertahan setelah berhenti', async () => {
    const { f, engine } = await withReady(2);
    f.state.injectMode = 'auto';
    engine.injectAll();
    await f.advance(0);
    const events = engine.pendingEvents();
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(2);
    engine.ackInjected([events[0]?.eventId as string]);
    expect(engine.pendingEvents().map((e) => e.eventId)).toEqual([events[1]?.eventId as string]);
    engine.ackInjected(['tidak-ada']);
    expect(engine.pendingEvents()).toHaveLength(1);
    await f.advance(10_000);
    expect(engine.pendingEvents()).toHaveLength(1);
    await engine.stop();
    expect(engine.pendingEvents()).toHaveLength(1);
  });

  test('(h) peristiwa memakai target batch yang dikonfigurasi saat start', async () => {
    const { f, engine } = await withReady(1, {
      target: {
        itemId: 'item-9',
        itemLabel: 'LiteBeam',
        buId: 'bu-9',
        buLabel: 'BU 9',
        locationId: 'loc-9',
        locationLabel: 'Lokasi 9',
      },
    });
    f.state.injectMode = 'auto';
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(engine.pendingEvents()[0]?.target).toMatchObject({ itemId: 'item-9', buId: 'bu-9' });
    await engine.stop();
  });

  test('(i) prepareBridge memanggil port, hasilnya masuk snapshot.message, dan tak pernah otomatis', async () => {
    const { f, engine } = await withReady(1);
    expect(f.calls.ensureBridgePorts).toBe(0);
    f.state.bridgeResult = { ok: false, message: 'Bridge gagal: ether2' };
    const r = await engine.prepareBridge();
    expect(r).toEqual({ ok: false, message: 'Bridge gagal: ether2' });
    expect(f.calls.ensureBridgePorts).toBe(1);
    expect(engine.snapshot().message).toBe('Bridge gagal: ether2');
    f.ports.ensureBridgePorts = async () => {
      throw new Error('ssh putus');
    };
    const r2 = await engine.prepareBridge();
    expect(r2.ok).toBe(false);
    await engine.stop();
  });

  test('(j) log perangkat berisi progres berstempel waktu; pesan terakhir menjadi status', async () => {
    const { f, engine } = await withReady(1);
    engine.injectDevice(MAC1);
    await f.advance(0);
    pendingInjects(f)[0]?.progress('Mengirim skrip');
    await f.advance(0);
    const d = device(engine, MAC1);
    expect(d?.message).toBe('Mengirim skrip');
    expect(d?.log.some((l) => /^\[\d\d:\d\d:\d\d\] Mengirim skrip$/.test(l))).toBe(true);
    expect(d?.log.some((l) => l.includes('Mulai inject (10.0.0.2)'))).toBe(true);
    await engine.stop();
  });

  test('progres atau galat yang memuat sandi disamarkan di snapshot', async () => {
    const { f, engine } = await withReady(1);
    const emitted: string[] = [];
    engine.onChange((s) => emitted.push(JSON.stringify(s)));
    engine.injectDevice(MAC1);
    await f.advance(0);
    pendingInjects(f)[0]?.progress(`login ${BASE_PW} gagal`);
    await f.advance(0);
    f.finishInject(IP1, { ok: false, stage: 'failed', message: `ditolak: ${BASE_PW}` });
    await f.advance(0);
    const all = [JSON.stringify(engine.snapshot()), ...emitted].join('\n');
    expect(all.includes(BASE_PW)).toBe(false);
    expect(device(engine, MAC1)?.message).toBe('ditolak: ***');
    await engine.stop();
  });

  test('(k) port inject yang melempar menjadi failed, bukan crash engine', async () => {
    const { f, engine } = await withReady(2);
    f.state.injectThrows = new Error('boom');
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({ status: 'failed', message: 'boom' });
    expect(f.events).toHaveLength(0);
    f.state.injectThrows = null;
    expect(statusOf(engine, MAC2)).toBe('ready');
    await engine.stop();
  });

  test('gagal menulis peristiwa: perangkat ditandai gagal dicatat dan tetap tak di-inject ulang otomatis', async () => {
    const { f, engine } = await withReady(1);
    f.state.injectMode = 'auto';
    f.ports.events.add = () => {
      throw new Error('disk penuh');
    };
    engine.injectDevice(MAC1);
    await f.advance(0);
    expect(device(engine, MAC1)).toMatchObject({ status: 'failed', injectedThisSession: true });
    expect(device(engine, MAC1)?.message).toContain('gagal dicatat');
    await engine.stop();
  });

  test('injectDevice pada perangkat yang kredensialnya habis = coba ulang kredensial dari awal (Retry)', async () => {
    const { f, engine } = setup();
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.info = () => ({ ok: false, error: 'PERMISSION_DENIED' });
    engine.start(cfg());
    await f.advance(3000);
    expect(f.calls.readInfo).toHaveLength(1);
    expect(device(engine, MAC1)?.credentialsExhausted).toBe(true);
    f.state.info = (ip) => ({ ok: true, model: 'NS', serial: serialOfIp(ip), country: 'ID' });
    engine.injectDevice(MAC1);
    await f.advance(2000);
    expect(f.calls.readInfo).toHaveLength(2);
    expect(statusOf(engine, MAC1)).toBe('ready');
    await engine.stop();
  });

  test('aksi pada perangkat tak dikenal, belum siap, atau engine berhenti tak berefek dan tak melempar', async () => {
    const { f, engine } = setup();
    engine.injectDevice(MAC1);
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    f.state.ping = () => false;
    engine.start(cfg());
    await f.advance(0);
    engine.injectDevice('FF:FF:FF:FF:FF:FF');
    engine.injectDevice(MAC1);
    engine.cancelDevice('FF:FF:FF:FF:FF:FF');
    expect(f.calls.inject).toHaveLength(0);
    await engine.stop();
    engine.injectAll();
    engine.stopQueue();
    engine.cancelAll();
    engine.cancelDevice(MAC1);
  });

  test('interval pemindaian 5000 selama ada perangkat injecting', async () => {
    const { f, engine } = setup();
    const durations: number[] = [];
    const original = f.ports.sleep;
    f.ports.sleep = (ms, signal) => {
      if (ms >= 1000) durations.push(ms);
      return original(ms, signal);
    };
    f.state.leases = [{ ip: IP1, mac: MAC1 }];
    engine.start(cfg());
    await f.advance(0);
    engine.injectDevice(MAC1);
    await f.advance(3000); // pemindaian berikutnya terjadi saat injecting
    expect(durations).toContain(5000);
    await engine.stop();
  });

  test('stop saat inject berjalan membatalkannya (tanpa peristiwa) dan tidak menggantung', async () => {
    const { f, engine } = await withReady(2, { concurrency: 1 });
    engine.injectAll();
    await f.advance(0);
    await engine.stop();
    expect(f.pendingSleeps).toBe(0);
    expect(f.events).toHaveLength(0);
    expect(f.calls.inject).toHaveLength(1);
    expect(f.calls.inject[0]?.settled).toBe(true);
  });
});
