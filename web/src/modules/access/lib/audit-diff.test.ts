import { expect, test } from 'vitest';
import { diffSnapshots } from './audit-diff';

const kinds = (diffs: ReturnType<typeof diffSnapshots>) =>
  diffs.map((field) => [field.key, field.kind]);

test('create: semua field berstatus ditambah, isi daftar ikut ditambah', () => {
  const diffs = diffSnapshots(null, { name: 'Ani', roleIds: ['r1', 'r2'] });
  expect(kinds(diffs)).toEqual([
    ['name', 'added'],
    ['roleIds', 'added'],
  ]);
  expect(diffs[1]?.children?.map((child) => [child.label, child.kind])).toEqual([
    ['r1', 'added'],
    ['r2', 'added'],
  ]);
});

test('delete: semua field berstatus dihapus', () => {
  const diffs = diffSnapshots({ name: 'Kosong', permissions: { item: 'view' } }, null);
  expect(kinds(diffs)).toEqual([
    ['name', 'removed'],
    ['permissions', 'removed'],
  ]);
  expect(diffs[1]?.children).toEqual([
    { label: 'item', kind: 'removed', before: 'view', after: undefined },
  ]);
});

test('update: field berubah dan tidak berubah dibedakan', () => {
  const diffs = diffSnapshots(
    { name: 'Budi', status: 'active' },
    { name: 'Budi S', status: 'active' },
  );
  expect(kinds(diffs)).toEqual([
    ['name', 'changed'],
    ['status', 'unchanged'],
  ]);
  expect(diffs[0]).toMatchObject({ before: 'Budi', after: 'Budi S' });
});

test('daftar: item ditambah, dihapus, dan tetap dibandingkan sebagai himpunan', () => {
  const [field] = diffSnapshots({ roleIds: ['a', 'b'] }, { roleIds: ['b', 'c'] });
  expect(field?.kind).toBe('changed');
  expect(field?.children?.map((child) => [child.label, child.kind])).toEqual([
    ['b', 'unchanged'],
    ['c', 'added'],
    ['a', 'removed'],
  ]);
  expect(kinds(diffSnapshots({ roleIds: ['a', 'b'] }, { roleIds: ['b', 'a'] }))).toEqual([
    ['roleIds', 'unchanged'],
  ]);
});

test('objek: level per modul dibandingkan per kunci', () => {
  const [field] = diffSnapshots(
    { permissions: { item: 'edit', stock: 'view' } },
    { permissions: { item: 'manage', access: 'view' } },
  );
  expect(field?.kind).toBe('changed');
  expect(field?.children).toEqual([
    { label: 'item', kind: 'changed', before: 'edit', after: 'manage' },
    { label: 'access', kind: 'added', before: undefined, after: 'view' },
    { label: 'stock', kind: 'removed', before: 'view', after: undefined },
  ]);
});

test('field yang hanya ada di satu sisi pada update ditandai ditambah atau dihapus', () => {
  expect(kinds(diffSnapshots({ a: 1 }, { b: 2 }))).toEqual([
    ['b', 'added'],
    ['a', 'removed'],
  ]);
});

test('tanpa perubahan: semua unchanged', () => {
  const snapshot = { name: 'A', roleIds: ['x'], permissions: { item: 'view' } };
  expect(
    diffSnapshots(snapshot, structuredClone(snapshot)).every((f) => f.kind === 'unchanged'),
  ).toBe(true);
});

test('kedua sisi kosong menghasilkan daftar kosong', () => {
  expect(diffSnapshots(null, null)).toEqual([]);
});
