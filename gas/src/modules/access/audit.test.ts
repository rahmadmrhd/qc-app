import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { captureAppError } from '@gas-test/errors';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { appendAudit_ } from './repo';
import { listAudit_ } from './service';
import { validateListAudit_ } from './validate';

let platform: MemoryPlatform;

function add(ts: string, action: string, target: string, before: unknown, after: unknown): void {
  appendAudit_({ ts, actor: 'admin@gmail.com', action, target, before, after });
}

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } });
  setPlatform_(platform);
});

test('validateListAudit_ memberi default halaman 1 dan filter kosong', () => {
  expect(validateListAudit_(null)).toEqual({ page: 1, action: '', query: '' });
  expect(validateListAudit_({})).toEqual({ page: 1, action: '', query: '' });
});

test('validateListAudit_ menerima filter dan menolak halaman tidak valid', () => {
  expect(validateListAudit_({ page: 3, action: 'user.update', query: ' budi ' })).toEqual({
    page: 3,
    action: 'user.update',
    query: 'budi',
  });
  for (const page of [0, -1, 1.5, '2', Number.NaN]) {
    expect(captureAppError(() => validateListAudit_({ page })).fields?.page).toBeDefined();
  }
});

test('listAudit_ mengurutkan terbaru dahulu dan mengurai snapshot', () => {
  add('2026-10-08T01:00:00.000Z', 'user.create', 'a@gmail.com', null, { name: 'A' });
  add('2026-10-08T03:00:00.000Z', 'user.update', 'a@gmail.com', { name: 'A' }, { name: 'B' });
  add('2026-10-08T02:00:00.000Z', 'role.delete', 'QC', { name: 'QC' }, null);
  const page = listAudit_({ page: 1, action: '', query: '' });
  expect(page.total).toBe(3);
  expect(page.entries.map((entry) => entry.action)).toEqual([
    'user.update',
    'role.delete',
    'user.create',
  ]);
  expect(page.entries[0]).toMatchObject({
    actor: 'admin@gmail.com',
    target: 'a@gmail.com',
    before: { name: 'A' },
    after: { name: 'B' },
  });
  expect(page.entries[1]?.after).toBeNull();
  expect(page.entries[2]?.before).toBeNull();
});

test('listAudit_ memfilter aksi (persis) dan kata kunci pada target atau pelaku', () => {
  add('2026-10-08T01:00:00.000Z', 'user.create', 'budi@gmail.com', null, { name: 'Budi' });
  add('2026-10-08T02:00:00.000Z', 'role.create', 'Gudang', null, { name: 'Gudang' });
  expect(listAudit_({ page: 1, action: 'role.create', query: '' }).total).toBe(1);
  expect(listAudit_({ page: 1, action: '', query: 'BUDI' }).entries[0]?.target).toBe(
    'budi@gmail.com',
  );
  expect(listAudit_({ page: 1, action: '', query: 'admin@' }).total).toBe(2);
  expect(listAudit_({ page: 1, action: 'user.create', query: 'gudang' }).total).toBe(0);
});

test('listAudit_ membagi halaman 50 baris dan melaporkan total', () => {
  for (let index = 0; index < 120; index++) {
    const ts = new Date(Date.UTC(2026, 9, 8, 0, 0, index)).toISOString();
    add(ts, 'user.update', `u${index}@gmail.com`, { name: 'a' }, { name: 'b' });
  }
  const second = listAudit_({ page: 2, action: '', query: '' });
  expect(second).toMatchObject({ total: 120, page: 2, pageSize: 50 });
  expect(second.entries).toHaveLength(50);
  expect(second.entries[0]?.target).toBe('u69@gmail.com');
  expect(listAudit_({ page: 3, action: '', query: '' }).entries).toHaveLength(20);
  expect(listAudit_({ page: 9, action: '', query: '' }).entries).toHaveLength(0);
});

test('listAudit_ tidak jatuh bila sel before/after rusak atau bukan objek', () => {
  const sheet = platform.db.insertSheet('audit_log');
  sheet.rows.push(
    ['ts', 'actor', 'action', 'target', 'before', 'after'],
    ['2026-10-08T01:00:00.000Z', 'x', 'user.update', 'a', '{rusak', '[1,2]'],
    ['2026-10-08T02:00:00.000Z', 'x', 'user.update', 'b', '', '"teks"'],
  );
  const page = listAudit_({ page: 1, action: '', query: '' });
  expect(page.total).toBe(2);
  expect(page.entries.map((entry) => [entry.before, entry.after])).toEqual([
    [null, null],
    [null, null],
  ]);
});

test('listAudit_ tidak membaca seluruh log: kolom ringan semua baris, before/after hanya untuk baris di halaman', () => {
  for (let i = 0; i < 120; i++) {
    const ts = `2026-10-08T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`;
    add(ts, 'user.update', `u${i}@gmail.com`, { name: 'lama' }, { name: `baru-${i}` });
  }
  const sheet = platform.db.sheet('audit_log');
  const before = sheet.calls;
  const page = listAudit_({ page: 1, action: '', query: '' });
  // hanya sekian panggilan: jumlah baris + kolom ringan + kolom before/after halaman (bukan satu pembacaan penuh)
  expect(sheet.calls - before).toBeLessThanOrEqual(3);
  expect(page.entries).toHaveLength(50);
  expect(page.entries[0]).toMatchObject({ target: 'u119@gmail.com', after: { name: 'baru-119' } });
});

test('listAudit_ dengan filter yang menyebar: tidak memuat rentang terjauh, hanya baris halaman (digabung bila berdekatan)', () => {
  // 300 baris; aksi "role.delete" hanya tiap baris ke-100 (sangat menyebar), sisanya user.update
  for (let i = 0; i < 300; i++) {
    const ts = `2026-10-08T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`;
    add(
      ts,
      i % 100 === 0 ? 'role.delete' : 'user.update',
      `t${i}`,
      { name: 'x' },
      { name: `y-${i}` },
    );
  }
  const sheet = platform.db.sheet('audit_log');
  const before = sheet.calls;
  const page = listAudit_({ page: 1, action: 'role.delete', query: '' });
  expect(page.total).toBe(3);
  expect(page.entries.map((entry) => entry.target).sort()).toEqual(['t0', 't100', 't200']);
  expect(page.entries.every((entry) => entry.after !== null)).toBe(true);
  // header + kolom ringan + 3 baca terpisah (tiap baris berjauhan > 25) = 5, bukan satu pembacaan 200 baris
  expect(sheet.calls - before).toBe(5);
});
