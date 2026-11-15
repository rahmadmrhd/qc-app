import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { type FakeSshServer, startFakeSshServer } from '../../../test-support/fake-ssh-server';
import { readDeviceInfo, readRouterInfo, readSerial } from './info';

const USER = 'admin';
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const servers: FakeSshServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function fake(execMap: Record<string, string>, commands: string[] = []) {
  const server = await startFakeSshServer({
    username: USER,
    password: PASSWORD,
    shell: 'busybox',
    execMap,
    onExec: (c) => commands.push(c),
  });
  servers.push(server);
  return server;
}

const conn = (server: FakeSshServer, password = PASSWORD) => ({
  host: '127.0.0.1',
  port: server.port,
  username: USER,
  password,
});

const UBNT_BOARD = [
  'board.sysid=0xe7f2',
  'board.name=NanoStation-loco-M5',
  'board.hwaddr=24A43C112233',
  'board.model=NanoStation loco M5',
  '',
].join('\n');

const MIKROTIK_RB = [
  '       routerboard: yes',
  '             model: hAP ac2',
  '     serial-number: abc123def',
  '     firmware-type: ipq4000L',
  '',
].join('\r\n');

describe('readDeviceInfo', () => {
  test('ubiquiti: serial dari board.hwaddr dan info penuh dari board.info plus countrycode', async () => {
    const commands: string[] = [];
    const server = await fake(
      {
        'cat /proc/ubnthal/board.info': UBNT_BOARD,
        'cat /tmp/system.cfg | grep countrycode': 'radio.countrycode=360\n',
      },
      commands,
    );
    const result = await readDeviceInfo('ubiquiti', conn(server));
    expect(result).toEqual({
      ok: true,
      info: { model: 'NanoStation loco M5', serial: '24A43C112233', country: 'Indonesia' },
    });
    expect(commands).toEqual([
      'cat /proc/ubnthal/board.info',
      'cat /tmp/system.cfg | grep countrycode',
    ]);
  });

  test('readSerial ubiquiti dan mikrotik memakai perintah serial cepat spek §6.2', async () => {
    const commands: string[] = [];
    const server = await fake(
      {
        'cat /proc/ubnthal/board.info | grep board.hwaddr': 'board.hwaddr=24a43c112233\n',
        ':put [/system routerboard get serial-number]': 'abc123def\r\n',
      },
      commands,
    );
    expect(await readSerial('ubiquiti', conn(server))).toBe('24A43C112233');
    // Mikrotik: hanya \t\n\r dibuang (pinger lama tidak meng-uppercase).
    expect(await readSerial('mikrotik', conn(server))).toBe('abc123def');
    expect(commands).toEqual([
      'cat /proc/ubnthal/board.info | grep board.hwaddr',
      ':put [/system routerboard get serial-number]',
    ]);
  });

  test('mikrotik: info dari /system routerboard print dan :put [/interface wireless get wlan1]', async () => {
    const commands: string[] = [];
    const server = await fake(
      {
        '/system routerboard print': MIKROTIK_RB,
        ':put [/interface wireless get wlan1]': 'name=wlan1;country=indonesia;band=2ghz-b/g/n\r\n',
      },
      commands,
    );
    const result = await readDeviceInfo('mikrotik', conn(server));
    expect(result).toEqual({
      ok: true,
      info: { model: 'hAP', serial: 'ABC123DEF', country: 'indonesia' },
    });
    expect(commands).toEqual(['/system routerboard print', ':put [/interface wireless get wlan1]']);
  });

  test('"Permission denied" pada auth → PERMISSION_DENIED; host mati → UNAVAILABLE', async () => {
    const server = await fake({});
    expect(await readDeviceInfo('ubiquiti', conn(server, 'sandi-salah'))).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    const port = server.port;
    await server.close();
    servers.length = 0;
    expect(
      await readDeviceInfo('mikrotik', { host: '127.0.0.1', port, username: USER, password: 'x' }),
    ).toEqual({ ok: false, error: 'UNAVAILABLE' });
  });

  test('readRouterInfo memakai perintah RouterOS untuk perangkat Ubiquiti sekalipun', async () => {
    const commands: string[] = [];
    const server = await fake({ '/system routerboard print': MIKROTIK_RB }, commands);
    // Router jump selalu Mikrotik: tidak ada parameter merk, hanya perintah RouterOS.
    expect(await readRouterInfo(conn(server))).toEqual({
      ok: true,
      serial: 'ABC123DEF',
      model: 'hAP',
    });
    expect(commands).toEqual(['/system routerboard print']);
  });

  test('readRouterInfo: kredensial salah → PERMISSION_DENIED', async () => {
    const server = await fake({});
    expect(await readRouterInfo(conn(server, 'salah'))).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });
});
