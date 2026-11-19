import type { InjectedEvent } from '@countrylock/bridge-contract';
import { SERIAL_LIMITS } from '@shared/serials';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { createFakeBridge, createFakeMultiDevice, createFakeMultiSnapshot } from './fake-bridge';
import { useDraftRows } from './use-draft-rows';
import { multiClientId, useMulti } from './use-multi';

const savedRow = (serial: string, clientId = `cid-${serial}-00000000`) => ({
  clientId,
  serial,
  itemId: 'item-1',
  itemLabel: 'NanoStation',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  testDate: '2026-11-18',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
  sample: false,
  note: '',
  capturedAt: '2026-11-18T08:00:00.000Z',
  source: 'countrylock',
  stickers: null,
  proofPhotos: [],
});

const injected = (eventId: string, serial: string, mac = 'AA:BB:CC:DD:EE:01'): InjectedEvent => ({
  eventId,
  mac,
  serial,
  model: 'NanoStation M2',
  injectedAt: '2026-11-18T20:30:00.000Z',
  target: {
    itemId: 'item-1',
    itemLabel: 'NanoStation',
    buId: 'bu-1',
    buLabel: 'DEF - BU',
    locationId: 'loc-1',
    locationLabel: 'QC-A - QC',
  },
});

const START_CFG = {
  firmwareCode: 'XW',
  concurrency: 4,
  excludeIp: '',
  autoInject: false,
  target: injected('x', 'x').target,
};

async function setup(bridge = createFakeBridge()) {
  const view = renderHook(() => {
    const draft = useDraftRows(bridge);
    const multi = useMulti(bridge, draft);
    return { draft, multi };
  });
  await waitFor(() => expect(view.result.current.draft.status).not.toBe('loading'));
  return { bridge, ...view };
}

const callsOf = (bridge: ReturnType<typeof createFakeBridge>, name: string) =>
  bridge.multiCalls.filter((call) => call.name === name);

describe('useMulti: dukungan jembatan', () => {
  test('jembatan v9 dengan multi: supported, snapshot awal dibaca lalu onChange diikuti', async () => {
    const { bridge, result } = await setup();
    expect(result.current.multi.supported).toBe(true);
    await waitFor(() => expect(result.current.multi.snapshot).not.toBeNull());
    expect(result.current.multi.snapshot?.running).toBe(false);
    act(() =>
      bridge.emitMulti({
        running: true,
        devices: [createFakeMultiDevice({ status: 'ready' })],
      }),
    );
    expect(result.current.multi.snapshot?.running).toBe(true);
    expect(result.current.multi.snapshot?.devices).toHaveLength(1);
  });

  test('jembatan di bawah v9: tidak aktif dan tak memanggil apa pun', async () => {
    const { bridge, result } = await setup(createFakeBridge({ version: 8 }));
    expect(result.current.multi.supported).toBe(false);
    expect(result.current.multi.snapshot).toBeNull();
    await act(async () => {
      await result.current.multi.start(START_CFG);
    });
    expect(bridge.multiCalls).toEqual([]);
  });

  test('berhenti berlangganan saat dilepas', async () => {
    const { bridge, result, unmount } = await setup();
    await waitFor(() => expect(result.current.multi.snapshot).not.toBeNull());
    unmount();
    expect(() => bridge.emitMulti({ running: true })).not.toThrow();
  });
});

describe('useMulti: sinkron draft ke proses utama', () => {
  test('setBlocked(null) dan setRegistered dari draft dikirim sebelum start; serial dinormalisasi', async () => {
    const bridge = createFakeBridge();
    bridge.draftRows.push(savedRow('AABBCCDDEEFF'), savedRow('SN-1'));
    const { result } = await setup(bridge);
    await waitFor(() => expect(callsOf(bridge, 'setRegistered').length).toBeGreaterThan(0));
    const lastRegistered = callsOf(bridge, 'setRegistered').at(-1)?.args[0];
    expect(lastRegistered).toEqual(['AABBCCDDEEFF', 'SN-1']);
    expect(callsOf(bridge, 'setBlocked').at(-1)?.args[0]).toBeNull();

    await act(async () => {
      await result.current.multi.start(START_CFG);
    });
    const names = bridge.multiCalls.map((call) => call.name);
    expect(names.lastIndexOf('setRegistered')).toBeLessThan(names.indexOf('start'));
    expect(names.lastIndexOf('setBlocked')).toBeLessThan(names.indexOf('start'));
    expect(callsOf(bridge, 'start')[0]?.args[0]).toEqual(START_CFG);
  });

  test('setRegistered dikirim ulang saat draft berubah', async () => {
    const { bridge, result } = await setup();
    await act(async () => {
      await result.current.draft.addInjected({
        serial: 'ab12',
        itemId: 'i',
        itemLabel: 'I',
        buId: 'b',
        buLabel: 'B',
        locationId: 'l',
        locationLabel: 'L',
      });
    });
    await waitFor(() => expect(callsOf(bridge, 'setRegistered').at(-1)?.args[0]).toEqual(['AB12']));
  });

  test('draft penuh: setBlocked berisi alasan, lalu null saat ada ruang lagi', async () => {
    const bridge = createFakeBridge();
    for (let i = 0; i < SERIAL_LIMITS.tableRows; i++) bridge.draftRows.push(savedRow(`S${i}`));
    const { result } = await setup(bridge);
    await waitFor(() =>
      expect(String(callsOf(bridge, 'setBlocked').at(-1)?.args[0])).toMatch(/Draft penuh/),
    );
    act(() => result.current.draft.replace(result.current.draft.rows.slice(1)));
    await waitFor(() => expect(callsOf(bridge, 'setBlocked').at(-1)?.args[0]).toBeNull());
  });

  test('draft gagal dimuat: setBlocked berisi alasan (maks. 200 karakter)', async () => {
    const bridge = createFakeBridge({
      draft: {
        load: async () => {
          throw new Error(`Draft tersimpan rusak: ${'x'.repeat(400)}`);
        },
      },
    });
    await setup(bridge);
    await waitFor(() => expect(callsOf(bridge, 'setBlocked').length).toBeGreaterThan(0));
    const reason = callsOf(bridge, 'setBlocked').at(-1)?.args[0];
    expect(typeof reason).toBe('string');
    expect((reason as string).length).toBeLessThanOrEqual(200);
    expect(reason).toMatch(/Draft tidak dapat dimuat/);
  });
});

describe('useMulti: peristiwa injected ke draft', () => {
  test('peristiwa tertunda saat mount dicatat ke draft (target dari peristiwa) lalu di-ack', async () => {
    const bridge = createFakeBridge();
    bridge.multiEvents.push(injected('evt-1', 'aa:bb:cc:dd:ee:01'));
    const { result } = await setup(bridge);
    await waitFor(() => expect(result.current.draft.rows).toHaveLength(1));
    expect(result.current.draft.rows[0]).toMatchObject({
      serial: 'AABBCCDDEE01',
      itemId: 'item-1',
      itemLabel: 'NanoStation',
      buId: 'bu-1',
      locationId: 'loc-1',
      source: 'countrylock',
      clientId: multiClientId('evt-1'),
      capturedAt: '2026-11-18T20:30:00.000Z',
      testDate: '2026-11-19',
    });
    await waitFor(() => expect(bridge.multiEvents).toHaveLength(0));
    expect(callsOf(bridge, 'ackInjected')[0]?.args[0]).toEqual(['evt-1']);
  });

  test('peristiwa baru dari inject yang sukses (snapshot berubah) dicatat dan di-ack', async () => {
    const { bridge, result } = await setup();
    bridge.multiEvents.push(injected('evt-2', 'SN2'));
    act(() =>
      bridge.emitMulti({ running: true, devices: [createFakeMultiDevice({ status: 'success' })] }),
    );
    await waitFor(() => expect(result.current.draft.rows.map((r) => r.serial)).toEqual(['SN2']));
    await waitFor(() => expect(bridge.multiEvents).toHaveLength(0));
  });

  test('peristiwa yang sama dikirim ulang (muat ulang) tidak menggandakan baris dan tetap di-ack', async () => {
    const bridge = createFakeBridge();
    // Baris sudah ada di draft dari pengiriman sebelumnya, tetapi ack-nya belum sampai.
    bridge.draftRows.push(savedRow('SN3', multiClientId('evt-3')));
    bridge.multiEvents.push(injected('evt-3', 'SN3'));
    const { result } = await setup(bridge);
    await waitFor(() => expect(callsOf(bridge, 'ackInjected')).toHaveLength(1));
    expect(result.current.draft.rows).toHaveLength(1);
    expect(callsOf(bridge, 'ackInjected')[0]?.args[0]).toEqual(['evt-3']);
  });

  test('serial yang sudah ada di draft (duplicate) tetap di-ack', async () => {
    const bridge = createFakeBridge();
    bridge.draftRows.push(savedRow('SN4'));
    bridge.multiEvents.push(injected('evt-4', 'sn4'));
    const { result } = await setup(bridge);
    await waitFor(() => expect(callsOf(bridge, 'ackInjected')).toHaveLength(1));
    expect(result.current.draft.rows).toHaveLength(1);
  });

  test('draft penuh: peristiwa tidak di-ack dan tidak hilang', async () => {
    const bridge = createFakeBridge();
    for (let i = 0; i < SERIAL_LIMITS.tableRows; i++) bridge.draftRows.push(savedRow(`S${i}`));
    bridge.multiEvents.push(injected('evt-5', 'BARU5'));
    const { result } = await setup(bridge);
    await waitFor(() => expect(callsOf(bridge, 'setBlocked').length).toBeGreaterThan(0));
    act(() => bridge.emitMulti({ running: true }));
    expect(callsOf(bridge, 'ackInjected')).toHaveLength(0);
    expect(bridge.multiEvents.map((e) => e.eventId)).toEqual(['evt-5']);
    expect(result.current.draft.rows).toHaveLength(SERIAL_LIMITS.tableRows);
  });

  test('draft penuh: unrecorded memuat MAC peristiwa yang belum tercatat, kosong lagi setelah tercatat', async () => {
    const bridge = createFakeBridge();
    for (let i = 0; i < SERIAL_LIMITS.tableRows; i++) bridge.draftRows.push(savedRow(`S${i}`));
    bridge.multiEvents.push(injected('evt-7', 'BARU7', 'AA:BB:CC:DD:EE:07'));
    const { result } = await setup(bridge);
    await waitFor(() =>
      expect([...result.current.multi.unrecorded]).toEqual(['AA:BB:CC:DD:EE:07']),
    );
    act(() => result.current.draft.replace(result.current.draft.rows.slice(1)));
    await waitFor(() => expect(result.current.multi.unrecorded.size).toBe(0));
    expect(bridge.multiEvents).toHaveLength(0);
  });

  test('draft gagal dimuat: peristiwa tidak disentuh', async () => {
    const bridge = createFakeBridge({
      draft: {
        load: async () => {
          throw new Error('rusak');
        },
      },
    });
    bridge.multiEvents.push(injected('evt-6', 'SN6'));
    await setup(bridge);
    act(() => bridge.emitMulti({ running: true }));
    expect(callsOf(bridge, 'ackInjected')).toHaveLength(0);
    expect(bridge.multiEvents).toHaveLength(1);
  });
});

describe('useMulti: aksi dan galat', () => {
  test('setiap aksi memanggil kanal jembatan yang sesuai', async () => {
    const { bridge, result } = await setup();
    const { actions } = result.current.multi;
    await act(async () => {
      actions.scan();
      actions.setConcurrency(8);
      actions.setAutoInject(true);
      actions.injectDevice('AA:BB:CC:DD:EE:01');
      actions.cancelDevice('AA:BB:CC:DD:EE:02');
      actions.injectAll();
      actions.stopQueue();
      actions.cancelAll();
      actions.addCredential({ username: 'u', password: 'p' });
      actions.openWeb('AA:BB:CC:DD:EE:01');
      await actions.prepareBridge();
      await result.current.multi.stop();
    });
    const byName = Object.fromEntries(bridge.multiCalls.map((c) => [c.name, c.args]));
    expect(byName.scan).toEqual([]);
    expect(byName.setConcurrency).toEqual([8]);
    expect(byName.setAutoInject).toEqual([true]);
    expect(byName.injectDevice).toEqual(['AA:BB:CC:DD:EE:01']);
    expect(byName.cancelDevice).toEqual(['AA:BB:CC:DD:EE:02']);
    expect(byName.addCredential).toEqual([{ username: 'u', password: 'p' }]);
    expect(byName.openWeb).toEqual(['AA:BB:CC:DD:EE:01']);
    for (const name of ['injectAll', 'stopQueue', 'cancelAll', 'prepareBridge', 'stop']) {
      expect(byName[name]).toBeDefined();
    }
  });

  test('galat jembatan menjadi error tanpa melempar', async () => {
    const bridge = createFakeBridge({
      multi: {
        start: async () => {
          throw new Error(
            "Error invoking remote method 'qc:multi:start': Error: Hentikan inject tunggal dulu",
          );
        },
        scan: async () => {
          throw new Error('SSH putus');
        },
      },
    });
    const { result } = await setup(bridge);
    await act(async () => {
      await result.current.multi.start(START_CFG);
    });
    expect(result.current.multi.error).toBe('Hentikan inject tunggal dulu');
    await act(async () => {
      result.current.multi.actions.scan();
    });
    await waitFor(() => expect(result.current.multi.error).toBe('SSH putus'));
  });

  test('prepareBridge yang gagal melaporkan pesannya sebagai error', async () => {
    const bridge = createFakeBridge({
      multi: { prepareBridge: async () => ({ ok: false, message: 'Perintah gagal' }) },
    });
    const { result } = await setup(bridge);
    await act(async () => {
      await result.current.multi.actions.prepareBridge();
    });
    expect(result.current.multi.error).toBe('Perintah gagal');
  });

  test('snapshot palsu tidak memuat sandi apa pun', () => {
    const snapshot = createFakeMultiSnapshot({}, [createFakeMultiDevice()]);
    expect(JSON.stringify(snapshot)).not.toMatch(/password|sandi/i);
  });
});
