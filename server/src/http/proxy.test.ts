import { describe, expect, test } from 'bun:test';
import { clientIp, isLoopbackAddress, normalizeAddress } from './proxy';

function requestWith(header?: string): Request {
  return new Request('http://localhost/sync', {
    method: 'POST',
    headers: header === undefined ? {} : { 'CF-Connecting-IP': header },
  });
}

describe('clientIp', () => {
  test('memakai CF-Connecting-IP bila peer loopback (127.0.0.1, ::1, 127.x, IPv4-mapped)', () => {
    for (const peer of ['127.0.0.1', '::1', '127.0.1.1', '::ffff:127.0.0.1']) {
      expect(clientIp(requestWith('198.51.100.9'), peer, 'loopback')).toBe('198.51.100.9');
    }
    expect(clientIp(requestWith('2001:db8::7'), '127.0.0.1', 'loopback')).toBe('2001:db8::7');
  });

  test('mengabaikan CF-Connecting-IP bila peer bukan loopback (Review Focus 4)', () => {
    expect(clientIp(requestWith('198.51.100.9'), '203.0.113.7', 'loopback')).toBe('203.0.113.7');
    expect(clientIp(requestWith('198.51.100.9'), '::ffff:203.0.113.7', 'loopback')).toBe(
      '203.0.113.7',
    );
    expect(clientIp(requestWith('198.51.100.9'), '2001:db8::1', 'loopback')).toBe('2001:db8::1');
  });

  test('tanpa header: alamat peer; peer kosong: unknown', () => {
    expect(clientIp(requestWith(), '127.0.0.1', 'loopback')).toBe('127.0.0.1');
    expect(clientIp(requestWith(), '203.0.113.7', 'loopback')).toBe('203.0.113.7');
    expect(clientIp(requestWith(), '', 'loopback')).toBe('unknown');
  });

  test('header yang bukan alamat IP (terlalu panjang, karakter aneh) diabaikan', () => {
    for (const bad of ['', 'bukan ip', '1.2.3.4, 5.6.7.8', "1.2.3.4'--", 'a'.repeat(60)]) {
      expect(clientIp(requestWith(bad), '127.0.0.1', 'loopback')).toBe('127.0.0.1');
    }
  });

  test("trustedProxy 'any' memercayai header dari peer mana pun", () => {
    expect(clientIp(requestWith('198.51.100.9'), '203.0.113.7', 'any')).toBe('198.51.100.9');
    expect(clientIp(requestWith(), '203.0.113.7', 'any')).toBe('203.0.113.7');
  });
});

describe('alamat', () => {
  test('isLoopbackAddress', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('203.0.113.7')).toBe(false);
    expect(isLoopbackAddress('128.0.0.1')).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });

  test('normalizeAddress membuang pembungkus IPv4-mapped dan zona', () => {
    expect(normalizeAddress('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeAddress(' 10.0.0.5 ')).toBe('10.0.0.5');
  });
});
