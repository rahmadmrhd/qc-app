import { describe, expect, test } from 'bun:test';
import { cleanCountry, describeDevice, truncateIp, VISIT_LIMITS } from './dashboard-visit';

describe('truncateIp', () => {
  test('IPv4 dipotong /24', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateIp('10.0.0.1')).toBe('10.0.0.0/24');
    expect(truncateIp('  8.8.8.8 ')).toBe('8.8.8.0/24');
  });

  test('IPv6 dipotong /48 dan ditulis ringkas huruf kecil', () => {
    expect(truncateIp('2001:db8:abcd:12:ffff:eeee:dddd:1')).toBe('2001:db8:abcd::/48');
    expect(truncateIp('2001:DB8::1')).toBe('2001:db8:0::/48');
    expect(truncateIp('::1')).toBe('0:0:0::/48');
  });

  test('IPv4-mapped IPv6 diperlakukan sebagai IPv4 (bentuk bertitik dan heksadesimal)', () => {
    expect(truncateIp('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateIp('::FFFF:203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateIp('::ffff:cb00:714d')).toBe('203.0.113.0/24');
  });

  test('tak sah, kosong, atau bukan alamat = kosong (tidak pernah mengembalikan IP asli)', () => {
    for (const bad of [
      '',
      'unknown',
      'abc',
      '256.1.1.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      'gggg::1',
      '203.0.113.7/24',
      'x'.repeat(100),
    ]) {
      expect([bad, truncateIp(bad)]).toEqual([bad, '']);
    }
  });

  test('IPv6 cacat = kosong, bukan ditebak sebagai IPv4 (M6)', () => {
    for (const bad of [
      '::ffff:c1.2.3.4',
      '::c1.2.3.4',
      'abc1.2.3.4:5',
      '::ffff:300.1.1.1',
      '::ffff:1.2.3',
      '::ffff:01.2.3.4',
      '1::2::3',
      '::1::',
      ':::1',
      '2001:db8:::1',
      '12345::1',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7::8',
      '1:2:3:4:5:6:7:8::',
      '2001:db8::zz',
      'fe80::1%eth0',
      '::1%',
      '2001:db8:abcd:12:ffff:eeee:dddd',
      '1.2.3.4::1',
    ]) {
      expect([bad, truncateIp(bad)]).toEqual([bad, '']);
    }
  });

  test('IPv6 sah tetap dipotong, termasuk IPv4-mapped yang benar', () => {
    expect(truncateIp('::ffff:193.2.3.4')).toBe('193.2.3.0/24');
    expect(truncateIp('0:0:0:0:0:ffff:193.2.3.4')).toBe('193.2.3.0/24');
    expect(truncateIp('1:2:3:4:5:6:7:8')).toBe('1:2:3::/48');
    expect(truncateIp('1::')).toBe('1:0:0::/48');
    expect(truncateIp('2001:db8:1:2:3:4:1.2.3.4')).toBe('2001:db8:1::/48');
  });

  test('keluaran tidak pernah memuat alamat asli', () => {
    for (const ip of ['203.0.113.77', '2001:db8:abcd:12:ffff:eeee:dddd:1', '::ffff:198.51.100.9']) {
      const out = truncateIp(ip);
      expect(out.includes(ip)).toBe(false);
      expect(out.endsWith('/24') || out.endsWith('/48')).toBe(true);
    }
  });
});

describe('describeDevice', () => {
  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const EDGE_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const CHROME_ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const SAFARI_IPAD =
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  test('perangkat umum', () => {
    expect(describeDevice(CHROME_WIN)).toBe('Desktop · Chrome · Windows');
    expect(describeDevice(EDGE_WIN)).toBe('Desktop · Edge · Windows');
    expect(describeDevice(SAFARI_IPHONE)).toBe('Ponsel · Safari · iOS');
    expect(describeDevice(CHROME_ANDROID)).toBe('Ponsel · Chrome · Android');
    expect(describeDevice(FIREFOX_LINUX)).toBe('Desktop · Firefox · Linux');
    expect(describeDevice(SAFARI_MAC)).toBe('Desktop · Safari · macOS');
    expect(describeDevice(SAFARI_IPAD)).toBe('Tablet · Safari · iOS');
  });

  test('kosong atau tak dikenal: kosong atau nilai netral dari daftar putih', () => {
    expect(describeDevice('')).toBe('');
    expect(describeDevice('   ')).toBe('');
    expect(describeDevice('curl/8.5.0')).toBe('Bot · Browser lain · OS lain');
    expect(describeDevice('xyz')).toBe('Desktop · Browser lain · OS lain');
  });

  test('hasil hanya dari daftar putih dan pendek; User-Agent mentah tak pernah ikut', () => {
    const hostile = `Firefox/1 Windows <script>alert(1)</script>${'A'.repeat(5000)}`;
    const out = describeDevice(hostile);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toContain('<');
    expect(out).not.toContain('script');
    expect(out).toBe('Desktop · Firefox · Windows');
    expect(describeDevice(CHROME_WIN)).not.toContain('537');
  });

  test('bukan string = kosong', () => {
    expect(describeDevice(undefined as unknown as string)).toBe('');
    expect(describeDevice(null as unknown as string)).toBe('');
  });
});

describe('cleanCountry', () => {
  test('dua huruf menjadi huruf besar; selain itu kosong', () => {
    expect(cleanCountry('id')).toBe('ID');
    expect(cleanCountry(' US ')).toBe('US');
    expect(cleanCountry('')).toBe('');
    expect(cleanCountry(null)).toBe('');
    expect(cleanCountry('IDN')).toBe('');
    expect(cleanCountry('T1')).toBe('');
    expect(cleanCountry('1A')).toBe('');
    expect(cleanCountry('XX')).toBe('');
    expect(cleanCountry('<s')).toBe('');
  });
});

describe('VISIT_LIMITS', () => {
  test('nilai sesuai keputusan (50 terakhir, dedup 30 menit)', () => {
    expect(VISIT_LIMITS).toEqual({ keep: 50, dedupMs: 30 * 60_000 });
  });
});
