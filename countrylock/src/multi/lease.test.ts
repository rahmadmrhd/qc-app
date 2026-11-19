import { describe, expect, test } from 'bun:test';
import { LEASE_COMMAND, normalizeMac, parseDhcpLeases } from './lease';

describe('parseDhcpLeases', () => {
  test('contoh L4.3', () => {
    expect(
      parseDhcpLeases('0 D address=192.168.88.1 mac-address=58:D6:1F:0E:4E:FE status=bound'),
    ).toEqual([{ ip: '192.168.88.1', mac: '58:D6:1F:0E:4E:FE' }]);
  });

  test('banyak baris, CRLF, dan baris kosong', () => {
    const out =
      '0 D address=10.0.0.2 mac-address=AA:AA:AA:AA:AA:01 status=bound\r\n\r\n' +
      '1 D address=10.0.0.3 mac-address=AA:AA:AA:AA:AA:02 status=bound\r\n';
    expect(parseDhcpLeases(out)).toEqual([
      { ip: '10.0.0.2', mac: 'AA:AA:AA:AA:AA:01' },
      { ip: '10.0.0.3', mac: 'AA:AA:AA:AA:AA:02' },
    ]);
  });

  test('baris tanpa address=, tanpa MAC sah, atau IP tak sah dibuang', () => {
    const out = [
      '0 D mac-address=58:D6:1F:0E:4E:FE status=bound',
      '1 D address=10.0.0.5 status=bound',
      '2 D address=10.0.0.6 mac-address=xyz status=bound',
      '3 D address=10.0.0.7 mac-address= status=bound',
      '4 D address= mac-address=58:D6:1F:0E:4E:01 status=bound',
      '5 D address=999.1.1.1 mac-address=58:D6:1F:0E:4E:02 status=bound',
    ].join('\n');
    expect(parseDhcpLeases(out)).toEqual([]);
  });

  test('status selain bound dibuang; tanpa status diterima', () => {
    const out = [
      '0 address=10.0.0.2 mac-address=AA:AA:AA:AA:AA:01 status=waiting',
      '1 address=10.0.0.3 mac-address=AA:AA:AA:AA:AA:02 status=bound',
      '2 address=10.0.0.4 mac-address=AA:AA:AA:AA:AA:03',
    ].join('\n');
    expect(parseDhcpLeases(out).map((l) => l.ip)).toEqual(['10.0.0.3', '10.0.0.4']);
  });

  test('MAC huruf kecil dinormalisasi', () => {
    expect(parseDhcpLeases('address=10.0.0.9 mac-address=58:d6:1f:0e:4e:fe status=bound')).toEqual([
      { ip: '10.0.0.9', mac: '58:D6:1F:0E:4E:FE' },
    ]);
  });

  test('keluaran kosong atau aneh = [] tanpa melempar', () => {
    expect(parseDhcpLeases('')).toEqual([]);
    expect(parseDhcpLeases('bad command name\n\u0000\u001b[31m')).toEqual([]);
    expect(parseDhcpLeases(undefined as unknown as string)).toEqual([]);
  });

  test('duplikat MAC memakai baris terakhir', () => {
    const out = [
      '0 address=10.0.0.2 mac-address=AA:AA:AA:AA:AA:01 status=bound',
      '1 address=10.0.0.9 mac-address=aa:aa:aa:aa:aa:01 status=bound',
    ].join('\n');
    expect(parseDhcpLeases(out)).toEqual([{ ip: '10.0.0.9', mac: 'AA:AA:AA:AA:AA:01' }]);
  });

  test('LEASE_COMMAND persis', () => {
    expect(LEASE_COMMAND).toBe(
      '/ip dhcp-server lease print terse proplist=address,mac-address,status where status=bound',
    );
  });
});

describe('normalizeMac', () => {
  test('berbagai pemisah', () => {
    for (const raw of [
      '58-d6-1f-0e-4e-fe',
      '58d6.1f0e.4efe',
      '58D61F0E4EFE',
      '58:d6:1f:0e:4e:fe',
    ]) {
      expect(normalizeMac(raw)).toBe('58:D6:1F:0E:4E:FE');
    }
  });
  test('tak sah = null', () => {
    for (const raw of ['xyz', '', '58:D6:1F:0E:4E', '58:D6:1F:0E:4E:FE:00', 'GG:D6:1F:0E:4E:FE']) {
      expect(normalizeMac(raw)).toBeNull();
    }
  });
});
