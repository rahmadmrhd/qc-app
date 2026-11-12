import { describe, expect, test } from 'vitest';
import { StreamMasker } from './stream-mask';

/** Mendorong potongan berurutan dan mengumpulkan semua baris yang dipancarkan (termasuk flush). */
function run(secrets: string[], chunks: string[]): string[] {
  const masker = new StreamMasker(secrets);
  const lines: string[] = [];
  for (const chunk of chunks) lines.push(...masker.push(chunk));
  lines.push(...masker.flush());
  return lines;
}

describe('StreamMasker', () => {
  test('rahasia terbelah di batas potongan ke-2 dan ke-3 tetap tersamarkan (N1)', () => {
    expect(run(['Sup3rSecret'], ['cmd pass=Sup3', 'rSecret rest\r\n'])).toEqual([
      'cmd pass=**** rest',
    ]);
    expect(run(['Sup3rSecret'], ['x Sup', '3rSe', 'cret y\r\n'])).toEqual(['x **** y']);
  });

  test('tidak ada baris yang dipancarkan selagi ekornya masih awalan rahasia', () => {
    const masker = new StreamMasker(['Sup3rSecret']);
    // Baris lengkap yang berakhir pada awalan rahasia ditahan, bukan dipancarkan mentah.
    expect(masker.push('cmd Sup3r\r\n')).toEqual([]);
    expect(masker.push('Secret end\r\n')).toEqual(['cmd **** end']);
  });

  test('terbelah tepat pada \\r\\n (di antara dua potongan) tetap tersamarkan', () => {
    expect(run(['Sup3rSecret'], ['cmd Sup3r\r', '\nSecret end\r\n'])).toEqual(['cmd **** end']);
    expect(run(['Sup3rSecret'], ['cmd Sup3r\r\n', 'Secret end\r\n'])).toEqual(['cmd **** end']);
    expect(run(['Sup3rSecret'], ['cmd Sup3rS\n', 'ecret end\n'])).toEqual(['cmd **** end']);
  });

  test('awalan palsu dilepas begitu potongan berikutnya membuktikan bukan rahasia', () => {
    const masker = new StreamMasker(['Sup3rSecret']);
    expect(masker.push('abc Sup3\r\n')).toEqual([]);
    expect(masker.push('zzz\r\n')).toEqual(['abc Sup3', 'zzz']);
  });

  test('flush memancarkan baris lengkap yang masih ditahan; sisa parsial dibuang', () => {
    const masker = new StreamMasker(['Sup3rSecret']);
    expect(masker.push('abc Sup3\r\npartial')).toEqual([]);
    expect(masker.flush()).toEqual(['abc Sup3']);
  });

  test('rahasia berisi * tidak membuat buffer tumbuh eksponensial (N2)', () => {
    const masker = new StreamMasker(['*']);
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) lines.push(...masker.push('x*'));
    lines.push(...masker.push('\r\n'));
    const line = lines.find((l) => l.length > 0) ?? '';
    // 200 x ('x' + '****') = 1000 karakter: linear, bukan 4^200.
    expect(line.length).toBe(1000);
    expect(line.startsWith('x****x****')).toBe(true);
  });

  test('token penanda tidak dirusak oleh sandi pendek (N3)', () => {
    const lines = run(
      ['a', '1', 'AB12'],
      ['echo __QC_INJECT_ab12cd34__\r\n', '__QC_INJECT_ab12cd34__\r\nhello a1 AB12\r\n'],
    );
    expect(lines).toEqual([
      'echo __QC_INJECT_ab12cd34__',
      '__QC_INJECT_ab12cd34__',
      'hello ******** ****',
    ]);
  });

  test('tanpa rahasia: hanya memecah baris', () => {
    expect(run([], ['a\r\nb', 'c\r\n'])).toEqual(['a', 'bc']);
    expect(run([''], ['kosong\r\n'])).toEqual(['kosong']);
  });

  test('bentuk terescape lebih panjang didahulukan', () => {
    expect(run(['a"b', 'a\\"b'], ['x a\\"b y a"b\r\n'])).toEqual(['x **** y ****']);
  });
});
