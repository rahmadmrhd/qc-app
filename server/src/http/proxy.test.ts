import { describe, expect, test } from 'bun:test';
import {
  clientIp,
  DEFAULT_TRUSTED_PROXY,
  isLoopbackAddress,
  isTrustedPeer,
  limiterAddress,
  normalizeAddress,
  parseTrustedProxy,
  type TrustedProxy,
} from './proxy';

function requestWith(header?: string): Request {
  return new Request('http://localhost/sync', {
    method: 'POST',
    headers: header === undefined ? {} : { 'CF-Connecting-IP': header },
  });
}

/** Daftar CIDR tepercaya dari teks; gagal keras bila tidak valid (tes tidak boleh diam-diam memakai daftar kosong). */
function trusted(text: string): TrustedProxy {
  const list = parseTrustedProxy(text);
  if (list === null) throw new Error(`CIDR tes tidak valid: ${text}`);
  return list;
}

const LOOPBACK_ONLY = trusted(DEFAULT_TRUSTED_PROXY);

describe('parseTrustedProxy (I5: daftar CIDR ketat)', () => {
  test('bawaan = loopback IPv4 dan IPv6', () => {
    expect(DEFAULT_TRUSTED_PROXY).toBe('127.0.0.1/32,::1/128');
    expect(parseTrustedProxy(DEFAULT_TRUSTED_PROXY)).toHaveLength(2);
  });

  test('satu entri, banyak entri, spasi di sekitar entri dipangkas', () => {
    expect(parseTrustedProxy('172.30.0.0/24')).toHaveLength(1);
    expect(parseTrustedProxy('127.0.0.1/32,::1/128,172.30.0.0/24,2001:db8::/32')).toHaveLength(4);
    expect(parseTrustedProxy(' 127.0.0.1/32 , 10.0.0.0/8 ')).toHaveLength(2);
  });

  test('prefiks 0 dan prefiks penuh sah (percaya semua / satu alamat)', () => {
    expect(parseTrustedProxy('0.0.0.0/0,::/0')).toHaveLength(2);
    expect(parseTrustedProxy('203.0.113.7/32,2001:db8::1/128')).toHaveLength(2);
  });

  test('CIDR rusak = null (tidak diam-diam kosong atau melonggar)', () => {
    const broken = [
      '', // kosong
      '   ',
      ',', // entri kosong
      '127.0.0.1/32,', // koma ekor
      ',127.0.0.1/32',
      '127.0.0.1', // tanpa prefiks
      '::1',
      'loopback', // kata kunci lama tidak ada lagi
      'any',
      '172.30.0.0/33', // prefiks IPv4 di luar 0-32
      '2001:db8::/129', // prefiks IPv6 di luar 0-128
      '172.30.0.0/-1',
      '172.30.0.0/',
      '172.30.0.0/abc',
      '172.30.0.0/024', // prefiks berangka nol di depan
      '172.30.0.0/1.5',
      '256.0.0.0/8', // oktet > 255
      '172.30.0/24', // oktet kurang
      '172.30.0.0.1/24', // oktet lebih
      '172.030.0.0/24', // nol di depan (ambigu oktal)
      '172.30.0.0/ 24',
      'a.b.c.d/8',
      '2001:db8::g/64', // bukan heksa
      '2001:db8:::1/64', // ::: tidak sah
      '1::2::3/64', // dua ::
      '1:2:3:4:5:6:7:8:9/64', // sembilan kelompok
      '10.0.0.5/24', // bit tuan rumah terisi: jaringan seharusnya 10.0.0.0/24
      '2001:db8::1/32',
      '172.30.0.0/24/8',
      '172.30.0.0/24 172.31.0.0/24', // pemisah spasi, bukan koma
      '172.30.0.0/24;172.31.0.0/24',
      "127.0.0.1/32'--",
    ];
    for (const text of broken) expect(parseTrustedProxy(text)).toBeNull();
  });
});

describe('isTrustedPeer', () => {
  test('peer di dalam / di luar CIDR IPv4', () => {
    const list = trusted('172.30.0.0/24');
    expect(isTrustedPeer('172.30.0.1', list)).toBe(true);
    expect(isTrustedPeer('172.30.0.254', list)).toBe(true);
    expect(isTrustedPeer('172.30.1.1', list)).toBe(false);
    expect(isTrustedPeer('172.31.0.1', list)).toBe(false);
    expect(isTrustedPeer('127.0.0.1', list)).toBe(false);
  });

  test('batas prefiks: /32 satu alamat, /31 dua alamat, /0 semua IPv4', () => {
    expect(isTrustedPeer('10.0.0.1', trusted('10.0.0.1/32'))).toBe(true);
    expect(isTrustedPeer('10.0.0.2', trusted('10.0.0.1/32'))).toBe(false);
    expect(isTrustedPeer('10.0.0.1', trusted('10.0.0.0/31'))).toBe(true);
    expect(isTrustedPeer('10.0.0.2', trusted('10.0.0.0/31'))).toBe(false);
    expect(isTrustedPeer('203.0.113.7', trusted('0.0.0.0/0'))).toBe(true);
  });

  test('IPv4-mapped (::ffff:a.b.c.d dan bentuk heksa) dicocokkan ke CIDR IPv4', () => {
    const list = trusted('172.30.0.0/24');
    expect(isTrustedPeer('::ffff:172.30.0.1', list)).toBe(true);
    expect(isTrustedPeer('::ffff:ac1e:0001', list)).toBe(true);
    expect(isTrustedPeer('::FFFF:172.30.0.9', list)).toBe(true);
    expect(isTrustedPeer('::ffff:172.31.0.1', list)).toBe(false);
    // loopback mapped yang dilaporkan soket dual-stack Bun
    expect(isTrustedPeer('::ffff:127.0.0.1', LOOPBACK_ONLY)).toBe(true);
  });

  test('IPv6: peer di dalam / di luar CIDR, bentuk singkat dan panjang setara', () => {
    const list = trusted('2001:db8:1::/48');
    expect(isTrustedPeer('2001:db8:1::1', list)).toBe(true);
    expect(isTrustedPeer('2001:0DB8:0001:ffff:ffff:ffff:ffff:ffff', list)).toBe(true);
    expect(isTrustedPeer('2001:db8:2::1', list)).toBe(false);
    expect(isTrustedPeer('2001:db9:1::1', list)).toBe(false);
    expect(isTrustedPeer('::1', trusted('::1/128'))).toBe(true);
    expect(isTrustedPeer('::2', trusted('::1/128'))).toBe(false);
    expect(isTrustedPeer('fe80::1%eth0', trusted('fe80::/10'))).toBe(true); // zona dibuang
  });

  test('IPv4 biasa tidak cocok dengan CIDR IPv6 sungguhan; IPv6 tidak cocok dengan CIDR IPv4', () => {
    expect(isTrustedPeer('172.30.0.1', trusted('2001:db8::/32'))).toBe(false);
    expect(isTrustedPeer('2001:db8::1', trusted('172.30.0.0/24'))).toBe(false);
    expect(isTrustedPeer('::1', trusted('127.0.0.1/32'))).toBe(false);
    expect(isTrustedPeer('127.0.0.1', trusted('::1/128'))).toBe(false);
  });

  test('daftar banyak entri: cocok dengan salah satunya', () => {
    const list = trusted('127.0.0.1/32,::1/128,172.30.0.0/24,2001:db8::/32');
    for (const peer of ['127.0.0.1', '::1', '172.30.0.7', '2001:db8::7', '::ffff:172.30.0.7']) {
      expect(isTrustedPeer(peer, list)).toBe(true);
    }
    for (const peer of ['127.0.0.2', '::2', '172.30.1.7', '2001:db9::7', '203.0.113.7']) {
      expect(isTrustedPeer(peer, list)).toBe(false);
    }
  });

  test('peer kosong atau tak dapat diurai tidak pernah tepercaya, juga untuk /0', () => {
    const everyone = trusted('0.0.0.0/0,::/0');
    for (const peer of ['', 'unknown', 'bukan ip', '1.2.3', '999.1.1.1']) {
      expect(isTrustedPeer(peer, everyone)).toBe(false);
    }
  });

  test('daftar kosong tidak memercayai siapa pun', () => {
    expect(isTrustedPeer('127.0.0.1', [])).toBe(false);
  });
});

describe('clientIp', () => {
  test('bawaan: memakai CF-Connecting-IP bila peer 127.0.0.1, ::1, atau ::ffff:127.0.0.1', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(clientIp(requestWith('198.51.100.9'), peer)).toBe('198.51.100.9');
      expect(clientIp(requestWith('198.51.100.9'), peer, LOOPBACK_ONLY)).toBe('198.51.100.9');
    }
    expect(clientIp(requestWith('2001:db8::7'), '127.0.0.1', LOOPBACK_ONLY)).toBe('2001:db8::7');
  });

  test('peer di dalam CIDR (gateway bridge Docker) dipercaya: IP klien dari CF-Connecting-IP', () => {
    const docker = trusted('127.0.0.1/32,::1/128,172.30.0.0/24');
    expect(clientIp(requestWith('198.51.100.9'), '172.30.0.1', docker)).toBe('198.51.100.9');
    expect(clientIp(requestWith('198.51.100.9'), '::ffff:172.30.0.1', docker)).toBe('198.51.100.9');
    expect(clientIp(requestWith('2001:db8::7'), '172.30.0.1', docker)).toBe('2001:db8::7');
  });

  test('peer di luar daftar: CF-Connecting-IP diabaikan (Review Focus 4), peer yang dipakai', () => {
    const docker = trusted('172.30.0.0/24');
    expect(clientIp(requestWith('198.51.100.9'), '203.0.113.7', docker)).toBe('203.0.113.7');
    expect(clientIp(requestWith('198.51.100.9'), '::ffff:203.0.113.7', docker)).toBe('203.0.113.7');
    expect(clientIp(requestWith('198.51.100.9'), '2001:db8::1', docker)).toBe('2001:db8::1');
    // loopback tidak otomatis tepercaya bila tidak ada di daftar
    expect(clientIp(requestWith('198.51.100.9'), '127.0.0.1', docker)).toBe('127.0.0.1');
    // bawaan sempit: 127.0.0.2 bukan 127.0.0.1/32
    expect(clientIp(requestWith('198.51.100.9'), '127.0.0.2', LOOPBACK_ONLY)).toBe('127.0.0.2');
    // tetangga di subnet lain pada jaringan Docker lain
    expect(clientIp(requestWith('198.51.100.9'), '172.31.0.1', docker)).toBe('172.31.0.1');
  });

  test('CF-Connecting-IP palsu dari peer di luar daftar tidak mengubah hasil, apa pun isinya', () => {
    const docker = trusted('172.30.0.0/24');
    for (const forged of ['1.1.1.1', '172.30.0.1', '127.0.0.1', '::1', '2001:db8::99']) {
      expect(clientIp(requestWith(forged), '203.0.113.7', docker)).toBe('203.0.113.7');
    }
  });

  test('tanpa header: alamat peer; peer kosong: unknown', () => {
    expect(clientIp(requestWith(), '127.0.0.1', LOOPBACK_ONLY)).toBe('127.0.0.1');
    expect(clientIp(requestWith(), '203.0.113.7', LOOPBACK_ONLY)).toBe('203.0.113.7');
    expect(clientIp(requestWith(), '', LOOPBACK_ONLY)).toBe('unknown');
    expect(clientIp(requestWith('198.51.100.9'), '', LOOPBACK_ONLY)).toBe('unknown');
  });

  test('header yang bukan alamat IP (terlalu panjang, karakter aneh) diabaikan', () => {
    for (const bad of ['', 'bukan ip', '1.2.3.4, 5.6.7.8', "1.2.3.4'--", 'a'.repeat(60)]) {
      expect(clientIp(requestWith(bad), '127.0.0.1', LOOPBACK_ONLY)).toBe('127.0.0.1');
    }
  });

  test('percaya semua (0.0.0.0/0,::/0) hanya bila operator menulisnya eksplisit', () => {
    const everyone = trusted('0.0.0.0/0,::/0');
    expect(clientIp(requestWith('198.51.100.9'), '203.0.113.7', everyone)).toBe('198.51.100.9');
    expect(clientIp(requestWith('198.51.100.9'), '2001:db8::1', everyone)).toBe('198.51.100.9');
    expect(clientIp(requestWith(), '203.0.113.7', everyone)).toBe('203.0.113.7');
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

describe('limiterAddress: IPv4-compatible dan IPv4-translated (n4)', () => {
  test('::a.b.c.d, ::hhhh:hhhh (IPv4-compatible) dan ::ffff:0:a.b.c.d (IPv4-translated) = IPv4 yang sama', () => {
    for (const form of [
      '::192.0.2.4',
      '::c000:204',
      '::c000:0204',
      '0:0:0:0:0:0:c000:204',
      '::ffff:0:192.0.2.4',
      '::ffff:0:c000:204',
      '0:0:0:0:ffff:0:c000:204',
    ]) {
      expect(limiterAddress(form)).toBe('192.0.2.4');
    }
  });

  test('IPv6 sungguhan tidak ikut ternormalisasi keliru (::1, ::2, ::, 2001:db8::1, NAT64)', () => {
    expect(limiterAddress('::1')).toBe('0:0:0:0::/64');
    expect(limiterAddress('::2')).toBe('0:0:0:0::/64');
    expect(limiterAddress('::')).toBe('0:0:0:0::/64');
    expect(limiterAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(limiterAddress('2001:db8:0:0:0:0:c000:204')).toBe('2001:db8:0:0::/64');
    expect(limiterAddress('64:ff9b::c000:204')).toBe('64:ff9b:0:0::/64'); // NAT64 bukan IPv4-compatible
  });
});
