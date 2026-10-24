import { beforeEach, describe, expect, test } from 'bun:test';
import { seedLocation, seedRole, seedUser } from '@worker-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { loadUserContext } from './context';

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

  test('memakai satu panggilan batch ke D1', async () => {
    let batches = 0;
    let prepares = 0;
    const db = env.DB;
    const counting = {
      prepare: (sql: string) => {
        prepares++;
        return db.prepare(sql);
      },
      batch: (statements: D1PreparedStatement[]) => {
        batches++;
        return db.batch(statements);
      },
    } as unknown as D1Database;
    await loadUserContext({ ...env, DB: counting }, 'admin@gmail.com');
    expect(batches).toBe(1);
    expect(prepares).toBe(3);
  });
});

describe('data kotor di D1', () => {
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
