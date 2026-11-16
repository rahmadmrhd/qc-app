// Parser keluaran perintah info perangkat (satu implementasi; aplikasi lama punya empat salinan).
// Aturan mengikuti inventaris perilaku lama §2.2. Murni: tanpa I/O.

import { UBNT_COUNTRIES } from './ubnt-countries';

export interface DeviceInfo {
  model: string;
  serial: string;
  country: string;
}

/**
 * `Getbetween` lama: teks setelah `start` sampai kemunculan pertama `end` (di-trim). Tanpa `end` =
 * sisa teks; tanpa `start` = string kosong.
 */
export function getBetween(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const rest = text.slice(from + start.length);
  const to = rest.indexOf(end);
  return (to < 0 ? rest : rest.slice(0, to)).trim();
}

/** `MyTrim` lama: trim lalu kerutkan spasi berurutan menjadi satu. */
function collapseSpaces(text: string): string {
  return text.trim().replace(/ {2,}/g, ' ');
}

function stripTabsAndNewlines(text: string): string {
  return text.replace(/[\t\n\r]/g, '');
}

/** Keluaran `/system routerboard print`. Serial huruf besar; model dipotong di spasi pertama. */
export function parseMikrotikRouterboard(out: string): { serial: string; model: string } {
  const flat = collapseSpaces(out.replace(/[\t\n\r]/g, ' '));
  return {
    serial: getBetween(flat, 'serial-number: ', ' ').toUpperCase(),
    model: getBetween(flat, 'model: ', ' '),
  };
}

/** Keluaran `:put [/interface wireless get wlan1]`. Kosong bila perangkat tak punya wlan1. */
export function parseMikrotikCountry(out: string): string {
  return getBetween(stripTabsAndNewlines(out).replace(/ /g, ''), 'country=', ';');
}

/** Keluaran `cat /proc/ubnthal/board.info`. Model: `board.model`, bila tak ada `board.name`. */
export function parseUbiquitiBoardInfo(out: string): { serial: string; model: string } {
  const serial = stripTabsAndNewlines(getBetween(out, 'board.hwaddr=', '\n').toUpperCase());
  const rawModel = out.includes('board.model=')
    ? getBetween(out, 'board.model=', '\n')
    : getBetween(out, 'board.name=', '\n');
  return { serial, model: stripTabsAndNewlines(rawModel.replace(/-/g, ' ')) };
}

/**
 * Keluaran `cat /tmp/system.cfg | grep countrycode`. Kode dicari di `UBNT_COUNTRIES`; kode di luar
 * peta = "Unknown"; teks kosong/bukan angka = string kosong (di aplikasi lama `Convert.ToInt32`
 * melempar dan ditelan, sehingga negara kosong, bukan "Unknown").
 */
export function parseUbiquitiCountry(out: string): string {
  const text = getBetween(out, 'countrycode=', '\n');
  if (!/^[+-]?\d+$/.test(text)) return '';
  const code = Number(text);
  if (!Number.isInteger(code) || code < -2147483648 || code > 2147483647) return '';
  return UBNT_COUNTRIES[code] ?? 'Unknown';
}

/** Keluaran `cat /proc/ubnthal/board.info | grep board.hwaddr` (serial cepat milik pinger). */
export function parseUbiquitiSerialLine(out: string): string {
  // Huruf besar agar sama dengan serial dari info penuh (aplikasi lama menormalkan belakangan).
  return stripTabsAndNewlines(out.split('board.hwaddr=').join('')).trim().toUpperCase();
}

/** Galat kredensial: pesan memuat "Permission denied" atau "username" (tak peka huruf). */
export function isPermissionDenied(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('permission denied') || lower.includes('username');
}
