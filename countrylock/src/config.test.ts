import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeInterfaces, ConfigError, parseConfig, type ServerConfig } from './config';

const REAL = readFileSync(
  join(import.meta.dir, '..', 'fixtures', 'country-lock2', 'config.QC'),
  'utf8',
);

function realObject(): Record<string, unknown> {
  return JSON.parse(REAL) as Record<string, unknown>;
}

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ip: '192.168.88.2',
    username: 'admin',
    password: '',
    interfaceComp: 'ether5',
    interfaceList: ['ether1', 'ether2', 'ether3'],
    interfaceBridge: 'BridgeAll',
    ...overrides,
  };
}

describe('parseConfig', () => {
  test('config.QC nyata terurai: 9 firmware Ubiquiti, 8 Mikrotik, server.ip 192.168.88.2', () => {
    const { config } = parseConfig(REAL);
    expect(config.server.ip).toBe('192.168.88.2');
    expect(config.server.username).toBe('admin');
    expect(config.server.interfaceComp).toBe('ether5');
    expect(config.server.interfaceList).toEqual(['ether1', 'ether2', 'ether3']);
    expect(config.server.interfaceBridge).toBe('BridgeAll');

    const ubnt = config.brands.ubiquiti;
    expect(ubnt?.firmware.length).toBe(9);
    expect(ubnt?.label).toBe('Ubiquiti');
    expect(ubnt?.folder).toBe('UBIQUITI');
    expect(ubnt?.username).toBe('ubnt');
    expect(ubnt?.web).toBe('https://{ip}/');
    expect(ubnt?.firmware.find((f) => f.code === 'WA')).toEqual({
      code: 'WA',
      label: 'WA Firmware',
      file: 'WA.txt',
    });
    expect(ubnt?.single).toEqual({
      ip: '192.168.88.50',
      ipServer: '192.168.1.1',
      connectVia: 'Target',
      interfaceBridge: 'UBNTSingle',
    });

    const mikrotik = config.brands.mikrotik;
    expect(mikrotik?.firmware.length).toBe(8);
    expect(mikrotik?.firmware.find((f) => f.code === 'Mantbox 19s')?.file).toBe(
      'mikrotik-mantbox.txt',
    );
    expect(mikrotik?.single.connectVia).toBe('Server');
    expect(mikrotik?.single.ip).toBe('192.168.88.1');
    // ipServer tak diisi di berkas: jatuh ke server.ip.
    expect(mikrotik?.single.ipServer).toBe('192.168.88.2');
  });

  test('sshKeys diabaikan dengan peringatan dan kunci tak dikenal manualCredentialInput tetap ada di raw', () => {
    const { config, warnings } = parseConfig(REAL);
    expect(warnings.some((w) => w.includes('sshKeys'))).toBe(true);
    // Isi kunci tidak pernah masuk ke peringatan.
    expect(warnings.join('\n')).not.toContain('AAAAB3Nza');
    // Tak ada properti sshKeys di model terurai.
    expect(JSON.stringify(config.brands)).not.toContain('AAAAB3Nza');
    const raw = config.raw as { mikrotik: Record<string, unknown>; version: number };
    expect(raw.mikrotik.manualCredentialInput).toBe(false);
    expect(raw.version).toBe(5);
  });

  test('sshKeys rusak (bukan objek, null, entri berakhiran "==)") tidak melempar dan tetap diabaikan', () => {
    for (const broken of ['rusak', ['a'], null, 42, { X: '...==)' }, {}]) {
      const obj = realObject();
      (obj.ubiquiti as Record<string, unknown>).sshKeys = broken;
      const { config, warnings } = parseConfig(JSON.stringify(obj));
      expect(config.brands.ubiquiti?.firmware.length).toBe(9);
      expect(warnings.some((w) => w.includes('sshKeys'))).toBe(true);
    }
  });

  test('tanpa node mikrotik tetap terurai dan brands.mikrotik tak ada', () => {
    const obj = realObject();
    delete obj.mikrotik;
    const { config } = parseConfig(JSON.stringify(obj));
    expect(config.brands.mikrotik).toBeUndefined();
    expect(config.brands.ubiquiti?.firmware.length).toBe(9);
    expect(config.server.ip).toBe('192.168.88.2');
  });

  test('node merk yang bukan objek dilewati dengan peringatan', () => {
    const obj = realObject();
    obj.mikrotik = 'rusak';
    const { config, warnings } = parseConfig(JSON.stringify(obj));
    expect(config.brands.mikrotik).toBeUndefined();
    expect(warnings.some((w) => w.includes('mikrotik'))).toBe(true);
  });

  test('server.ip kosong melempar ConfigError', () => {
    for (const ip of ['', '   ', undefined, 5]) {
      const obj = realObject();
      (obj.server as Record<string, unknown>).ip = ip;
      expect(() => parseConfig(JSON.stringify(obj))).toThrow(ConfigError);
    }
    const noServer = realObject();
    delete noServer.server;
    expect(() => parseConfig(JSON.stringify(noServer))).toThrow(ConfigError);
  });

  test('multi jatuh ke single bila kosong; ipServer ke server.ip; interfaceBridge ke server lalu "bridge1"', () => {
    const json = JSON.stringify({
      server: { ip: '10.0.0.1', username: 'u', password: 'p', interfaceBridge: 'SrvBridge' },
      ubiquiti: {
        folder: 'UBIQUITI',
        firmware: { WA: { file: 'WA.txt' } },
        mode: {
          single: {
            ip: '1.1.1.1',
            ipServer: '9.9.9.9',
            connectVia: 'server',
            interfaceBridge: 'S',
          },
          multi: { connectVia: '', interfaceBridge: 'M' },
        },
      },
      mikrotik: {
        folder: 'MIKROTIK',
        firmware: { AC: { file: 'ac.txt' } },
        mode: { single: { ip: '2.2.2.2' } },
      },
    });
    const { config } = parseConfig(json);
    const ubnt = config.brands.ubiquiti;
    // connectVia tak peka huruf.
    expect(ubnt?.single.connectVia).toBe('Server');
    // multi.connectVia kosong -> single; interfaceBridge multi terisi -> M.
    expect(ubnt?.multi.connectVia).toBe('Server');
    expect(ubnt?.multi.interfaceBridge).toBe('M');
    expect(ubnt?.multi.ipServer).toBe('9.9.9.9');
    // IP perangkat hanya milik mode tunggal.
    expect(ubnt?.single.ip).toBe('1.1.1.1');
    expect(ubnt?.multi.ip).toBe('');
    // label bawaan firmware = kode; label merk bawaan.
    expect(ubnt?.firmware[0]).toEqual({ code: 'WA', label: 'WA', file: 'WA.txt' });
    expect(ubnt?.label).toBe('Ubiquiti');

    const mikrotik = config.brands.mikrotik;
    expect(mikrotik?.single.ipServer).toBe('10.0.0.1');
    expect(mikrotik?.single.interfaceBridge).toBe('SrvBridge');
    expect(mikrotik?.single.connectVia).toBe('Target');
    expect(mikrotik?.multi.ipServer).toBe('10.0.0.1');
    expect(mikrotik?.multi.interfaceBridge).toBe('SrvBridge');

    // Tanpa interfaceBridge server: bawaan akhir "bridge1".
    const bare = parseConfig(
      JSON.stringify({ server: { ip: '10.0.0.1' }, mikrotik: { folder: 'M', firmware: {} } }),
    );
    expect(bare.config.brands.mikrotik?.single.interfaceBridge).toBe('bridge1');
    expect(bare.config.brands.mikrotik?.multi.interfaceBridge).toBe('bridge1');
    // Bawaan server: comp ether1, daftar ether1..ether5.
    expect(bare.config.server.interfaceComp).toBe('ether1');
    expect(bare.config.server.interfaceList).toEqual([
      'ether1',
      'ether2',
      'ether3',
      'ether4',
      'ether5',
    ]);
  });

  test('interfaceList boleh string koma; spasi dipangkas dan entri kosong dibuang', () => {
    const { config } = parseConfig(
      JSON.stringify({ server: { ip: '10.0.0.1', interfaceList: ' ether2 , ,ether3,' } }),
    );
    expect(config.server.interfaceList).toEqual(['ether2', 'ether3']);
  });

  test('JSON rusak melempar ConfigError', () => {
    expect(() => parseConfig('{ rusak')).toThrow(ConfigError);
    expect(() => parseConfig('')).toThrow(ConfigError);
    expect(() => parseConfig('null')).toThrow(ConfigError);
    expect(() => parseConfig('[]')).toThrow(ConfigError);
  });

  test('firmware tak berbentuk objek dilewati dengan peringatan; entri tanpa file diberi peringatan', () => {
    const { config, warnings } = parseConfig(
      JSON.stringify({
        server: { ip: '10.0.0.1' },
        mikrotik: { folder: 'M', firmware: ['AC'] },
        ubiquiti: { folder: 'U', firmware: { WA: { label: 'WA' }, X: 'bukan-objek' } },
      }),
    );
    expect(config.brands.mikrotik?.firmware).toEqual([]);
    expect(config.brands.ubiquiti?.firmware).toEqual([{ code: 'WA', label: 'WA', file: '' }]);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe('bridgeInterfaces', () => {
  test('bridgeInterfaces membuang interfaceComp dan duplikat', () => {
    expect(
      bridgeInterfaces(
        server({ interfaceList: ['ether1', 'ether2', 'ether3'], interfaceComp: 'ether5' }),
      ),
    ).toEqual(['ether1', 'ether2', 'ether3']);
    expect(
      bridgeInterfaces(
        server({ interfaceList: ['ether1', 'ether2', 'ether3'], interfaceComp: 'ether1' }),
      ),
    ).toEqual(['ether2', 'ether3']);
    expect(
      bridgeInterfaces(
        server({
          interfaceList: ['ether2', 'ether2', 'ether3', 'ether3'],
          interfaceComp: 'ether1',
        }),
      ),
    ).toEqual(['ether2', 'ether3']);
  });
});
