import { describe, expect, test } from 'bun:test';
import {
  type DeviceRecord,
  MSG_TAKEN_OVER,
  newDevice,
  type ReconcileOptions,
  reconcileLeases,
} from './registry';
import type { DeviceStatus } from './types';

const OPTS: ReconcileOptions = { excludeIp: '', graceMs: 60_000 };
const A = 'AA:AA:AA:AA:AA:01';
const B = 'AA:AA:AA:AA:AA:02';
const C = 'AA:AA:AA:AA:AA:03';

function dev(
  mac: string,
  ip: string,
  status: DeviceStatus,
  patch: Partial<DeviceRecord> = {},
): DeviceRecord {
  return { ...newDevice(mac, ip, 0), status, ...patch };
}

describe('newDevice', () => {
  test('status waiting, indeks 0, pesan Menunggu', () => {
    const d = newDevice(A, '10.0.0.2', 5);
    expect(d).toMatchObject({
      mac: A,
      ip: '10.0.0.2',
      status: 'waiting',
      message: 'Menunggu',
      credentialIndex: 0,
      credentialsExhausted: false,
      alreadyRegistered: false,
      injectedThisSession: false,
      lastSeenAt: 5,
      log: [],
    });
  });
});

describe('reconcileLeases', () => {
  test('(a) MAC baru ditambahkan sebagai waiting', () => {
    const r = reconcileLeases([], [{ ip: '10.0.0.2', mac: A }], 100, OPTS);
    expect(r.added).toEqual([A]);
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]).toMatchObject({
      mac: A,
      ip: '10.0.0.2',
      status: 'waiting',
      lastSeenAt: 100,
    });
  });

  test('(b) IP berubah: ip diperbarui, kembali waiting dengan kredensial direset', () => {
    for (const status of [
      'ready',
      'failed',
      'waiting',
      'queued',
      'pinging',
      'fetching_info',
    ] as const) {
      const d = dev(A, '10.0.0.2', status, { credentialIndex: 2, credentialsExhausted: true });
      const r = reconcileLeases([d], [{ ip: '10.0.0.9', mac: A }], 50, OPTS);
      expect(r.ipChanged).toEqual([A]);
      expect(r.devices[0]).toMatchObject({
        ip: '10.0.0.9',
        status: 'waiting',
        credentialIndex: 0,
        credentialsExhausted: false,
      });
    }
  });

  test('(b) injecting dan success tidak diubah statusnya saat IP berubah (success tidak diproses ulang)', () => {
    for (const status of ['injecting', 'success'] as const) {
      const d = dev(A, '10.0.0.2', status, { message: 'x', credentialIndex: 1 });
      const r = reconcileLeases([d], [{ ip: '10.0.0.9', mac: A }], 50, OPTS);
      expect(r.ipChanged).toEqual([A]);
      expect(r.devices[0]).toMatchObject({
        ip: '10.0.0.9',
        status,
        message: 'x',
        credentialIndex: 1,
      });
    }
  });

  test('IP sama: status dan kredensial tidak diubah, lastSeenAt diperbarui', () => {
    const d = dev(A, '10.0.0.2', 'ready', { credentialIndex: 1, credentialsExhausted: true });
    const r = reconcileLeases([d], [{ ip: '10.0.0.2', mac: A }], 70, OPTS);
    expect(r.ipChanged).toEqual([]);
    expect(r.devices[0]).toMatchObject({
      status: 'ready',
      credentialIndex: 1,
      credentialsExhausted: true,
      lastSeenAt: 70,
    });
  });

  test('(c) IP diambil alih MAC lain: perangkat lama disconnected', () => {
    const old = dev(A, '10.0.0.2', 'ready');
    const r = reconcileLeases([old], [{ ip: '10.0.0.2', mac: B }], 10, OPTS);
    const a = r.devices.find((d) => d.mac === A);
    expect(a).toMatchObject({ status: 'disconnected', message: MSG_TAKEN_OVER });
    expect(r.added).toEqual([B]);
  });

  test('(c) perangkat injecting tidak diputus walau IP-nya diambil alih', () => {
    const old = dev(A, '10.0.0.2', 'injecting');
    const r = reconcileLeases([old], [{ ip: '10.0.0.2', mac: B }], 10, OPTS);
    expect(r.devices.find((d) => d.mac === A)?.status).toBe('injecting');
  });

  test('(d) MAC hilang: disconnected "Terputus", dipertahankan selama masa tenggang', () => {
    const d = dev(A, '10.0.0.2', 'ready', { lastSeenAt: 0 });
    const r = reconcileLeases([d], [], 59_999, OPTS);
    expect(r.devices[0]).toMatchObject({ status: 'disconnected', message: 'Terputus' });
    expect(r.removed).toEqual([]);
  });

  test('(d) dibuang setelah masa tenggang (>= graceMs), kecuali injecting', () => {
    const gone = dev(A, '10.0.0.2', 'disconnected', { lastSeenAt: 0 });
    const busy = dev(B, '10.0.0.3', 'injecting', { lastSeenAt: 0 });
    const r = reconcileLeases([gone, busy], [], 60_000, OPTS);
    expect(r.removed).toEqual([A]);
    expect(r.devices.map((d) => d.mac)).toEqual([B]);
    expect(r.devices[0]?.status).toBe('injecting');
  });

  test('(d) perangkat success yang hilang menjadi disconnected', () => {
    const d = dev(A, '10.0.0.2', 'success');
    const r = reconcileLeases([d], [], 1, OPTS);
    expect(r.devices[0]?.status).toBe('disconnected');
  });

  test('(e) lease ber-IP excludeIp diabaikan; lease tanpa MAC diabaikan', () => {
    const r = reconcileLeases(
      [],
      [
        { ip: '10.0.0.50', mac: A },
        { ip: '10.0.0.51', mac: '' },
        { ip: '10.0.0.52', mac: B },
      ],
      1,
      { ...OPTS, excludeIp: '10.0.0.50' },
    );
    expect(r.added).toEqual([B]);
  });

  test('(f) swap: A dan B bertukar IP pada satu pemindaian, keduanya ipChanged dan tidak ada yang disconnected', () => {
    const a = dev(A, '10.0.0.2', 'ready', { credentialIndex: 1 });
    const b = dev(B, '10.0.0.3', 'ready', { credentialIndex: 2 });
    const r = reconcileLeases(
      [a, b],
      [
        { ip: '10.0.0.3', mac: A },
        { ip: '10.0.0.2', mac: B },
      ],
      10,
      OPTS,
    );
    expect(r.ipChanged.sort()).toEqual([A, B]);
    const [ra, rb] = [r.devices.find((d) => d.mac === A), r.devices.find((d) => d.mac === B)];
    expect(ra).toMatchObject({ ip: '10.0.0.3', status: 'waiting', credentialIndex: 0 });
    expect(rb).toMatchObject({ ip: '10.0.0.2', status: 'waiting', credentialIndex: 0 });
    expect(r.removed).toEqual([]);
  });

  test('(g) MAC muncul lagi setelah disconnected kembali waiting dan lastSeenAt diperbarui', () => {
    const d = dev(A, '10.0.0.2', 'disconnected', {
      lastSeenAt: 0,
      credentialIndex: 3,
      credentialsExhausted: true,
    });
    const same = reconcileLeases([d], [{ ip: '10.0.0.2', mac: A }], 30_000, OPTS);
    expect(same.ipChanged).toEqual([]);
    expect(same.devices[0]).toMatchObject({
      status: 'waiting',
      lastSeenAt: 30_000,
      credentialIndex: 0,
      credentialsExhausted: false,
    });
    const moved = reconcileLeases([d], [{ ip: '10.0.0.9', mac: A }], 30_000, OPTS);
    expect(moved.ipChanged).toEqual([A]);
    expect(moved.devices[0]).toMatchObject({ ip: '10.0.0.9', status: 'waiting' });
  });

  test('(h) injectedThisSession, alreadyRegistered, info, dan log dipertahankan lintas pembaruan IP', () => {
    const d = dev(A, '10.0.0.2', 'success', {
      injectedThisSession: true,
      alreadyRegistered: true,
      model: 'M',
      serial: 'S1',
      log: ['satu'],
    });
    const r = reconcileLeases([d], [{ ip: '10.0.0.9', mac: A }], 5, OPTS);
    expect(r.devices[0]).toMatchObject({
      injectedThisSession: true,
      alreadyRegistered: true,
      model: 'M',
      serial: 'S1',
      log: ['satu'],
    });
    const gone = reconcileLeases([d], [], 5, OPTS);
    expect(gone.devices[0]).toMatchObject({ injectedThisSession: true, alreadyRegistered: true });
  });

  test('murni: masukan tidak diubah dan hasil tidak berbagi objek/array log', () => {
    const d = dev(A, '10.0.0.2', 'ready', { log: ['a'] });
    const snapshot = JSON.stringify(d);
    const r = reconcileLeases([d], [{ ip: '10.0.0.9', mac: A }], 5, OPTS);
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(r.devices[0]).not.toBe(d);
    expect(r.devices[0]?.log).not.toBe(d.log);
  });

  test('perangkat baru mengambil IP perangkat lama yang tak terlihat: lama disconnected, baru ditambahkan', () => {
    const old = dev(A, '10.0.0.2', 'waiting');
    const r = reconcileLeases(
      [old],
      [
        { ip: '10.0.0.2', mac: C },
        { ip: '10.0.0.3', mac: B },
      ],
      1,
      OPTS,
    );
    expect(r.added.sort()).toEqual([B, C]);
    expect(r.devices.find((d) => d.mac === A)?.message).toBe(MSG_TAKEN_OVER);
  });
});
