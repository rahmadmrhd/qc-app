import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { type FakeSshServer, startFakeSshServer } from '../test-support/fake-ssh-server';
import {
  gateVerdict,
  parseArgs,
  runChecks,
  type SpikeEnv,
  type SpikeReport,
} from './hardware-spike';

const USER = 'admin';
const ROUTER_PASSWORD = `rp-${randomBytes(6).toString('hex')}`;
const UBNT_PASSWORD = `up-${randomBytes(6).toString('hex')}`;

const servers: FakeSshServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function router(
  deviceMode?: { mode: string; importBlocked?: boolean },
  extra: { echoTwice?: boolean } = {},
) {
  const server = await startFakeSshServer({
    username: USER,
    password: ROUTER_PASSWORD,
    shell: 'routeros',
    ...(deviceMode ? { deviceMode } : {}),
    ...extra,
  });
  servers.push(server);
  return server;
}

function routerEnv(server: FakeSshServer): SpikeEnv {
  return {
    router: {
      host: '127.0.0.1',
      port: server.port,
      username: USER,
      password: ROUTER_PASSWORD,
    },
    // Singkat: pada RouterOS palsu, penanda `echo` memang harus kehabisan waktu.
    timeouts: { connectMs: 3000, perLineMs: 1500, commandMs: 3000 },
    probe: { routerLine: ':delay 400ms', ubiquitiLine: 'sleep 400', minElapsedMs: 300 },
  };
}

describe('runChecks', () => {
  test('runChecks melaporkan sentinelEcho timeout dan sentinelPut ok pada router berperilaku RouterOS', async () => {
    const server = await router({ mode: 'advanced' });
    const report = await runChecks(routerEnv(server));
    expect(report.router.sentinelEcho).toBe('timeout');
    expect(report.router.sentinelPut).toBe('ok');
    expect(report.router.sftpPut).toBe(true);
    expect(report.router.sftpRename).toBe(true);
    expect(report.router.sftpStat).toBe(true);
    expect(report.router.hostKeyType).toBe('ssh-rsa');
    expect(report.router.deviceMode).toBe('advanced');
    expect(report.router.importBlocked).toBe(false);
    expect(report.ubiquiti).toBeUndefined();
    // Semua berkas uji dibersihkan kembali dari router.
    expect([...server.files.keys()]).toEqual([]);
  });

  test('sisa berkas uji dari proses yang terhenti dibersihkan: rename tidak gagal karena nama sudah ada', async () => {
    const server = await router({ mode: 'advanced' });
    // Sisa uji sebelumnya (mis. Ctrl+C): SFTP v3 baku menolak rename ke nama yang sudah ada.
    server.files.set('/temp/qc-spike.tmp', Buffer.alloc(7, 1));
    server.files.set('/temp/qc-spike.tmp.part', Buffer.alloc(3, 1));
    const report = await runChecks(routerEnv(server));
    expect(report.router.sftpPut).toBe(true);
    expect(report.router.sftpRename).toBe(true);
    expect(report.router.sftpStat).toBe(true);
    expect([...server.files.keys()]).toEqual([]);
    // Catatan untuk sinkron §5: rename ke nama yang sudah ada gagal pada server baku ini.
    expect(report.notes.join('\n')).toMatch(/rename ke nama yang sudah ada: GAGAL/);
  });

  test('penanda yang kembali seketika (echo digambar ulang) dilaporkan error, bukan ok', async () => {
    // Konsol yang menggambar ulang ketikan membuat token muncul dua kali dari echo saja.
    const server = await router({ mode: 'advanced' }, { echoTwice: true });
    const report = await runChecks(routerEnv(server));
    expect(report.router.sentinelPut).toBe('error');
    expect(report.notes.join('\n')).toMatch(/TIDAK menandai selesainya baris/);
  });

  test('importBlocked true bila device-mode menolak /import', async () => {
    const server = await router({ mode: 'home', importBlocked: true });
    const report = await runChecks(routerEnv(server));
    expect(report.router.importBlocked).toBe(true);
    expect(report.router.deviceMode).toBe('home');
    expect([...server.files.keys()]).toEqual([]);
  });

  test('device-mode tak didukung → deviceMode unknown, laporan tetap utuh', async () => {
    const server = await router();
    const report = await runChecks(routerEnv(server));
    expect(report.router.deviceMode).toBe('unknown');
    expect(report.router.sentinelPut).toBe('ok');
  });

  test('Ubiquiti: penanda echo ok dan scp dari router berhasil; berkas uji dibersihkan', async () => {
    const routerServer = await router({ mode: 'advanced' });
    const ubnt = await startFakeSshServer({
      username: USER,
      password: UBNT_PASSWORD,
      shell: 'busybox',
      scpSource: (path) => routerServer.files.get(path),
    });
    servers.push(ubnt);
    const env = routerEnv(routerServer);
    env.ubiquiti = {
      host: '127.0.0.1',
      port: ubnt.port,
      username: USER,
      password: UBNT_PASSWORD,
      routerHostFromDevice: '127.0.0.1',
    };
    const report = await runChecks(env);
    expect(report.ubiquiti).toEqual({ sentinelEcho: 'ok', scpFromRouter: true });
    expect([...routerServer.files.keys()]).toEqual([]);
    expect([...ubnt.localFiles.keys()]).toEqual([]);
  });

  test('laporan tidak memuat kata sandi', async () => {
    const routerServer = await router({ mode: 'advanced' });
    const ubnt = await startFakeSshServer({
      username: USER,
      password: UBNT_PASSWORD,
      shell: 'busybox',
      scpSource: (path) => routerServer.files.get(path),
    });
    servers.push(ubnt);
    const env = routerEnv(routerServer);
    env.ubiquiti = { host: '127.0.0.1', port: ubnt.port, username: USER, password: UBNT_PASSWORD };
    const text = JSON.stringify(await runChecks(env));
    expect(text).not.toContain(ROUTER_PASSWORD);
    expect(text).not.toContain(UBNT_PASSWORD);
  });

  test('router tak terjangkau: tidak melempar, semua cek gagal, tanpa mencoba ulang berulang', async () => {
    const server = await router();
    const env = routerEnv(server);
    await server.close();
    servers.length = 0;
    const report = await runChecks(env);
    expect(report.router.sentinelEcho).toBe('error');
    expect(report.router.sentinelPut).toBe('error');
    expect(report.router.sftpPut).toBe(false);
    expect(report.router.hostKeyType).toMatch(/^error:/);
    expect(report.router.importBlocked).toBe('unknown');
  });

  test('kredensial router salah: berhenti setelah satu percobaan (cegah penguncian akun)', async () => {
    const server = await router();
    const env = routerEnv(server);
    env.router.password = 'salah';
    const report = await runChecks(env);
    expect(report.router.hostKeyType).toBe('error:AUTH');
    expect(report.router.sentinelPut).toBe('error');
    expect(JSON.stringify(report)).not.toContain('salah');
  });
});

describe('parseArgs', () => {
  const env = { SPIKE_ROUTER_PASSWORD: 'dari-env', SPIKE_UBNT_PASSWORD: 'ubnt-env' };

  test('router saja: kata sandi dari variabel lingkungan', () => {
    const result = parseArgs(['--router', '10.0.0.1', '--router-user', 'admin'], env);
    expect(result).toEqual({
      router: { host: '10.0.0.1', username: 'admin', password: 'dari-env' },
    });
  });

  test('router + Ubiquiti', () => {
    const result = parseArgs(
      [
        '--router',
        '10.0.0.1',
        '--router-user',
        'admin',
        '--ubnt',
        '10.0.0.9',
        '--ubnt-user',
        'ubnt',
      ],
      env,
    );
    expect(result.ubiquiti).toMatchObject({
      host: '10.0.0.9',
      username: 'ubnt',
      password: 'ubnt-env',
    });
  });

  test('kata sandi lewat argumen ditolak', () => {
    expect(() =>
      parseArgs(['--router', 'x', '--router-user', 'a', '--router-password', 'rahasia'], env),
    ).toThrow(/variabel lingkungan/);
  });

  test('variabel sandi hilang, argumen wajib hilang, atau argumen tak dikenal ditolak', () => {
    expect(() => parseArgs(['--router', 'x', '--router-user', 'a'], {})).toThrow(
      /SPIKE_ROUTER_PASSWORD/,
    );
    expect(() => parseArgs(['--router-user', 'a'], env)).toThrow(/--router/);
    expect(() => parseArgs(['--router', 'x', '--router-user', 'a', '--aneh', '1'], env)).toThrow(
      /tidak dikenal/,
    );
    expect(() =>
      parseArgs(['--router', 'x', '--router-user', 'a', '--ubnt', 'y'], { ...env }),
    ).toThrow(/--ubnt-user/);
  });
});

describe('gateVerdict', () => {
  const good: SpikeReport = {
    router: {
      sentinelEcho: 'timeout',
      sentinelPut: 'ok',
      sftpPut: true,
      sftpRename: true,
      sftpStat: true,
      hostKeyType: 'ssh-rsa',
      importBlocked: false,
      deviceMode: 'advanced',
    },
    notes: [],
    meta: { generatedAt: '2026-11-12T00:00:00.000Z', node: '24.0.0' },
  };

  test('lolos bila put ok, SFTP put/rename ok, import tidak diblokir (unknown tetap lolos)', () => {
    expect(gateVerdict(good)).toEqual({ pass: true, reasons: [] });
    expect(
      gateVerdict({ ...good, router: { ...good.router, importBlocked: 'unknown' } }).pass,
    ).toBe(true);
  });

  test('gagal bila sentinelPut bukan ok, sftpPut/sftpRename gagal, atau import diblokir', () => {
    const fail = (patch: Partial<SpikeReport['router']>) =>
      gateVerdict({ ...good, router: { ...good.router, ...patch } });
    expect(fail({ sentinelPut: 'timeout' }).pass).toBe(false);
    expect(fail({ sftpPut: false }).pass).toBe(false);
    expect(fail({ sftpRename: false }).pass).toBe(false);
    expect(fail({ importBlocked: true }).reasons).toEqual(['/import diblokir device-mode']);
  });
});
