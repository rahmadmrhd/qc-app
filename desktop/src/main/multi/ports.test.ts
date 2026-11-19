import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LEASE_COMMAND } from '@countrylock/multi/lease';
import type { InjectedEvent } from '@countrylock/multi/types';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { type FakeSshServer, startFakeSshServer } from '../../../test-support/fake-ssh-server';
import type { InjectRunner } from '../inject-runner';
import { type LoadedPackage, loadLocalPackage } from '../package/local-folder';
import { execCommands, type SshTarget } from '../ssh/exec';
import { openMultiEventStore } from '../store/multi-event-store';
import { createMultiPorts, type MultiPortsDeps } from './ports';

const FIXTURE = resolve(__dirname, '../../../../countrylock/fixtures/country-lock2');
const SERVER_USER = 'admin';
const SERVER_PASSWORD = 'Srv#Pw!9-sentinel';
const DEVICE_PASSWORD = 'Dev#Pw-sentinel';

const LEASE_OUTPUT = [
  ' 0 D address=192.168.88.10 mac-address=58:d6:1f:0e:4e:fe status=bound',
  ' 1 D address=192.168.88.11 mac-address=58:D6:1F:0E:4E:FF status=bound',
  '',
].join('\r\n');

let pkg: LoadedPackage;
let tmp: string;
const servers: FakeSshServer[] = [];

beforeAll(async () => {
  const real = await loadLocalPackage(FIXTURE);
  pkg = {
    ...real,
    config: {
      ...real.config,
      server: { ...real.config.server, username: SERVER_USER, password: SERVER_PASSWORD },
    },
  };
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'qc-multi-ports-'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  rmSync(tmp, { recursive: true, force: true });
});

async function fakeRouter(execMap: Record<string, string>, commands: string[] = []) {
  const server = await startFakeSshServer({
    username: SERVER_USER,
    password: SERVER_PASSWORD,
    shell: 'routeros',
    execMap,
    onExec: (c) => commands.push(c),
  });
  servers.push(server);
  return server;
}

/** exec nyata yang dialihkan ke server SSH palsu; mencatat target yang diminta kode produksi. */
function execVia(server: FakeSshServer, targets: SshTarget[] = []): typeof execCommands {
  return (target, commands, opts) => {
    targets.push(target);
    return execCommands({ ...target, host: '127.0.0.1', port: server.port }, commands, opts);
  };
}

function setup(patch: Partial<MultiPortsDeps> = {}, withPackage = true) {
  const events = openMultiEventStore(join(tmp, 'draft.db'));
  const runner: InjectRunner = {
    run: vi.fn(async () => ({ ok: true, stage: 'completed' as const, message: 'Inject selesai' })),
  };
  const deps: MultiPortsDeps = {
    packages: { ensure: async () => (withPackage ? pkg : null) },
    runner,
    events,
    ...patch,
  };
  return { ports: createMultiPorts(deps), events, runner, deps };
}

const event = (id: string): InjectedEvent => ({
  eventId: id,
  mac: '58:D6:1F:0E:4E:FE',
  serial: 'SN1',
  model: 'm',
  injectedAt: '2026-11-19T03:00:00.000Z',
  target: {
    itemId: 'i',
    itemLabel: 'I',
    buId: 'b',
    buLabel: 'B',
    locationId: 'l',
    locationLabel: 'L',
  },
});

describe('readLeases', () => {
  test('menjalankan perintah lease persis ke router dan mengembalikan IP + MAC ternormalisasi', async () => {
    const commands: string[] = [];
    const targets: SshTarget[] = [];
    const server = await fakeRouter({ [LEASE_COMMAND]: LEASE_OUTPUT }, commands);
    const { ports, events } = setup({ exec: execVia(server, targets) });
    expect(await ports.readLeases()).toEqual([
      { ip: '192.168.88.10', mac: '58:D6:1F:0E:4E:FE' },
      { ip: '192.168.88.11', mac: '58:D6:1F:0E:4E:FF' },
    ]);
    expect(commands).toEqual([LEASE_COMMAND]);
    // Lease dan bridge memakai satu sumber host yang sama.
    const bridgeTargets: SshTarget[] = [];
    const bridge = setup({ exec: execVia(server, bridgeTargets) });
    await bridge.ports.ensureBridgePorts();
    expect(bridgeTargets[0]?.host).toBe(targets[0]?.host);
    bridge.events.close();
    // Host = config.server.ip (BUKAN ipServer, yang berbeda di fixture), kredensial = config.server.
    expect(pkg.config.brands.ubiquiti?.multi.ipServer).not.toBe(pkg.config.server.ip);
    expect(targets[0]).toMatchObject({
      host: pkg.config.server.ip,
      username: SERVER_USER,
      password: SERVER_PASSWORD,
    });
    events.close();
  });

  test('keluaran kosong = daftar kosong (bukan galat)', async () => {
    const server = await fakeRouter({ [LEASE_COMMAND]: '' });
    const { ports, events } = setup({ exec: execVia(server) });
    expect(await ports.readLeases()).toEqual([]);
    events.close();
  });

  test('server mati, kredensial salah, atau paket belum dipilih = null', async () => {
    const server = await fakeRouter({ [LEASE_COMMAND]: LEASE_OUTPUT });
    const badPackage: LoadedPackage = {
      ...pkg,
      config: { ...pkg.config, server: { ...pkg.config.server, password: 'salah' } },
    };
    const wrong = setup({
      exec: execVia(server),
      packages: { ensure: async () => badPackage },
    });
    expect(await wrong.ports.readLeases()).toBeNull();
    wrong.events.close();

    await server.close();
    servers.splice(0);
    const down = setup({ exec: execVia(server) });
    expect(await down.ports.readLeases()).toBeNull();
    down.events.close();

    const none = setup({}, false);
    expect(await none.ports.readLeases()).toBeNull();
    none.events.close();
  });
});

describe('ping dan readInfo', () => {
  test('ping memakai pingOnce 1000 ms; readInfo memetakan hasil dan galat ke bentuk port', async () => {
    const ping = vi.fn(async () => ({ ok: true, kind: 'success' as const }));
    const read = vi.fn(async () => ({
      ok: true as const,
      info: { model: 'NS', serial: 'SN9', country: 'ID' },
    }));
    const { ports, events } = setup({ ping, readDeviceInfo: read });
    expect(await ports.ping('192.168.88.10')).toBe(true);
    expect(ping).toHaveBeenCalledWith('192.168.88.10', 1000);
    const cred = { username: 'ubnt', password: DEVICE_PASSWORD };
    expect(await ports.readInfo('192.168.88.10', cred)).toEqual({
      ok: true,
      model: 'NS',
      serial: 'SN9',
      country: 'ID',
    });
    expect(read).toHaveBeenCalledWith('ubiquiti', {
      host: '192.168.88.10',
      username: 'ubnt',
      password: DEVICE_PASSWORD,
    });

    read.mockResolvedValueOnce({ ok: false as never, error: 'PERMISSION_DENIED' } as never);
    expect(await ports.readInfo('192.168.88.10', cred)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    ping.mockResolvedValueOnce({ ok: false, kind: 'timeout' as never });
    expect(await ports.ping('192.168.88.10')).toBe(false);
    events.close();
  });
});

describe('inject', () => {
  test("memanggil runner mode 'multi' merk ubiquiti dan meneruskan signal serta progres", async () => {
    const { ports, runner, events } = setup();
    vi.mocked(runner.run).mockImplementationOnce(async (_input, _signal, onProgress) => {
      onProgress?.('baris progres');
      return { ok: false, stage: 'failed', message: 'Perangkat menolak kredensial' };
    });
    const controller = new AbortController();
    const progress: string[] = [];
    const result = await ports.inject(
      {
        id: 'inj-1',
        ip: '192.168.88.10',
        cred: { username: 'ubnt', password: DEVICE_PASSWORD },
        firmwareCode: 'WA',
      },
      controller.signal,
      (m) => progress.push(m),
    );
    expect(result).toEqual({ ok: false, stage: 'failed', message: 'Perangkat menolak kredensial' });
    expect(progress).toEqual(['baris progres']);
    expect(runner.run).toHaveBeenCalledWith(
      {
        id: 'inj-1',
        mode: 'multi',
        brand: 'ubiquiti',
        firmwareCode: 'WA',
        target: { ip: '192.168.88.10', username: 'ubnt', password: DEVICE_PASSWORD },
      },
      controller.signal,
      expect.any(Function),
    );
    events.close();
  });
});

describe('ensureBridgePorts', () => {
  test('mengirim tepat perintah L4.2 (hapus selain interfaceComp, tambah tiap interfaceList)', async () => {
    const commands: string[] = [];
    const server = await fakeRouter(
      {
        '/interface bridge port remove [find interface!=ether5]': '',
        '/interface bridge port add bridge=BridgeAll interface=ether1': '',
        '/interface bridge port add bridge=BridgeAll interface=ether2': '',
        '/interface bridge port add bridge=BridgeAll interface=ether3': '',
      },
      commands,
    );
    const { ports, events } = setup({ exec: execVia(server) });
    const result = await ports.ensureBridgePorts();
    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      '/interface bridge port remove [find interface!=ether5]',
      '/interface bridge port add bridge=BridgeAll interface=ether1',
      '/interface bridge port add bridge=BridgeAll interface=ether2',
      '/interface bridge port add bridge=BridgeAll interface=ether3',
    ]);
    events.close();
  });

  test('"already have such entry" dianggap berhasil (idempoten); galat lain dilaporkan ringkas dan disamarkan', async () => {
    const server = await fakeRouter({
      '/interface bridge port remove [find interface!=ether5]': '',
      '/interface bridge port add bridge=BridgeAll interface=ether1':
        'failure: already have such entry\r\n',
      '/interface bridge port add bridge=BridgeAll interface=ether2': `failure: cannot ${SERVER_PASSWORD}\r\n`,
      '/interface bridge port add bridge=BridgeAll interface=ether3': '',
    });
    const { ports, events } = setup({ exec: execVia(server) });
    const result = await ports.ensureBridgePorts();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ether2');
    expect(result.message).not.toContain('ether1');
    expect(result.message).not.toContain(SERVER_PASSWORD);
    events.close();
  });

  test('router tak terjangkau atau menolak kredensial dilaporkan tanpa sandi; paket belum dipilih juga', async () => {
    const server = await fakeRouter({});
    const badPackage: LoadedPackage = {
      ...pkg,
      config: { ...pkg.config, server: { ...pkg.config.server, password: 'salah' } },
    };
    const wrong = setup({ exec: execVia(server), packages: { ensure: async () => badPackage } });
    const denied = await wrong.ports.ensureBridgePorts();
    expect(denied.ok).toBe(false);
    expect(denied.message).not.toContain('salah');
    wrong.events.close();

    const none = setup({}, false);
    expect(await none.ports.ensureBridgePorts()).toEqual({
      ok: false,
      message: 'Paket skrip belum dipilih',
    });
    none.events.close();
  });

  test('nama interface/bridge dari config yang tak aman ditolak sebelum menyentuh router', async () => {
    const exec = vi.fn();
    const evil: LoadedPackage = {
      ...pkg,
      config: {
        ...pkg.config,
        server: { ...pkg.config.server, interfaceList: ['ether1; /system reset-configuration'] },
      },
    };
    const { ports, events } = setup({ exec, packages: { ensure: async () => evil } });
    const result = await ports.ensureBridgePorts();
    expect(result.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    events.close();
  });
});

describe('events, waktu, dan id', () => {
  test('events meneruskan ke store; newId cocok pola id peristiwa; sleep menghormati signal', async () => {
    const { ports, events } = setup();
    ports.events.add(event('e1'));
    expect(ports.events.list().map((e) => e.eventId)).toEqual(['e1']);
    ports.events.ack(['e1']);
    expect(ports.events.list()).toEqual([]);
    expect(ports.newId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(ports.newId()).not.toBe(ports.newId());
    expect(Math.abs(ports.now() - Date.now())).toBeLessThan(1000);

    const aborted = new AbortController();
    aborted.abort();
    await expect(ports.sleep(10_000, aborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const later = new AbortController();
    const pending = ports.sleep(10_000, later.signal);
    later.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(ports.sleep(5, new AbortController().signal)).resolves.toBeUndefined();
    events.close();
  });
});
