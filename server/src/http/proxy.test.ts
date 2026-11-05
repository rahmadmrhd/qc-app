import { describe, expect, test } from 'bun:test';
import { clientIp, isLoopbackAddress, limiterAddress, normalizeAddress } from './proxy';

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

describe('limiterAddress (I4: IPv6 per /64)', () => {
  test('IPv4 dan unknown tetap per alamat', () => {
    expect(limiterAddress('198.51.100.9')).toBe('198.51.100.9');
    expect(limiterAddress('198.51.100.10')).toBe('198.51.100.10');
    expect(limiterAddress('::ffff:198.51.100.9')).toBe('198.51.100.9');
    expect(limiterAddress('unknown')).toBe('unknown');
  });

  test('dua alamat dalam /64 yang sama berbagi satu kunci; /64 lain berbeda', () => {
    const a = limiterAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(limiterAddress('2001:db8:1:2::1')).toBe(a);
    expect(limiterAddress('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe(a);
    expect(limiterAddress('2001:db8:1:3::1')).not.toBe(a);
    expect(limiterAddress('2001:db8:2:2::1')).not.toBe(a);
    expect(a).toBe('2001:db8:1:2::/64');
  });

  test('bentuk singkat "::" diperluas dengan benar', () => {
    expect(limiterAddress('2001:db8::7')).toBe('2001:db8:0:0::/64');
    expect(limiterAddress('::1')).toBe('0:0:0:0::/64');
    expect(limiterAddress('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0::/64');
  });

  test('panjang kunci muat di kolom key (VARCHAR 255) dengan awalan terpanjang', () => {
    expect(
      `sync:blocked:${limiterAddress('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')}`.length,
    ).toBeLessThan(255);
  });

  test('alamat yang tak dapat diurai dikembalikan apa adanya (huruf kecil)', () => {
    expect(limiterAddress('bukan:ip:::::x')).toBe('bukan:ip:::::x');
  });
});

describe('limiterAddress: IPv4-mapped bentuk heksa (m5)', () => {
  test('::ffff:c000:0204 dinormalkan ke IPv4 yang sama dengan ::ffff:192.0.2.4 (satu penghitung per IPv4)', () => {
    const dotted = limiterAddress('::ffff:192.0.2.4');
    expect(dotted).toBe('192.0.2.4');
    for (const hex of [
      '::ffff:c000:0204',
      '::ffff:c000:204',
      '::FFFF:C000:0204',
      '0:0:0:0:0:ffff:c000:204',
    ]) {
      expect(limiterAddress(hex)).toBe(dotted);
    }
  });

  test('IPv4 berbeda tetap berbeda dan tidak jatuh ke ember /64 bersama ::1', () => {
    expect(limiterAddress('::ffff:c000:0205')).toBe('192.0.2.5');
    expect(limiterAddress('::ffff:c000:0205')).not.toBe(limiterAddress('::1'));
  });
});
