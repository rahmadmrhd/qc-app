import { describe, expect, test } from 'bun:test';
import { isValidHost } from './host';

describe('isValidHost', () => {
  test('IPv4 sah dan nama host sah diterima', () => {
    for (const ok of [
      '192.168.88.1',
      '0.0.0.0',
      '255.255.255.255',
      'router',
      'qc-router.lan',
      'a1.b2.example.com',
    ]) {
      expect(isValidHost(ok)).toBe(true);
    }
  });

  test('string kosong, spasi, titik koma, opsi, dan IPv4 di luar rentang ditolak', () => {
    for (const bad of [
      '',
      ' ',
      'a;b',
      '1.2.3.4 & calc',
      '-n 100 1.2.3.4',
      '-evil',
      '256.1.1.1',
      '1.2.3',
      '999.1.1.1',
      'a..b',
      'a_b',
      '.a',
      'a.',
      'x'.repeat(254),
      'a\nb',
    ]) {
      expect(isValidHost(bad)).toBe(false);
    }
  });
});
