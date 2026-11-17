import { describe, expect, test } from 'bun:test';
import {
  FIRMWARE_BY_BRAND,
  firmwareBrandOf,
  firmwareOptionsFor,
  isValidFirmware,
} from './firmware';

describe('firmwareBrandOf', () => {
  test('mengenali Mikrotik/Ubiquiti tanpa peduli huruf besar/kecil dan spasi', () => {
    expect(firmwareBrandOf('Mikrotik')).toBe('mikrotik');
    expect(firmwareBrandOf('  UBIQUITI ')).toBe('ubiquiti');
    expect(firmwareBrandOf('Cambium')).toBeNull();
    expect(firmwareBrandOf('')).toBeNull();
  });
});

describe('isValidFirmware', () => {
  test('kosong selalu sah; kode harus ada di daftar merk itu', () => {
    expect(isValidFirmware('Ubiquiti', '')).toBe(true);
    expect(isValidFirmware('Ubiquiti', 'af5xhd')).toBe(true);
    expect(isValidFirmware('Ubiquiti', 'AC')).toBe(false); // kode Mikrotik
    expect(isValidFirmware('Mikrotik', 'AC')).toBe(true);
    expect(isValidFirmware('Mikrotik', 'ac')).toBe(false); // kode peka huruf besar/kecil
    expect(isValidFirmware('Cambium', 'AC')).toBe(false); // merk tanpa firmware Country Lock
    expect(isValidFirmware('Cambium', '')).toBe(true);
  });
  test('kode unik per merk', () => {
    for (const options of Object.values(FIRMWARE_BY_BRAND)) {
      expect(new Set(options.map((option) => option.code)).size).toBe(options.length);
    }
    expect(firmwareOptionsFor('Cambium')).toEqual([]);
  });
});
