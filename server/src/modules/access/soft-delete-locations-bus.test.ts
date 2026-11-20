// Hapus lunak lokasi dan Business Unit (redesain fase 4c, keputusan pemilik soft delete 8-9): siklus hapus/pulihkan,
// pemilih tanpa record terhapus, lokasi terhapus dibaca nonaktif, dan BU terhapus tetap memberi hak.
import { beforeEach, describe, expect, test } from 'bun:test';
import { buOptions, locationOptions } from '@server/modules/serial/service';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  getBusinessUnitDto,
  listBusinessUnitDtos,
  listBusinessUnitOptions,
  removeBusinessUnit,
  removeBusinessUnitBatch,
  restoreBusinessUnit,
  saveBusinessUnit,
  setBusinessUnitStatus,
  setBusinessUnitStatusBatch,
} from './business-unit-service';
import { loadUserContext, type UserContext } from './context';
import {
  getLocationDto,
  listLocationDtos,
  removeLocation,
  removeLocationBatch,
  restoreLocation,
  saveLocation,
  setLocationStatus,
  setLocationStatusBatch,
} from './location-service';

let env: TestEnv;
let admin: UserContext;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const auditRows = async (action: string) =>
  (
    await env.DB.prepare('SELECT target, target_id FROM audit_log WHERE action = ? ORDER BY id')
      .bind(action)
      .all<{ target: string; target_id: string }>()
  ).results;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] });
  admin = await ctxOf('admin@gmail.com');
});

describe('lokasi', () => {
  beforeEach(async () => {
    await seedLocation(env, { id: 'l-a', code: 'A', name: 'Cabang A' });
    await seedLocation(env, { id: 'l-b', code: 'B', name: 'Cabang B' });
  });

  test('ubah status massal; id asing membatalkan semuanya', async () => {
    const result = await setLocationStatusBatch(
      env,
      { ids: ['l-a', 'l-b'], status: 'inactive' },
      admin,
    );
    expect(result.items.map((location) => location.status)).toEqual(['inactive', 'inactive']);
    expect((await auditRows('location.deactivate')).map((row) => row.target_id).sort()).toEqual([
      'l-a',
      'l-b',
    ]);
    const error = await captureAppErrorAsync(() =>
      setLocationStatusBatch(env, { ids: ['l-a', 'tidak-ada'], status: 'active' }, admin),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect((await listLocationDtos(env, { status: 'active' }, admin)).length).toBe(0);
  });

  test('lokasi Aktif tidak dapat dihapus; Nonaktif dapat, hilang dari pemilih, dan dapat dipulihkan sebagai Nonaktif', async () => {
    const error = await captureAppErrorAsync(() => removeLocation(env, { id: 'l-a' }, admin));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Nonaktifkan lokasi dulu sebelum dihapus');
    await setLocationStatus(env, { id: 'l-a', status: 'inactive' }, admin);
    expect(await removeLocationBatch(env, { ids: ['l-a'] }, admin)).toEqual({ ids: ['l-a'] });
    expect((await auditRows('location.delete')).map((row) => row.target_id)).toEqual(['l-a']);
    expect((await listLocationDtos(env, null, admin)).map((l) => l.id)).toEqual(['l-b']);
    expect((await listLocationDtos(env, { status: 'deleted' }, admin)).map((l) => l.id)).toEqual([
      'l-a',
    ]);
    expect((await locationOptions(env)).locations.map((l) => l.id)).toEqual(['l-b']);
    const viewer = await ctxOf('lihat@gmail.com');
    expect(
      (await captureAppErrorAsync(() => getLocationDto(env, { id: 'l-a' }, viewer))).code,
    ).toBe('NOT_FOUND');
    const restored = await restoreLocation(env, { id: 'l-a' }, admin);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    expect((await auditRows('location.restore')).length).toBe(1);
  });

  test('kode dan nama lokasi terhapus dapat dipakai lokasi baru; pulihkan yang bentrok = CONFLICT', async () => {
    await withoutOldIndex(env, 'locations', 'locations_code_unique', 'code', async () => {
      await withoutOldIndex(env, 'locations', 'locations_name_unique', 'name_key', async () => {
        await seedLocation(env, { id: 'l-x', code: 'X', name: 'Gudang X', status: 'inactive' });
        await removeLocation(env, { id: 'l-x' }, admin);
        const fresh = await saveLocation(env, { code: 'X', name: 'Gudang X' }, admin);
        expect(fresh.id).not.toBe('l-x');
        const error = await captureAppErrorAsync(() => restoreLocation(env, { id: 'l-x' }, admin));
        expect(error.code).toBe('CONFLICT');
      });
    });
  });

  test('pengguna dengan lokasi terhapus: lokasi dibaca nonaktif (tak ada di me.locations)', async () => {
    await seedRole(env, { id: 'r-ho', name: 'ST', permissions: { handover: 'edit' } });
    await seedUser(env, {
      id: 'u-s',
      email: 'staf@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-ho'] },
        { locationId: 'l-b', roleIds: ['r-ho'] },
      ],
    });
    expect(Object.keys((await ctxOf('staf@gmail.com')).locations).sort()).toEqual(['l-a', 'l-b']);
    await setLocationStatus(env, { id: 'l-a', status: 'inactive' }, admin);
    await removeLocation(env, { id: 'l-a' }, admin);
    expect(Object.keys((await ctxOf('staf@gmail.com')).locations)).toEqual(['l-b']);
  });
});

describe('business unit', () => {
  beforeEach(async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
    await seedBusinessUnit(env, { id: 'bu-n', code: 'N', name: 'BU N', status: 'inactive' });
    await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'edit' } });
    await seedUser(env, {
      id: 'u-bu',
      email: 'bu@gmail.com',
      buAssignments: [
        { buId: 'bu-a', roleIds: ['r-sn'] },
        { buId: 'bu-b', roleIds: ['r-sn'] },
        { buId: 'bu-n', roleIds: ['r-sn'] },
      ],
    });
  });

  test('ubah status massal; id asing membatalkan semuanya', async () => {
    const result = await setBusinessUnitStatusBatch(
      env,
      { ids: ['bu-a', 'bu-b'], status: 'inactive' },
      admin,
    );
    expect(result.items.map((bu) => bu.status)).toEqual(['inactive', 'inactive']);
    expect((await auditRows('businessunit.deactivate')).map((row) => row.target_id).sort()).toEqual(
      ['bu-a', 'bu-b'],
    );
    const error = await captureAppErrorAsync(() =>
      setBusinessUnitStatusBatch(env, { ids: ['bu-a', 'tidak-ada'], status: 'active' }, admin),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('BU Aktif tidak dapat dihapus; Nonaktif dapat, ditandai terhapus di pemilih, dan hilang dari pilihan serial', async () => {
    const error = await captureAppErrorAsync(() => removeBusinessUnit(env, { id: 'bu-a' }, admin));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Nonaktifkan BU dulu sebelum dihapus');
    await setBusinessUnitStatus(env, { id: 'bu-b', status: 'inactive' }, admin);
    expect(await removeBusinessUnitBatch(env, { ids: ['bu-b'] }, admin)).toEqual({
      ids: ['bu-b'],
    });
    expect((await auditRows('businessunit.delete')).map((row) => row.target_id)).toEqual(['bu-b']);
    expect((await listBusinessUnitDtos(env, null, admin)).map((bu) => bu.id)).toEqual([
      'bu-a',
      'bu-n',
    ]);
    const deleted = await listBusinessUnitDtos(env, { status: 'deleted' }, admin);
    expect(deleted.map((bu) => bu.id)).toEqual(['bu-b']);
    expect(deleted[0]?.deletedInfo?.deletedBy).toBe('admin@gmail.com');
    const options = await listBusinessUnitOptions(env);
    expect(options.map((bu) => [bu.id, bu.deleted === true])).toEqual([
      ['bu-a', false],
      ['bu-b', true],
      ['bu-n', false],
    ]);
    const user = await ctxOf('bu@gmail.com');
    expect((await buOptions(env, user)).businessUnits.map((bu) => bu.id)).toEqual(['bu-a']);
    const viewer = await ctxOf('lihat@gmail.com');
    expect(
      (await captureAppErrorAsync(() => getBusinessUnitDto(env, { id: 'bu-b' }, viewer))).code,
    ).toBe('NOT_FOUND');
  });

  test('BU terhapus tetap memberi hak, sama seperti BU nonaktif', async () => {
    await setBusinessUnitStatus(env, { id: 'bu-b', status: 'inactive' }, admin);
    await removeBusinessUnit(env, { id: 'bu-b' }, admin);
    const ctx = await ctxOf('bu@gmail.com');
    expect(ctx.businessUnits['bu-b']?.serial).toBe('edit');
    expect(ctx.businessUnits['bu-n']?.serial).toBe('edit');
    expect(ctx.deletedBuIds).toEqual(['bu-b']);
  });

  test('pulihkan mengembalikan BU Nonaktif; kode yang kini dipakai BU hidup = CONFLICT', async () => {
    await setBusinessUnitStatus(env, { id: 'bu-b', status: 'inactive' }, admin);
    await removeBusinessUnit(env, { id: 'bu-b' }, admin);
    const restored = await restoreBusinessUnit(env, { id: 'bu-b' }, admin);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    expect((await auditRows('businessunit.restore')).length).toBe(1);
    await withoutOldIndex(env, 'business_units', 'business_units_code_unique', 'code', async () => {
      await withoutOldIndex(
        env,
        'business_units',
        'business_units_name_unique',
        'name_key',
        async () => {
          await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU X', status: 'inactive' });
          await removeBusinessUnit(env, { id: 'bu-x' }, admin);
          const fresh = await saveBusinessUnit(env, { code: 'X', name: 'BU X' }, admin);
          expect(fresh.id).not.toBe('bu-x');
          const error = await captureAppErrorAsync(() =>
            restoreBusinessUnit(env, { id: 'bu-x' }, admin),
          );
          expect(error.code).toBe('CONFLICT');
        },
      );
    });
  });
});
