import { describe, expect, it } from 'vitest';
import { downloadsPageUrl } from './downloads-url';

describe('downloadsPageUrl', () => {
  it('menambahkan /desktop pada origin server yang sah', () => {
    expect(downloadsPageUrl('https://qc.rhd.my.id')).toBe('https://qc.rhd.my.id/desktop');
    expect(downloadsPageUrl('https://qc.rhd.my.id/')).toBe('https://qc.rhd.my.id/desktop');
    expect(downloadsPageUrl('http://localhost:8788')).toBe('http://localhost:8788/desktop');
  });
  it('alamat tak sah (bukan https, berisi jalur/kredensial, bukan teks) = null', () => {
    for (const bad of [
      'http://qc.example.test',
      'https://user:pw@qc.example.test',
      'https://qc.example.test/lain',
      'file:///C:/rahasia',
      'javascript:alert(1)',
      '',
      null,
      42,
    ]) {
      expect(downloadsPageUrl(bad)).toBeNull();
    }
  });
});
