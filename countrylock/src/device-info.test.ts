import { describe, expect, test } from 'bun:test';
import {
  getBetween,
  isPermissionDenied,
  parseMikrotikCountry,
  parseMikrotikRouterboard,
  parseUbiquitiBoardInfo,
  parseUbiquitiCountry,
  parseUbiquitiSerialLine,
} from './device-info';
import { UBNT_COUNTRIES } from './ubnt-countries';

describe('getBetween', () => {
  test('teks setelah awalan sampai akhir pertama, di-trim; tanpa akhir = sisa; tanpa awalan = kosong', () => {
    expect(getBetween('a=  x y ;b=z;', 'a=', ';')).toBe('x y');
    expect(getBetween('a= sisa teks ', 'a=', ';')).toBe('sisa teks');
    expect(getBetween('b=1', 'a=', ';')).toBe('');
  });
});

describe('Mikrotik', () => {
  test('mikrotik: serial huruf besar dan model dipotong di spasi pertama', () => {
    const out = 'serial-number: abc123 \n model: hAP ac2';
    expect(parseMikrotikRouterboard(out)).toEqual({ serial: 'ABC123', model: 'hAP' });
  });

  test('mikrotik: keluaran asli dengan tab, CRLF, dan spasi ganda', () => {
    const out =
      '       routerboard: yes\r\n            model: RB951G-2HnD\r\n    serial-number:\tabcd1234\r\n   firmware-type: ar9330\r\n';
    expect(parseMikrotikRouterboard(out)).toEqual({ serial: 'ABCD1234', model: 'RB951G-2HnD' });
  });

  test('mikrotik: tanpa kolom serial/model menghasilkan string kosong', () => {
    expect(parseMikrotikRouterboard('bukan keluaran routerboard')).toEqual({
      serial: '',
      model: '',
    });
    expect(parseMikrotikRouterboard('')).toEqual({ serial: '', model: '' });
  });

  test('mikrotik: country= diambil sampai ";" setelah spasi dibuang', () => {
    expect(parseMikrotikCountry('name="wlan1" country=indonesia; band=2ghz')).toBe('indonesia');
    expect(parseMikrotikCountry('mode=ap-bridge; country = no_country_set ;\r\nssid=x')).toBe(
      'no_country_set',
    );
    // Spasi di dalam nilai ikut dibuang (perilaku lama).
    expect(parseMikrotikCountry('country=united states;')).toBe('unitedstates');
    // Perangkat tanpa wlan1.
    expect(parseMikrotikCountry('no such item (4)')).toBe('');
    expect(parseMikrotikCountry('')).toBe('');
  });
});

describe('Ubiquiti', () => {
  test('ubiquiti: board.hwaddr huruf besar, model dari board.name bila board.model tak ada, "-" menjadi spasi', () => {
    const withName = 'board.sysid=0xe7f0\nboard.hwaddr=e1d80fb1b4de\nboard.name=Nano-Station-M5\n';
    expect(parseUbiquitiBoardInfo(withName)).toEqual({
      serial: 'E1D80FB1B4DE',
      model: 'Nano Station M5',
    });
    // board.model lebih diutamakan daripada board.name.
    const withModel =
      'board.hwaddr=b8d00ae7f099\r\nboard.name=Ignored-Name\r\nboard.model=Wave-AP\r\n';
    expect(parseUbiquitiBoardInfo(withModel)).toEqual({
      serial: 'B8D00AE7F099',
      model: 'Wave AP',
    });
    expect(parseUbiquitiBoardInfo('tidak ada apa-apa')).toEqual({ serial: '', model: '' });
  });

  test('ubiquiti: countrycode=360 → Indonesia, kode asing → Unknown, teks bukan angka → string kosong tanpa melempar', () => {
    expect(parseUbiquitiCountry('radio.1.countrycode=360\n')).toBe('Indonesia');
    expect(parseUbiquitiCountry('radio.countrycode=360\r\n')).toBe('Indonesia');
    expect(parseUbiquitiCountry('countrycode=511')).toBe('Compliance Test');
    expect(parseUbiquitiCountry('countrycode=99999\n')).toBe('Unknown');
    expect(parseUbiquitiCountry('countrycode=0\n')).toBe('Unknown');
    expect(parseUbiquitiCountry('countrycode=abc\n')).toBe('');
    expect(parseUbiquitiCountry('countrycode=\n')).toBe('');
    expect(parseUbiquitiCountry('countrycode=36 0\n')).toBe('');
    expect(parseUbiquitiCountry('')).toBe('');
  });

  test('ubiquiti: serial dari keluaran grep board.hwaddr', () => {
    expect(parseUbiquitiSerialLine('board.hwaddr=e1d80fb1b4de\r\n')).toBe('E1D80FB1B4DE');
    expect(parseUbiquitiSerialLine('')).toBe('');
  });

  test('UBNT_COUNTRIES memuat 360 Indonesia dan 511 Compliance Test', () => {
    expect(UBNT_COUNTRIES[360]).toBe('Indonesia');
    expect(UBNT_COUNTRIES[511]).toBe('Compliance Test');
    expect(UBNT_COUNTRIES[840]).toBe('United States');
    expect(UBNT_COUNTRIES[704]).toBe('Viet Nam');
    expect(UBNT_COUNTRIES[630]).toBe('Puerto Rico (U.S. territory)');
    expect(Object.keys(UBNT_COUNTRIES).length).toBe(112);
  });
});

describe('isPermissionDenied', () => {
  test('isPermissionDenied: "Permission denied" atau "username" tak peka huruf', () => {
    expect(isPermissionDenied('Permission denied (password).')).toBe(true);
    expect(isPermissionDenied('PERMISSION DENIED')).toBe(true);
    expect(isPermissionDenied('Invalid Username or password')).toBe(true);
    expect(isPermissionDenied('Connection timed out')).toBe(false);
    expect(isPermissionDenied('')).toBe(false);
  });
});
