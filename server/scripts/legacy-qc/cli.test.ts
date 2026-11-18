import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../migrate-legacy-qc';

describe('parseArgs', () => {
  test('BU item bawaan = brand saja (keputusan pemilik 2026-11-18); brand+serials harus dipilih eksplisit', () => {
    expect(parseArgs(['--dump', 'x.sql']).itemBu).toBe('brand');
    expect(parseArgs(['--dump', 'x.sql', '--item-bu', 'brand+serials']).itemBu).toBe(
      'brand+serials',
    );
    expect(() => parseArgs(['--dump', 'x.sql', '--item-bu', 'lain'])).toThrow('--item-bu');
  });

  test('dry-run bawaan; --apply tidak boleh bersama --offline dan --dump wajib', () => {
    expect(parseArgs(['--dump', 'x.sql']).apply).toBe(false);
    expect(() => parseArgs(['--dump', 'x.sql', '--apply', '--offline'])).toThrow('--offline');
    expect(() => parseArgs([])).toThrow('--dump');
  });
});
