import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FILTER_LIST_MAX } from './filter-limits';

test('FILTER_LIST_MAX sama dengan batas filter jamak di server', () => {
  const source = readFileSync(join(__dirname, '../../../server/src/core/validate.ts'), 'utf8');
  const match = /export const FILTER_LIST_MAX = (\d+);/.exec(source);
  expect(match?.[1]).toBe(String(FILTER_LIST_MAX));
});

test('semua skema search param jamak memakai konstanta, bukan angka literal', () => {
  const files = [
    'modules/dashboard/lib/search.ts',
    'modules/handover/lib/search.ts',
    'modules/item/lib/list-filter.ts',
    'modules/serial/lib/case-filter.ts',
    'modules/serial/lib/list-filter.ts',
    'routes/_app/access/audit.tsx',
    'routes/_app/sticker/index.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source, file).not.toMatch(/\.max\(20\)/);
    expect(source, file).toContain('.max(FILTER_LIST_MAX)');
  }
});

test('setiap field pilihan jamak pada filter daftar membatasi pilihan di UI (maxSelected)', () => {
  const files: [string, number][] = [
    ['modules/dashboard/components/global-filters.tsx', 2],
    ['modules/dashboard/components/group-section.tsx', 1],
    ['modules/dashboard/components/relation-field.tsx', 1],
    ['modules/dashboard/components/scope-editor.tsx', 3],
    ['modules/dashboard-public/public-filters.tsx', 4],
    ['modules/handover/components/handover-board-page.tsx', 1],
    ['modules/item/components/item-filters.tsx', 2],
    ['modules/serial/components/case-list-page.tsx', 1],
    ['modules/serial/components/serial-filters.tsx', 5],
    ['routes/_app/access/audit.tsx', 1],
    ['modules/sticker/components/stickers-page.tsx', 1],
  ];
  for (const [file, expected] of files) {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source.split('maxSelected={FILTER_LIST_MAX}').length - 1, file).toBe(expected);
  }
});
