import { describe, expect, test } from 'bun:test';
import { readEnvValue, tunnelTarget } from './dev';

describe('readEnvValue', () => {
  test('membaca kunci, mengabaikan komentar dan baris kosong, melepas kutip', () => {
    const text = '# komentar\n\nA=1\n B = dua \nC="tiga"\nD=\'empat\'\nE=x=y\n';
    expect(readEnvValue(text, 'A')).toBe('1');
    expect(readEnvValue(text, 'B')).toBe('dua');
    expect(readEnvValue(text, 'C')).toBe('tiga');
    expect(readEnvValue(text, 'D')).toBe('empat');
    expect(readEnvValue(text, 'E')).toBe('x=y');
    expect(readEnvValue(text, 'TIDAK_ADA')).toBeUndefined();
    expect(readEnvValue('# DATABASE_URL=bukan\n', 'DATABASE_URL')).toBeUndefined();
  });
});

describe('tunnelTarget', () => {
  test('URL loopback butuh terowongan; host lain tidak', () => {
    expect(tunnelTarget('mysql://u:p@127.0.0.1:33063/qc_dev')).toEqual({
      host: '127.0.0.1',
      port: 33063,
    });
    expect(tunnelTarget('mysql://u:p@localhost/qc_dev')).toEqual({ host: 'localhost', port: 3306 });
    expect(tunnelTarget('mysql://u:p@db.internal:3306/qc')).toBeNull();
    expect(tunnelTarget('bukan url')).toBeNull();
  });
});
