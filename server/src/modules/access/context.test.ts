import { beforeEach, describe, expect, test } from 'bun:test';
import type { Db, DbStatement } from '@server/core/db';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { loadActiveUserContexts, loadUserContext } from './context';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'l-a', code: 'A' });
  await seedLocation(env, { id: 'l-b', code: 'B' });
  await seedLocation(env, { id: 'l-mati', code: 'MATI', status: 'inactive' });
  await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
  await seedRole(env, { id: 'r-ho', name: 'Serah Terima', permissions: { handover: 'edit' } });
});

describe('loadUserContext', () => {
  test('email tidak dikenal, kosong, atau nonaktif menghasilkan null', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'mati@gmail.com',
      status: 'inactive',
      roleIds: ['r-view'],
    });
    expect(await loadUserContext(env, 'nobody@gmail.com')).toBeNull();
    expect(await loadUserContext(env, '  ')).toBeNull();
    expect(await loadUserContext(env, 'mati@gmail.com')).toBeNull();
  });

  test('sharedAccount dibaca dari kolom users.shared_account (bawaan false)', async () => {
    await seedUser(env, { id: 'u1', email: 'a@gmail.com', roleIds: ['r-view'] });
    await seedUser(env, {
      id: 'u2',
      email: 'b@gmail.com',
      roleIds: ['r-view'],
      sharedAccount: true,
    });
    expect((await loadUserContext(env, 'a@gmail.com'))?.sharedAccount).toBe(false);
    expect((await loadUserContext(env, 'b@gmail.com'))?.sharedAccount).toBe(true);
    const all = await loadActiveUserContexts(env);
    expect(all.find((ctx) => ctx.email === 'b@gmail.com')?.sharedAccount).toBe(true);
    expect(all.find((ctx) => ctx.email === 'a@gmail.com')?.sharedAccount).toBe(false);
  });

  test('izin global dari penugasan Semua lokasi; email dinormalkan', async () => {
    await seedUser(env, { id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] });
    const ctx = await loadUserContext(env, '  Viewer@Gmail.com ');
    expect(ctx?.email).toBe('viewer@gmail.com');
    expect(ctx?.userId).toBe('u1');
    expect(ctx?.isSuperAdmin).toBe(false);
    expect(ctx?.permissions.access).toBe('view');
    expect(ctx?.permissions.item).toBe('none');
  });

  test('izin per lokasi hanya untuk lokasi aktif yang ditugaskan', async () => {
    await seedUser(env, {
      id: 'u2',
      email: 'staf@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-ho'] },
        { locationId: 'l-mati', roleIds: ['r-ho'] },
      ],
    });
    const ctx = await loadUserContext(env, 'staf@gmail.com');
    expect(Object.keys(ctx?.locations ?? {})).toEqual(['l-a']);
    expect(ctx?.locations['l-a']?.handover).toBe('edit');
  });

  test('data lama (hanya role_ids) dibaca sebagai penugasan Semua lokasi', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, status, role_ids, assignments) VALUES ('u3', 'lama@gmail.com', 'active', ?, '')",
    )
      .bind(JSON.stringify(['r-view']))
      .run();
    expect((await loadUserContext(env, 'lama@gmail.com'))?.permissions.access).toBe('view');
  });

  test('super admin (ADMIN_EMAIL) punya semua izin di semua lokasi aktif walau tak terdaftar', async () => {
    const ctx = await loadUserContext(env, 'admin@gmail.com');
    expect(ctx?.isSuperAdmin).toBe(true);
    expect(ctx?.userId).toBeNull();
    expect(Object.keys(ctx?.locations ?? {}).sort()).toEqual(['l-a', 'l-b']);
    expect(ctx?.permissions.access).toBe('manage');
  });

  test('pencabutan akses berlaku seketika (tanpa cache lintas permintaan)', async () => {
    await seedUser(env, { id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] });
    expect(await loadUserContext(env, 'viewer@gmail.com')).not.toBeNull();
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE id = 'u1'").run();
    expect(await loadUserContext(env, 'viewer@gmail.com')).toBeNull();
  });

  test('memakai SATU pernyataan tunggal ke MariaDB (tanpa batch/transaksi)', async () => {
    let batches = 0;
    let prepares = 0;
    const db = env.DB;
    const counting = {
      prepare: (sql: string) => {
        prepares++;
        return db.prepare(sql);
      },
      batch: (statements: DbStatement[]) => {
        batches++;
        return db.batch(statements);
      },
    } as unknown as Db;
    await loadUserContext({ ...env, DB: counting }, 'admin@gmail.com');
    expect(batches).toBe(0);
    expect(prepares).toBe(1);
  });
});

describe('data kotor di basis data', () => {
  test('JSON permissions/assignments rusak dan level asing diabaikan tanpa error', async () => {
    await env.DB.prepare(
      "INSERT INTO roles (id, name, permissions) VALUES ('r-rusak', 'Rusak', '{\"item\":\"superuser\",\"stock\":\"view\"}'), ('r-json', 'Json', '{\"item\":')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO users (id, email, status, assignments, role_ids) VALUES ('u3', 'rusak@gmail.com', 'active', '', 'bukan-json'), ('u4', 'campur@gmail.com', 'active', '', '[\" r-rusak \",\"r-json\"]')",
    ).run();
    const rusak = await loadUserContext(env, 'rusak@gmail.com');
    expect(rusak?.permissions.item).toBe('none');
    const campur = await loadUserContext(env, 'campur@gmail.com');
    expect(campur?.permissions.stock).toBe('view');
    expect(campur?.permissions.item).toBe('none');
  });
});

describe('penugasan BU', () => {
  beforeEach(async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B', status: 'inactive' });
    await seedRole(env, { id: 'r-item-edit', name: 'Editor', permissions: { item: 'edit' } });
    await seedRole(env, { id: 'r-item-view', name: 'Katalog', permissions: { item: 'view' } });
  });

  test('Semua BU berlaku untuk semua BU yang ada (termasuk nonaktif); level global item = tertinggi', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'semua@gmail.com',
      buAssignments: [{ buId: null, roleIds: ['r-item-edit'] }],
    });
    const ctx = await loadUserContext(env, 'semua@gmail.com');
    expect(ctx?.businessUnits).toEqual({
      'bu-a': { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
      'bu-b': { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
    });
    expect(ctx?.permissions.item).toBe('edit');
  });

  test('penugasan BU A saja hanya memberi A; digabung dengan Semua BU memberi level tertinggi', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'a@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-item-edit'] }],
    });
    expect((await loadUserContext(env, 'a@gmail.com'))?.businessUnits).toEqual({
      'bu-a': { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
    });
    await seedUser(env, {
      id: 'u2',
      email: 'gabung@gmail.com',
      buAssignments: [
        { buId: null, roleIds: ['r-item-view'] },
        { buId: 'bu-a', roleIds: ['r-item-edit'] },
      ],
    });
    expect((await loadUserContext(env, 'gabung@gmail.com'))?.businessUnits).toEqual({
      'bu-a': { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
      'bu-b': { item: 'view', serial: 'none', serialservice: 'none', serialwh: 'none' },
    });
  });

  test('BU id basi diabaikan tanpa galat; level global item tetap dari penugasan itu (tanpa akses item apa pun)', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'basi@gmail.com',
      buAssignments: [{ buId: 'bu-hilang', roleIds: ['r-item-edit'] }],
    });
    const ctx = await loadUserContext(env, 'basi@gmail.com');
    expect(ctx).not.toBeNull();
    expect(ctx?.businessUnits).toEqual({});
    // Dokumentasi perilaku (spek 5.2): level global (Merk/Customer) = tertinggi di antara SEMUA penugasan BU,
    // jadi penugasan basi tetap memberinya; yang tidak ia dapat hanyalah akses ke item mana pun.
    expect(ctx?.permissions.item).toBe('edit');
  });

  test('user tanpa penugasan BU: businessUnits kosong dan item none', async () => {
    await seedUser(env, { id: 'u1', email: 'kosong@gmail.com' });
    const ctx = await loadUserContext(env, 'kosong@gmail.com');
    expect(ctx?.businessUnits).toEqual({});
    expect(ctx?.permissions.item).toBe('none');
  });

  test('role item hanya pada penugasan LOKASI tidak memberi item (perubahan disengaja)', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'lokasi@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-item-edit'] }],
      buAssignments: [],
    });
    const ctx = await loadUserContext(env, 'lokasi@gmail.com');
    expect(ctx?.permissions.item).toBe('none');
    expect(ctx?.businessUnits).toEqual({});
  });

  test('role access pada penugasan BU tidak memberi izin modul lain', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'akses@gmail.com',
      buAssignments: [{ buId: null, roleIds: ['r-view'] }],
    });
    const ctx = await loadUserContext(env, 'akses@gmail.com');
    expect(ctx?.permissions.access).toBe('none');
    expect(ctx?.businessUnits).toEqual({});
  });

  test('super admin: semua BU manage; tanpa BU sama sekali = {} dan item manage', async () => {
    const ctx = await loadUserContext(env, 'admin@gmail.com');
    expect(ctx?.businessUnits).toEqual({
      'bu-a': { item: 'manage', serial: 'manage', serialservice: 'edit', serialwh: 'edit' },
      'bu-b': { item: 'manage', serial: 'manage', serialservice: 'edit', serialwh: 'edit' },
    });
    await env.DB.prepare('DELETE FROM business_units').run();
    const empty = await loadUserContext(env, 'admin@gmail.com');
    expect(empty?.businessUnits).toEqual({});
    expect(empty?.permissions.item).toBe('manage');
  });

  test('JSON bu_assignments rusak = tanpa penugasan, tanpa galat', async () => {
    await seedUser(env, { id: 'u1', email: 'rusak@gmail.com' });
    await env.DB.prepare("UPDATE users SET bu_assignments = '{bukan json' WHERE id = 'u1'").run();
    const ctx = await loadUserContext(env, 'rusak@gmail.com');
    expect(ctx?.businessUnits).toEqual({});
    expect(ctx?.permissions.item).toBe('none');
  });
});
