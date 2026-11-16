// Membaca serial/info perangkat dan router lewat SSH (spek §6.2). Router jump selalu Mikrotik.

import {
  type DeviceInfo,
  parseMikrotikCountry,
  parseMikrotikRouterboard,
  parseUbiquitiBoardInfo,
  parseUbiquitiCountry,
  parseUbiquitiSerialLine,
} from '@countrylock/device-info';
import type { ConnectTarget } from '@countrylock/inject-plan';
import type { Brand } from '@countrylock/script-template';
import { execCommands, SshExecError, type SshFailure, type SshTarget } from '../ssh/exec';

export type DeviceInfoResult = { ok: true; info: DeviceInfo } | { ok: false; error: SshFailure };
export type RouterInfoResult =
  | { ok: true; serial: string; model: string }
  | { ok: false; error: SshFailure };

const INFO_TIMEOUT_MS = 5000;
const SERIAL_TIMEOUT_MS = 2000;
const INFO_KEEPALIVE_MS = 60_000;
const PINGER_KEEPALIVE_MS = 20_000;

const COMMANDS = {
  mikrotik: {
    serial: ':put [/system routerboard get serial-number]',
    info: '/system routerboard print',
    country: ':put [/interface wireless get wlan1]',
  },
  ubiquiti: {
    serial: 'cat /proc/ubnthal/board.info | grep board.hwaddr',
    info: 'cat /proc/ubnthal/board.info',
    country: 'cat /tmp/system.cfg | grep countrycode',
  },
} as const;

function failure(error: unknown): SshFailure {
  return error instanceof SshExecError ? error.kind : 'UNAVAILABLE';
}

export async function readDeviceInfo(
  brand: Brand,
  conn: ConnectTarget | SshTarget,
): Promise<DeviceInfoResult> {
  const cmd = COMMANDS[brand];
  try {
    const [infoOut = '', countryOut = ''] = await execCommands(conn, [cmd.info, cmd.country], {
      timeoutMs: INFO_TIMEOUT_MS,
      keepaliveMs: INFO_KEEPALIVE_MS,
    });
    if (brand === 'mikrotik') {
      const { serial, model } = parseMikrotikRouterboard(infoOut);
      return { ok: true, info: { model, serial, country: parseMikrotikCountry(countryOut) } };
    }
    const { serial, model } = parseUbiquitiBoardInfo(infoOut);
    return { ok: true, info: { model, serial, country: parseUbiquitiCountry(countryOut) } };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

/** Serial cepat (milik pinger). Gagal apa pun (termasuk kredensial) = string kosong (inventaris §1.2). */
export async function readSerial(brand: Brand, conn: ConnectTarget | SshTarget): Promise<string> {
  try {
    const [out = ''] = await execCommands(conn, [COMMANDS[brand].serial], {
      timeoutMs: SERIAL_TIMEOUT_MS,
      keepaliveMs: PINGER_KEEPALIVE_MS,
    });
    return brand === 'ubiquiti' ? parseUbiquitiSerialLine(out) : out.replace(/[\t\n\r]/g, '');
  } catch {
    return '';
  }
}

/** Info router jump: SELALU sintaks Mikrotik, apa pun merk target. */
export async function readRouterInfo(conn: ConnectTarget | SshTarget): Promise<RouterInfoResult> {
  try {
    const [out = ''] = await execCommands(conn, [COMMANDS.mikrotik.info], {
      timeoutMs: INFO_TIMEOUT_MS,
      keepaliveMs: INFO_KEEPALIVE_MS,
    });
    const { serial, model } = parseMikrotikRouterboard(out);
    return { ok: true, serial, model };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}
