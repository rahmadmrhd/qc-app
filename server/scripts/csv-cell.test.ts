import { describe, expect, test } from 'bun:test';
import { csvCell } from './csv-cell';

describe('csvCell', () => {
  test('teks biasa apa adanya; koma, kutip, dan baris baru dikutip', () => {
    expect(csvCell('AB12')).toBe('AB12');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  test('awalan rumus (= + - @ tab CR) dinetralkan dengan kutip tunggal', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\t=x')).toBe("'\t=x");
    // awalan rumus yang juga memuat koma: dinetralkan lalu dikutip
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
    expect(csvCell('\r=x')).toBe('"\'\r=x"');
  });

  test('tanda minus/plus di tengah dan angka biasa tidak diubah', () => {
    expect(csvCell('AB-12')).toBe('AB-12');
    expect(csvCell('1+1')).toBe('1+1');
  });
});
