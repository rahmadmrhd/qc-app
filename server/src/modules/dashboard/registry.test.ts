import { describe, expect, test } from 'bun:test';
import { WIDGET_IDS } from '@shared/dashboard';
import { WIDGET_IMPLS } from './registry';
import { ALL_WIDGETS } from './widgets';

describe('paritas registry shared dan implementasi server', () => {
  test('kunci WIDGET_IMPLS sama persis dengan WIDGET_IDS', () => {
    const implemented = new Set<string>(WIDGET_IMPLS.keys());
    const declared = new Set<string>(WIDGET_IDS);
    const missingImpl = WIDGET_IDS.filter((id) => !implemented.has(id));
    const missingMeta = [...implemented].filter((id) => !declared.has(id));
    expect(missingImpl).toEqual([]);
    expect(missingMeta).toEqual([]);
    expect(implemented.size).toBe(WIDGET_IDS.length);
  });

  test('ALL_WIDGETS tanpa id ganda dan sama dengan WIDGET_IDS', () => {
    const ids = ALL_WIDGETS.map((impl) => impl.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...WIDGET_IDS].sort());
  });
});
