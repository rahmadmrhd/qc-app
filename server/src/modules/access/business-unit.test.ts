import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  listBusinessUnitDtos,
  listBusinessUnitOptions,
  saveBusinessUnit,
  setBusinessUnitStatus,
} from './business-unit-service';
import type { UserContext } from './context';
import { loadUserContext } from './context';

let env: TestEnv;
let admin: UserContext;

async function auditRows() {
  const rows = await env.DB.prepare(
    'SELECT action, target, `before`, `after` FROM audit_log ORDER BY id',
  ).all<{ action: string; target: string; before: string; after: string }>();
  return rows.results.map((row) => ({
    action: row.action,
    target: row.target,
    before: JSON.parse(row.before) as unknown,
    after: JSON.parse(row.after) as unknown,
  }));
}

async function lastAudit() {
  const row = (await auditRows()).at(-1);
  if (!row) throw new Error('audit_log kosong');
  return row;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-08T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('konteks admin tidak ada');
  admin = ctx;
});

describe('master BU', () => {
  test('membuat BU: aktif, hitungan 0, tercatat pelakunya, audit before kosong', async () => {
    const created = await saveBusinessUnit(env, { code: 'ENT', name: 'Enterprise' }, admin);
    expect(created).toMatchObject({
      code: 'ENT',
      name: 'Enterprise',
      status: 'active',
      itemCount: 0,
      userCount: 0,
      updatedBy: 'admin@gmail.com',
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    });
    expect(await lastAudit()).toMatchObject({
      action: 'businessunit.create',
      target: 'ENT',
      before: null,
      after: { code: 'ENT', name: 'Enterprise', status: 'active' },
    });
  });

  test('kode ganda dan nama ganda (beda huruf besar) CONFLICT dengan field', async () => {
    await seedBusinessUnit(env, { id: 'bu-1', code: 'UM', name: 'Umum' });
    expect(
      await captureAppErrorAsync(() => saveBusinessUnit(env, { code: 'UM', name: 'Lain' }, admin)),
    ).toMatchObject({ code: 'CONFLICT', fields: { code: 'Kode BU sudah dipakai' } });
    expect(
      await captureAppErrorAsync(() => saveBusinessUnit(env, { code: 'XX', name: 'UMUM' }, admin)),
    ).toMatchObject({ code: 'CONFLICT', fields: { name: 'Nama BU sudah dipakai' } });
  });

  test('mengubah nama menyimpan snapshot; kode tidak dapat diubah; id tak dikenal NOT_FOUND', async () => {
    await seedBusinessUnit(env, { id: 'bu-1', code: 'UM', name: 'Umum' });
    const updated = await saveBusinessUnit(
      env,
      { id: 'bu-1', code: 'UM', name: 'Umum Baru' },
      admin,
    );
    expect(updated.name).toBe('Umum Baru');
    expect(await lastAudit()).toMatchObject({
      action: 'businessunit.update',
      target: 'UM',
      before: { code: 'UM', name: 'Umum', status: 'active' },
      after: { code: 'UM', name: 'Umum Baru', status: 'active' },
    });
    expect(
      await captureAppErrorAsync(() =>
        saveBusinessUnit(env, { id: 'bu-1', code: 'XX', name: 'Umum' }, admin),
      ),
    ).toMatchObject({ code: 'VALIDATION', fields: { code: 'Kode tidak dapat diubah' } });
    expect(
      (
        await captureAppErrorAsync(() =>
          saveBusinessUnit(env, { id: 'tidak-ada', code: 'ZZ', name: 'Z' }, admin),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('nonaktif lalu aktif mengubah status dan menulis audit; status sama tidak mencatat apa pun', async () => {
    await seedBusinessUnit(env, { id: 'bu-1', code: 'UM', name: 'Umum' });
    expect(
      (await setBusinessUnitStatus(env, { id: 'bu-1', status: 'inactive' }, admin)).status,
    ).toBe('inactive');
    expect(await lastAudit()).toMatchObject({
      action: 'businessunit.deactivate',
      target: 'UM',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
    const count = (await auditRows()).length;
    await setBusinessUnitStatus(env, { id: 'bu-1', status: 'inactive' }, admin);
    expect(await auditRows()).toHaveLength(count);
    expect((await setBusinessUnitStatus(env, { id: 'bu-1', status: 'active' }, admin)).status).toBe(
      'active',
    );
    expect((await lastAudit()).action).toBe('businessunit.activate');
    expect(
      (
        await captureAppErrorAsync(() =>
          setBusinessUnitStatus(env, { id: 'tidak-ada', status: 'active' }, admin),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('daftar terurut menurut kode; itemCount menghitung baris penghubung; userCount menghitung Semua BU dan penugasan eksplisit', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA', name: 'A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'BBB', name: 'B' });
    await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'X1', businessUnitIds: ['bu-a'] });
    await seedItem(env, {
      id: 'i2',
      brand: 'Sony',
      model: 'X2',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    await seedUser(env, {
      id: 'u-all',
      email: 'all@gmail.com',
      buAssignments: [{ buId: null, roleIds: ['r-item'] }],
    });
    await seedUser(env, {
      id: 'u-a',
      email: 'a@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-item'] }],
    });
    await seedUser(env, { id: 'u-none', email: 'none@gmail.com' });
    const list = await listBusinessUnitDtos(env);
    expect(list.map((bu) => bu.code)).toEqual(['AAA', 'BBB']);
    expect(list[0]).toMatchObject({ itemCount: 2, userCount: 2 });
    expect(list[1]).toMatchObject({ itemCount: 1, userCount: 1 });
  });

  test('menonaktifkan BU yang masih dipakai TIDAK ditolak', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA', name: 'A' });
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'X1', businessUnitIds: ['bu-a'] });
    const result = await setBusinessUnitStatus(env, { id: 'bu-a', status: 'inactive' }, admin);
    expect(result).toMatchObject({ status: 'inactive', itemCount: 1 });
  });

  test('options memuat semua BU (aktif dan nonaktif) ringkas, terurut menurut kode', async () => {
    await seedBusinessUnit(env, { id: 'bu-b', code: 'BBB', name: 'B', status: 'inactive' });
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA', name: 'A' });
    expect(await listBusinessUnitOptions(env)).toEqual([
      { id: 'bu-a', code: 'AAA', name: 'A', status: 'active' },
      { id: 'bu-b', code: 'BBB', name: 'B', status: 'inactive' },
    ]);
  });

  test('kode yang sama dengan kode lokasi tidak bentrok (tabel berbeda)', async () => {
    await seedLocation(env, { id: 'l-1', code: 'UM' });
    expect((await saveBusinessUnit(env, { code: 'UM', name: 'Umum' }, admin)).code).toBe('UM');
  });
});
