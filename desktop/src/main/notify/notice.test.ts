import { describe, expect, test } from 'vitest';
import { parseStreamNotice, safeAppPath } from './notice';

const GOOD = {
  id: 'n1',
  title: 'Qi mengomentari task ST-1',
  body: 'ST-1 - PT Maju\nisi',
  url: '/handover/h1',
  tag: 'h1',
  createdAt: '2026-11-16T03:00:00.000Z',
};

describe('safeAppPath', () => {
  test('hanya jalur dalam aplikasi', () => {
    expect(safeAppPath('/handover/h1?x=1')).toBe('/handover/h1?x=1');
    for (const bad of [
      '',
      'handover',
      '//evil.com',
      'https://evil.com',
      '/a\\b',
      '/a\nb',
      '/a\u0000b',
      `/${'x'.repeat(400)}`,
      null,
      42,
    ]) {
      expect(safeAppPath(bad), String(bad)).toBeNull();
    }
  });
});

describe('parseStreamNotice', () => {
  test('bentuk sah diterima', () => {
    expect(parseStreamNotice(JSON.stringify(GOOD))).toEqual(GOOD);
  });

  test('bentuk salah ditolak: bukan JSON, field kurang, tautan asing, judul kosong', () => {
    expect(parseStreamNotice('bukan json')).toBeNull();
    expect(parseStreamNotice('null')).toBeNull();
    expect(parseStreamNotice('[]')).toBeNull();
    for (const key of Object.keys(GOOD)) {
      const copy: Record<string, unknown> = { ...GOOD };
      delete copy[key];
      expect(parseStreamNotice(JSON.stringify(copy)), key).toBeNull();
    }
    expect(parseStreamNotice(JSON.stringify({ ...GOOD, url: 'https://evil.com' }))).toBeNull();
    expect(parseStreamNotice(JSON.stringify({ ...GOOD, title: '' }))).toBeNull();
    expect(parseStreamNotice(JSON.stringify({ ...GOOD, id: 5 }))).toBeNull();
  });

  test('teks panjang dipotong dan karakter kontrol dibuang', () => {
    const parsed = parseStreamNotice(
      JSON.stringify({ ...GOOD, body: `a\u0007${'b'.repeat(900)}`, title: 'T\u0000itle' }),
    );
    expect(parsed?.title).toBe('Title');
    expect(parsed?.body.length).toBeLessThanOrEqual(500);
    expect(parsed?.body.startsWith('ab')).toBe(true);
    expect(parsed?.body.endsWith('…')).toBe(true);
  });
});
