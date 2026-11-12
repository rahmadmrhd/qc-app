import { describe, expect, test } from 'bun:test';
import type { PendingEntry } from './pending';
import {
  canInject,
  INITIAL_SESSION,
  reduceSession,
  type SessionEvent,
  type SessionState,
  shouldAutoInject,
} from './session-machine';

const ctx = { interfaceCount: 3 };
const run = (state: SessionState, ...events: SessionEvent[]): SessionState =>
  events.reduce((s, e) => reduceSession(s, e, ctx), state);

/** Keadaan siap inject: merk, firmware, perangkat dan router hidup, serial terbaca. */
const ready = (): SessionState =>
  run(
    INITIAL_SESSION,
    { type: 'select', brand: 'mikrotik', firmwareCode: 'AC' },
    { type: 'ping-router', ok: true },
    { type: 'ping-device', ok: true, serial: 'AB12' },
  );

const entry = (serial: string): PendingEntry => ({
  serial,
  brand: 'mikrotik',
  tipe: 'hAP',
  date: '2026-11-12',
  timestamp: '2026-11-12T08:00:00.000Z',
});

describe('reduceSession', () => {
  test('keadaan awal kosong dan tidak berubah oleh reduksi (murni)', () => {
    expect(INITIAL_SESSION).toEqual({
      brand: null,
      firmwareCode: null,
      devicePingable: false,
      routerPingable: false,
      serial: '',
      injecting: false,
      autoInject: false,
      bridgeIndex: 0,
      lastOutcome: 'none',
    });
    const before = structuredClone(INITIAL_SESSION);
    reduceSession(INITIAL_SESSION, { type: 'select', brand: 'ubiquiti', firmwareCode: 'WA' }, ctx);
    expect(INITIAL_SESSION).toEqual(before);
  });

  test('select mengisi merk dan firmware', () => {
    const s = run(INITIAL_SESSION, { type: 'select', brand: 'ubiquiti', firmwareCode: null });
    expect(s.brand).toBe('ubiquiti');
    expect(s.firmwareCode).toBeNull();
  });

  test('inject-start kedua saat injecting diabaikan (penjaga re-entry)', () => {
    const started = run(ready(), { type: 'inject-start' });
    expect(started.injecting).toBe(true);
    const again = reduceSession(started, { type: 'inject-start' }, ctx);
    expect(again).toEqual(started);
  });

  test('inject-start tanpa syarat (tanpa serial/firmware) diabaikan', () => {
    const s = run(INITIAL_SESSION, { type: 'inject-start' });
    expect(s.injecting).toBe(false);
  });

  test('inject-done success menaikkan bridgeIndex dan mengosongkan serial; failed/cancelled tidak menaikkan dan melepas penjaga', () => {
    const ok = run(ready(), { type: 'inject-start' }, { type: 'inject-done', outcome: 'success' });
    expect(ok).toMatchObject({
      injecting: false,
      bridgeIndex: 1,
      serial: '',
      lastOutcome: 'success',
    });

    for (const outcome of ['failed', 'cancelled'] as const) {
      const s = run(ready(), { type: 'inject-start' }, { type: 'inject-done', outcome });
      expect(s).toMatchObject({
        injecting: false,
        bridgeIndex: 0,
        serial: 'AB12',
        lastOutcome: outcome,
      });
      // penjaga dilepas: inject dapat dimulai lagi
      expect(run(s, { type: 'inject-start' }).injecting).toBe(true);
    }
  });

  test('bridgeIndex kembali ke 0 setelah melewati interface terakhir', () => {
    let s = ready();
    for (let i = 0; i < 3; i += 1) {
      s = run(
        s,
        { type: 'inject-start' },
        { type: 'inject-done', outcome: 'success' },
        { type: 'ping-device', ok: true, serial: `SN${i}` },
      );
    }
    expect(s.bridgeIndex).toBe(0);
  });

  test('inject-done tanpa inject berjalan diabaikan (tidak memutar bridge dua kali)', () => {
    const s = run(ready(), { type: 'inject-done', outcome: 'success' });
    expect(s).toEqual(ready());
  });

  test('ping-router hidup kembali setelah mati mengembalikan bridgeIndex ke 0', () => {
    const advanced = run(
      ready(),
      { type: 'inject-start' },
      { type: 'inject-done', outcome: 'success' },
    );
    expect(advanced.bridgeIndex).toBe(1);
    const down = run(advanced, { type: 'ping-router', ok: false });
    expect(down.routerPingable).toBe(false);
    expect(down.bridgeIndex).toBe(1); // belum kembali hidup
    const up = run(down, { type: 'ping-router', ok: true });
    expect(up.routerPingable).toBe(true);
    expect(up.bridgeIndex).toBe(0);
  });

  test('ping-router tetap hidup tidak mengubah bridgeIndex', () => {
    const advanced = run(
      ready(),
      { type: 'inject-start' },
      { type: 'inject-done', outcome: 'success' },
    );
    expect(run(advanced, { type: 'ping-router', ok: true }).bridgeIndex).toBe(1);
  });

  test('ping-device turun mengosongkan serial', () => {
    const s = run(ready(), { type: 'ping-device', ok: false, serial: 'AB12' });
    expect(s.devicePingable).toBe(false);
    expect(s.serial).toBe('');
    expect(canInject(s)).toBe(false);
  });

  test('ping-device hidup mengisi serial dari pembacaan terbaru', () => {
    const s = run(ready(), { type: 'ping-device', ok: true, serial: 'CD34' });
    expect(s.devicePingable).toBe(true);
    expect(s.serial).toBe('CD34');
  });

  test('toggle-auto menyalakan dan mematikan auto-inject', () => {
    expect(run(INITIAL_SESSION, { type: 'toggle-auto', on: true }).autoInject).toBe(true);
    expect(
      run(INITIAL_SESSION, { type: 'toggle-auto', on: true }, { type: 'toggle-auto', on: false })
        .autoInject,
    ).toBe(false);
  });

  test('reset menonaktifkan auto dan mengosongkan keadaan', () => {
    const busy = run(
      ready(),
      { type: 'toggle-auto', on: true },
      { type: 'inject-start' },
      { type: 'inject-done', outcome: 'success' },
    );
    expect(busy.bridgeIndex).toBe(1);
    expect(run(busy, { type: 'reset' })).toEqual(INITIAL_SESSION);
  });

  test('interfaceCount 0 tidak menyebabkan indeks liar', () => {
    const s = reduceSession(
      run(ready(), { type: 'inject-start' }),
      { type: 'inject-done', outcome: 'success' },
      { interfaceCount: 0 },
    );
    expect(s.bridgeIndex).toBe(0);
  });
});

describe('canInject', () => {
  test('canInject false tanpa firmware atau serial', () => {
    expect(canInject(ready())).toBe(true);
    expect(canInject({ ...ready(), firmwareCode: null })).toBe(false);
    expect(canInject({ ...ready(), firmwareCode: '' })).toBe(false);
    expect(canInject({ ...ready(), serial: '' })).toBe(false);
    expect(canInject({ ...ready(), brand: null })).toBe(false);
    expect(canInject({ ...ready(), injecting: true })).toBe(false);
  });
});

describe('shouldAutoInject', () => {
  test('true bila auto aktif, siap inject, dan serial belum terdaftar', () => {
    const s = run(ready(), { type: 'toggle-auto', on: true });
    expect(shouldAutoInject(s, [])).toBe(true);
    expect(shouldAutoInject(s, [entry('LAIN')])).toBe(true);
  });

  test('shouldAutoInject false bila serial sudah terdaftar atau auto mati', () => {
    const on = run(ready(), { type: 'toggle-auto', on: true });
    expect(shouldAutoInject(on, [entry('AB12')])).toBe(false);
    // pencocokan serial dinormalisasi (trim + huruf besar)
    expect(shouldAutoInject(on, [entry(' ab12 ')])).toBe(false);
    expect(shouldAutoInject(ready(), [])).toBe(false);
  });

  test('false saat sedang inject atau belum siap meski auto aktif', () => {
    const on = run(ready(), { type: 'toggle-auto', on: true });
    expect(shouldAutoInject({ ...on, injecting: true }, [])).toBe(false);
    expect(shouldAutoInject({ ...on, firmwareCode: null }, [])).toBe(false);
    expect(shouldAutoInject({ ...on, serial: '' }, [])).toBe(false);
  });
});
