import type { PackageDto } from '@countrylock/bridge-contract';
import { describe, expect, test } from 'vitest';
import { resolveTypeApplication } from './type-firmware';

const pkg = {
  config: {
    brands: {
      ubiquiti: {
        firmware: [
          { code: 'af5xhd', label: 'AF-5XHD', file: 'af5xhd.txt' },
          { code: 'WA', label: '', file: 'WA.txt' },
        ],
      },
    },
  },
} as unknown as PackageDto;

describe('resolveTypeApplication', () => {
  test('merk dan firmware ada di paket: dapat dipakai (label jatuh ke kode bila kosong)', () => {
    expect(resolveTypeApplication({ brand: 'Ubiquiti', firmware: 'af5xhd' }, pkg)).toEqual({
      ok: true,
      brand: 'ubiquiti',
      firmwareCode: 'af5xhd',
      firmwareLabel: 'AF-5XHD',
    });
    expect(resolveTypeApplication({ brand: ' UBIQUITI ', firmware: 'WA' }, pkg)).toMatchObject({
      ok: true,
      firmwareLabel: 'WA',
    });
  });
  test('tanpa paket, merk di luar paket, firmware kosong/tak ada/server lama: tak dapat dipakai dengan alasan', () => {
    expect(resolveTypeApplication({ brand: 'Ubiquiti', firmware: 'WA' }, null)).toEqual({
      ok: false,
      message: 'Pilih folder paket skrip dulu.',
    });
    for (const input of [
      { brand: 'Mikrotik', firmware: 'AC' }, // ada di daftar tetap tetapi tidak di paket ini
      { brand: 'Cambium', firmware: 'AC' },
    ]) {
      const result = resolveTypeApplication(input, pkg);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).toContain('tidak ada di paket skrip');
    }
    for (const firmware of ['', undefined]) {
      const result = resolveTypeApplication({ brand: 'Ubiquiti', firmware }, pkg);
      expect(result.ok ? '' : result.message).toContain('belum diisi');
    }
    const missing = resolveTypeApplication({ brand: 'Ubiquiti', firmware: 'XW' }, pkg);
    expect(missing.ok ? '' : missing.message).toBe('Firmware "XW" tidak ada di paket skrip.');
  });
});
