// Daftar tetap kode firmware Country Lock per merk (spek desktop §6.6, keputusan pemilik 2026-11-18: field `firmware`
// pada Data Item berupa PILIHAN dari daftar tetap, bukan teks bebas). Kodenya sama dengan kunci `firmware` di
// `config.QC` tiap merk (nama berkas skrip dicari desktop dari kode itu); label hanya untuk tampilan. Murni: dipakai
// server (validasi), web (pilihan form), dan desktop (pencocokan Tipe -> firmware). Menambah firmware baru di
// `config.QC` berarti menambahnya di sini (tes `countrylock/src/firmware-parity.test.ts` menjaga daftar ini sama dengan
// `config.QC` contoh).

import { normalizeKey } from './items';

export type FirmwareBrand = 'mikrotik' | 'ubiquiti';

export interface FirmwareOption {
  code: string;
  label: string;
}

export const FIRMWARE_BY_BRAND: Readonly<Record<FirmwareBrand, readonly FirmwareOption[]>> = {
  mikrotik: [
    { code: 'AC', label: 'AC' },
    { code: '5Ghz', label: '5GHz' },
    { code: '2Ghz', label: '2GHz' },
    { code: 'AC2', label: 'AC2' },
    { code: 'ARM', label: 'ARM' },
    { code: 'Mantbox 19s', label: 'Mantbox 19s' },
    { code: 'AX', label: 'AX' },
    { code: 'AX2', label: 'AX2' },
  ],
  ubiquiti: [
    { code: 'WA', label: 'WA Firmware' },
    { code: '2WA', label: '2WA Firmware' },
    { code: 'LAP120', label: 'LAP120 Firmware' },
    { code: 'XC', label: 'XC Firmware' },
    { code: '2XC', label: '2XC Firmware' },
    { code: 'M', label: 'airMAX M' },
    { code: 'af5xhd', label: 'AF-5XHD' },
    { code: 'XW', label: 'XW Firmware' },
    { code: 'XM', label: 'XM Firmware' },
  ],
};

/** Panjang kode terpanjang di daftar (batas kasar untuk validator bentuk). */
export const FIRMWARE_CODE_MAX = 40;

/** Merk Country Lock dari nama merk di Data Item (tak peka huruf besar/kecil dan spasi); `null` bila bukan Mikrotik/Ubiquiti. */
export function firmwareBrandOf(brandName: string): FirmwareBrand | null {
  const key = normalizeKey(brandName);
  return key === 'mikrotik' || key === 'ubiquiti' ? key : null;
}

/** Opsi firmware untuk sebuah nama merk (kosong bila merk tak punya firmware Country Lock). */
export function firmwareOptionsFor(brandName: string): readonly FirmwareOption[] {
  const brand = firmwareBrandOf(brandName);
  return brand ? FIRMWARE_BY_BRAND[brand] : [];
}

/** Kode firmware sah untuk merk itu? Kosong ('') selalu sah (belum diisi). */
export function isValidFirmware(brandName: string, code: string): boolean {
  if (code === '') return true;
  return firmwareOptionsFor(brandName).some((option) => option.code === code);
}
