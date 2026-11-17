import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIRMWARE_BY_BRAND } from '../../shared/firmware';

// Daftar tetap firmware di `shared/firmware.ts` (pilihan di Data Item) harus sama dengan kunci `firmware` pada
// `config.QC` contoh (sumber kode yang dipakai desktop untuk memilih skrip).
describe('daftar firmware tetap = config.QC contoh', () => {
  const config = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'fixtures', 'country-lock2', 'config.QC'), 'utf8'),
  ) as Record<string, { firmware?: Record<string, { label?: string }> }>;

  for (const brand of ['mikrotik', 'ubiquiti'] as const) {
    test(`${brand}: kode dan label sama`, () => {
      const fromConfig = Object.entries(config[brand]?.firmware ?? {}).map(([code, value]) => ({
        code,
        label: value.label || code,
      }));
      expect(FIRMWARE_BY_BRAND[brand]).toEqual(fromConfig);
    });
  }
});
