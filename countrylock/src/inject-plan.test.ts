import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CountryLockConfig, parseConfig } from './config';
import { nextBridgeIndex, nextPingDelayMs, PlanError, planInject, scriptKey } from './inject-plan';
import { ScriptRenderError } from './script-template';

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'country-lock2');

const config: CountryLockConfig = parseConfig(
  readFileSync(join(FIXTURE_DIR, 'config.QC'), 'utf8'),
).config;

/** Paket skrip fixture: kunci `<folder>/<file>`. */
function loadScripts(): Map<string, string> {
  const map = new Map<string, string>();
  for (const folder of ['MIKROTIK', 'UBIQUITI']) {
    for (const name of readdirSync(join(FIXTURE_DIR, folder))) {
      map.set(`${folder}/${name}`, readFileSync(join(FIXTURE_DIR, folder, name), 'utf8'));
    }
  }
  return map;
}

const scripts = loadScripts();
const SSH_KEY = 'AAAAB3NzaC1yc2EAAAABAwAAAQEAqTP7';

function planError(fn: () => unknown): PlanError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PlanError) return error;
    throw error;
  }
  throw new Error('PlanError diharapkan, tetapi tidak dilempar');
}

describe('planInject', () => {
  test('mikrotik single AC: connectVia Server → sambung ke server.ip dengan kredensial server; skrip memuat address=192.168.88.1', () => {
    const plan = planInject({
      config,
      brand: 'mikrotik',
      mode: 'single',
      firmwareCode: 'AC',
      scripts,
      target: { ip: '192.168.88.1', username: 'admin', password: '' },
      sshKey: '',
    });
    expect(plan.connect).toEqual({ host: '192.168.88.2', username: 'admin', password: '' });
    expect(plan.script).toContain('address=192.168.88.1');
    expect(plan.script).toContain('user="admin" password=""');
    expect(plan.script).not.toContain('{');
    expect(plan.scriptKey).toBe('MIKROTIK/mikrotik-ac.txt');
  });

  test('ubiquiti single WA: connectVia Target → sambung ke IP target; skrip memuat "192.168.1.1 ssh-rsa" dan kunci', () => {
    const plan = planInject({
      config,
      brand: 'ubiquiti',
      mode: 'single',
      firmwareCode: 'WA',
      scripts,
      target: { ip: '192.168.88.50', username: 'ubnt', password: 'ubnt' },
      sshKey: SSH_KEY,
    });
    expect(plan.connect).toEqual({ host: '192.168.88.50', username: 'ubnt', password: 'ubnt' });
    expect(plan.script).toContain('192.168.1.1 ssh-rsa');
    expect(plan.script).toContain(`ssh-rsa ${SSH_KEY} >>`);
    // {usernameServer}@{ipServer} dari server.username dan mode.single.ipServer
    expect(plan.script).toContain('scp admin@192.168.1.1:/temp/WA.bin');
    expect(plan.scriptKey).toBe('UBIQUITI/WA.txt');
  });

  test('multi mengabaikan connectVia: selalu ke IP target', () => {
    // Konfigurasi nyata: mikrotik.multi.connectVia = Server.
    expect(config.brands.mikrotik?.multi.connectVia).toBe('Server');
    const plan = planInject({
      config,
      brand: 'mikrotik',
      mode: 'multi',
      firmwareCode: 'AC',
      scripts,
      target: { ip: '192.168.88.77', username: 'admin', password: 'pw' },
      sshKey: '',
    });
    expect(plan.connect).toEqual({ host: '192.168.88.77', username: 'admin', password: 'pw' });
    expect(plan.script).toContain('address=192.168.88.77');
  });

  test('firmware tak dikenal melempar FIRMWARE_UNKNOWN; skrip tak ada di peta melempar SCRIPT_MISSING; merk tanpa node melempar BRAND_MISSING', () => {
    const base = {
      config,
      brand: 'ubiquiti' as const,
      mode: 'single' as const,
      scripts,
      target: { ip: '192.168.88.50', username: 'ubnt', password: 'ubnt' },
      sshKey: SSH_KEY,
    };
    expect(planError(() => planInject({ ...base, firmwareCode: 'TIDAK-ADA' })).code).toBe(
      'FIRMWARE_UNKNOWN',
    );
    expect(
      planError(() => planInject({ ...base, firmwareCode: 'WA', scripts: new Map() })).code,
    ).toBe('SCRIPT_MISSING');

    const noMikrotik = parseConfig(
      JSON.stringify({
        server: { ip: '10.0.0.1' },
        ubiquiti: { folder: 'UBIQUITI', firmware: {} },
      }),
    ).config;
    expect(
      planError(() =>
        planInject({ ...base, config: noMikrotik, brand: 'mikrotik', firmwareCode: 'AC' }),
      ).code,
    ).toBe('BRAND_MISSING');
  });

  test('firmware tanpa file skrip melempar SCRIPT_MISSING', () => {
    const cfg = parseConfig(
      JSON.stringify({
        server: { ip: '10.0.0.1' },
        ubiquiti: { folder: 'UBIQUITI', firmware: { X: { label: 'X' } } },
      }),
    ).config;
    expect(
      planError(() =>
        planInject({
          config: cfg,
          brand: 'ubiquiti',
          mode: 'single',
          firmwareCode: 'X',
          scripts,
          target: { ip: '1.1.1.1', username: 'u', password: 'p' },
          sshKey: '',
        }),
      ).code,
    ).toBe('SCRIPT_MISSING');
  });

  test('nilai tak aman dirender aman: sandi berkutip di dalam kutip di-escape; nama pengguna berspasi tanpa kutip ditolak', () => {
    const base = {
      config,
      brand: 'mikrotik' as const,
      mode: 'multi' as const,
      firmwareCode: 'AC',
      scripts,
      sshKey: '',
    };
    const plan = planInject({
      ...base,
      target: { ip: '192.168.88.77', username: 'admin', password: 'a"b$c' },
    });
    expect(plan.script).toContain('password="a\\"b\\$c"');
    // `user={usernameTarget}` pada skrip nyata tidak berkutip: nilai tak aman tak boleh lolos.
    try {
      planInject({ ...base, target: { ip: '192.168.88.77', username: 'a b', password: 'x' } });
      throw new Error('ScriptRenderError diharapkan');
    } catch (error) {
      expect(error).toBeInstanceOf(ScriptRenderError);
      expect((error as ScriptRenderError).code).toBe('UNSAFE_BARE_VALUE');
    }
  });

  test('plan.secrets memuat kata sandi target dan server beserta semua bentuk sisipannya, tanpa string kosong', () => {
    const base = {
      config,
      brand: 'mikrotik' as const,
      mode: 'single' as const,
      firmwareCode: 'AC',
      scripts,
      sshKey: '',
    };
    const plan = planInject({
      ...base,
      target: { ip: '192.168.88.77', username: 'admin', password: 'a"b$c' },
    });
    expect(plan.secrets).toContain('a"b$c');
    expect(plan.secrets).toContain('a\\"b\\$c');
    expect(plan.secrets).not.toContain('');
    // Sandi server config.QC nyata kosong: tidak menambah apa pun.
    expect(config.server.password).toBe('');
    // Bentuk terescape yang benar-benar tampil di skrip termuat di secrets.
    expect(plan.script).toContain('password="a\\"b\\$c"');
  });

  test('scriptKey = folder/file', () => {
    const brand = config.brands.ubiquiti;
    if (!brand) throw new Error('fixture tanpa ubiquiti');
    expect(scriptKey(brand, 'WA.txt')).toBe('UBIQUITI/WA.txt');
  });
});

describe('nextPingDelayMs', () => {
  test('nextPingDelayMs: success 800, unreachable 500, error 500, timeout 200', () => {
    expect(nextPingDelayMs('success')).toBe(800);
    expect(nextPingDelayMs('unreachable')).toBe(500);
    expect(nextPingDelayMs('error')).toBe(500);
    expect(nextPingDelayMs('timeout')).toBe(200);
  });
});

describe('nextBridgeIndex', () => {
  test('nextBridgeIndex: naik hanya bila sukses, kembali ke 0 setelah indeks terakhir, tetap saat gagal', () => {
    expect(nextBridgeIndex(0, 3, true)).toBe(1);
    expect(nextBridgeIndex(1, 3, true)).toBe(2);
    expect(nextBridgeIndex(2, 3, true)).toBe(0);
    expect(nextBridgeIndex(0, 3, false)).toBe(0);
    expect(nextBridgeIndex(2, 3, false)).toBe(2);
  });

  test('nextBridgeIndex: indeks di luar rentang dan daftar kosong aman', () => {
    expect(nextBridgeIndex(7, 3, true)).toBe(0);
    expect(nextBridgeIndex(0, 0, true)).toBe(0);
    expect(nextBridgeIndex(0, 1, true)).toBe(0);
  });
});
