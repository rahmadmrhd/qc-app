import { describe, expect, test } from 'vitest';
import { parseQcUrl } from './qc-url';

describe('parseQcUrl', () => {
  test('qc://country-lock → /country-lock', () => {
    expect(parseQcUrl('qc://country-lock')).toEqual({ route: '/country-lock' });
    expect(parseQcUrl('qc://country-lock/')).toEqual({ route: '/country-lock' });
  });

  test('skema atau host lain dan jalur tambahan ditolak', () => {
    for (const bad of [
      'https://country-lock',
      'app://qc/country-lock',
      'qc://lain',
      'qc://country-lock/../x',
      'qc://country-lock/sub',
      'qc://country-lock?x=1',
      'qc://country-lock#frag',
      'qc://user@country-lock',
      'qc://country-lock:99',
      'qc://country-lock.evil.com',
      'qc:country-lock',
      '',
      'bukan url',
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});
