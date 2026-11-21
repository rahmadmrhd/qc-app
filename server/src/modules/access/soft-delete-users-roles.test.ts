// Hapus lunak pengguna dan role (redesain fase 4c, keputusan pemilik soft delete 8-11): batch status, hapus, pulihkan,
// larangan hapus diri sendiri dan super admin, hak yang gugur, dan rujukan tersimpan.
import { beforeEach, describe, expect, test } from 'bun:test';
import { pushStatus } from '@server/modules/notification/push-service';
import { resolveRecipients } from '@server/modules/notification/recipients';
import { canManageSerialSettings } from '@server/modules/serial/alert';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { loadActiveUserContexts, loadUserContext, type UserContext } from './context';
import {
  getRoleDto,
  getUserDto,
  listRoleDtos,
  listUserDtos,
  removeRole,
  removeRoleBatch,
  removeUser,
  removeUserBatch,
  restoreRole,
  restoreUser,
  saveRole,
  saveUser,
  setUserStatus,
  setUserStatusBatch,
} from './service';

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

const userRow = (id: string) =>
  env.DB.prepare('SELECT status, deleted_at, deleted_by FROM users WHERE id = ?')
    .bind(id)
    .first<{ status: string; deleted_at: string; deleted_by: string }>();

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { access: 'manage' } });
  await seedRole(env, { id: 'r-kosong', name: 'Kosong' });
  await seedUser(env, { id: 'u-a', email: 'a@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-b', email: 'b@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-c', email: 'c@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-mgr', email: 'mgr@gmail.com', roleIds: ['r-manage'] });
  admin = await ctxOf('admin@gmail.com');
});

describe('pengguna: ubah status massal', () => {
  test('tiga pengguna berubah status, audit per pengguna membawa target_id', async () => {
    const result = await setUserStatusBatch(
      env,
      { ids: ['u-a', 'u-b', 'u-c'], status: 'inactive' },
      admin,
    );
    expect(result.items.map((user) => [user.id, user.status])).toEqual([
      ['u-a', 'inactive'],
      ['u-b', 'inactive'],
      ['u-c', 'inactive'],
    ]);
    const rows = await auditRows('user.deactivate');
    expect(rows.map((row) => row.target_id).sort()).toEqual(['u-a', 'u-b', 'u-c']);
    // status sama = tanpa audit baru
    await setUserStatusBatch(env, { ids: ['u-a'], status: 'inactive' }, admin);
    expect((await auditRows('user.deactivate')).length).toBe(3);
  });

  test('batch yang memuat diri sendiri ditolak seluruhnya', async () => {
    const mgr = await ctxOf('mgr@gmail.com');
    const error = await captureAppErrorAsync(() =>
      setUserStatusBatch(env, { ids: ['u-a', 'u-mgr'], status: 'inactive' }, mgr),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Anda tidak bisa menonaktifkan akun sendiri');
    expect((await userRow('u-a'))?.status).toBe('active');
  });

  test('id asing membatalkan seluruh permintaan (NOT_FOUND)', async () => {
    const error = await captureAppErrorAsync(() =>
      setUserStatusBatch(env, { ids: ['u-a', 'tidak-ada'], status: 'inactive' }, admin),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect((await userRow('u-a'))?.status).toBe('active');
  });
});

describe('pengguna: hapus dan pulihkan', () => {
  test('pengguna Aktif tidak dapat dihapus; Nonaktif dapat, dan audit memuat target_id', async () => {
    const error = await captureAppErrorAsync(() => removeUser(env, { id: 'u-a' }, admin));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Nonaktifkan pengguna dulu sebelum dihapus');
    await setUserStatus(env, { id: 'u-a', status: 'inactive' }, admin);
    expect(await removeUser(env, { id: 'u-a' }, admin)).toEqual({ id: 'u-a' });
    const row = await userRow('u-a');
    expect(row?.deleted_at).not.toBe('');
    expect(row?.deleted_by).toBe('admin@gmail.com');
    expect(await auditRows('user.delete')).toEqual([{ target: 'a@gmail.com', target_id: 'u-a' }]);
  });

  test('tidak dapat menghapus akun sendiri', async () => {
    const mgr = await ctxOf('mgr@gmail.com');
    const error = await captureAppErrorAsync(() => removeUser(env, { id: 'u-mgr' }, mgr));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Anda tidak bisa menghapus akun sendiri');
  });

  test('akun super admin tidak dapat dihapus', async () => {
    await seedUser(env, { id: 'u-super', email: 'admin@gmail.com', roleIds: ['r-view'] });
    const mgr = await ctxOf('mgr@gmail.com');
    const error = await captureAppErrorAsync(() => removeUser(env, { id: 'u-super' }, mgr));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Akun super admin tidak dapat dihapus');
  });

  test('UserDto.superAdmin: true hanya untuk alamat ADMIN_EMAIL (daftar, get, dan hasil ubah status)', async () => {
    await seedUser(env, { id: 'u-super', email: 'admin@gmail.com', roleIds: ['r-view'] });
    const mgr = await ctxOf('mgr@gmail.com');
    const list = await listUserDtos(env, undefined, mgr);
    expect(list.find((user) => user.email === 'admin@gmail.com')?.superAdmin).toBe(true);
    expect(list.filter((user) => user.superAdmin !== true).length).toBe(list.length - 1);
    expect(list.find((user) => user.email === 'a@gmail.com')?.superAdmin).toBe(false);
    expect((await getUserDto(env, { id: 'u-super' }, mgr)).superAdmin).toBe(true);
    expect((await getUserDto(env, { id: 'u-a' }, mgr)).superAdmin).toBe(false);
    expect((await setUserStatus(env, { id: 'u-a', status: 'inactive' }, mgr)).superAdmin).toBe(
      false,
    );
  });

  test('hapus ulang = sukses tanpa audit baru dan deleted_at asli utuh', async () => {
    await setUserStatus(env, { id: 'u-a', status: 'inactive' }, admin);
    await removeUser(env, { id: 'u-a' }, admin);
    const first = (await userRow('u-a'))?.deleted_at;
    env.clock.advance(5000);
    expect(await removeUserBatch(env, { ids: ['u-a'] }, admin)).toEqual({ ids: ['u-a'] });
    expect((await userRow('u-a'))?.deleted_at).toBe(first);
    expect((await auditRows('user.delete')).length).toBe(1);
  });

  test('daftar bawaan menyembunyikan terhapus; status=deleted hanya bagi manage', async () => {
    await setUserStatus(env, { id: 'u-a', status: 'inactive' }, admin);
    await removeUser(env, { id: 'u-a' }, admin);
    expect((await listUserDtos(env, null, admin)).map((user) => user.id)).not.toContain('u-a');
    const deleted = await listUserDtos(env, { status: 'deleted' }, admin);
    expect(deleted.map((user) => user.id)).toEqual(['u-a']);
    expect(deleted[0]?.deleted?.deletedBy).toBe('admin@gmail.com');
    const viewer = await ctxOf('b@gmail.com');
    expect(
      (await captureAppErrorAsync(() => listUserDtos(env, { status: 'deleted' }, viewer))).code,
    ).toBe('FORBIDDEN');
    expect((await captureAppErrorAsync(() => getUserDto(env, { id: 'u-a' }, viewer))).code).toBe(
      'NOT_FOUND',
    );
    expect((await getUserDto(env, { id: 'u-a' }, admin)).email).toBe('a@gmail.com');
  });

  test('pengguna terhapus tidak memberi hak, bukan penerima notifikasi, dan tidak ada di status push', async () => {
    await seedLocation(env, { id: 'l-1', code: 'L1' });
    await seedRole(env, {
      id: 'r-qc',
      name: 'QC',
      permissions: { qc: 'edit' } as never,
    });
    await env.DB.prepare("UPDATE users SET assignments = ? WHERE id IN ('u-a', 'u-b')")
      .bind(JSON.stringify([{ locationId: null, roleIds: ['r-qc'] }]))
      .run();
    const before = await resolveRecipients(env, {
      locationId: 'l-1',
      side: 'qc',
      excludeEmail: 'nobody@gmail.com',
    });
    expect(before.map((recipient) => recipient.email)).toContain('a@gmail.com');
    await setUserStatus(env, { id: 'u-a', status: 'inactive' }, admin);
    await removeUser(env, { id: 'u-a' }, admin);
    expect(await loadUserContext(env, 'a@gmail.com')).toBeNull();
    expect((await loadActiveUserContexts(env)).map((ctx) => ctx.email)).not.toContain(
      'a@gmail.com',
    );
    const after = await resolveRecipients(env, {
      locationId: 'l-1',
      side: 'qc',
      excludeEmail: 'nobody@gmail.com',
    });
    expect(after.map((recipient) => recipient.email)).not.toContain('a@gmail.com');
    expect((await pushStatus(env)).map((row) => row.email)).not.toContain('a@gmail.com');
  });

  test('email pengguna terhapus = CONFLICT generik saat membuat baru; pulihkan akun lama mengembalikannya Nonaktif', async () => {
    await setUserStatus(env, { id: 'u-a', status: 'inactive' }, admin);
    await removeUser(env, { id: 'u-a' }, admin);
    const error = await captureAppErrorAsync(() =>
      saveUser(
        env,
        {
          email: 'a@gmail.com',
          name: 'Baru',
          status: 'active',
          assignments: [],
          buAssignments: [],
        },
        admin,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Email sudah terdaftar');
    const restored = await restoreUser(env, { id: 'u-a' }, admin);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    expect((await auditRows('user.restore')).length).toBe(1);
    // memulihkan yang sudah hidup = sukses tanpa audit baru
    await restoreUser(env, { id: 'u-a' }, admin);
    expect((await auditRows('user.restore')).length).toBe(1);
  });
});

describe('role: hapus dan pulihkan', () => {
  test('role yang dipakai pengguna hidup ditolak dengan jumlah pemakai', async () => {
    const error = await captureAppErrorAsync(() => removeRole(env, { id: 'r-view' }, admin));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Role masih dipakai oleh 3 user');
  });

  test('role yang hanya dipakai pengguna terhapus dapat dihapus; terhapus tidak memberi hak dan tercatat di deletedRoleIds', async () => {
    await seedRole(env, { id: 'r-solo', name: 'Solo', permissions: { item: 'manage' } });
    await seedUser(env, { id: 'u-solo', email: 'solo@gmail.com', roleIds: ['r-solo'] });
    expect(
      (await captureAppErrorAsync(() => removeRole(env, { id: 'r-solo' }, admin))).message,
    ).toBe('Role masih dipakai oleh 1 user');
    await setUserStatus(env, { id: 'u-solo', status: 'inactive' }, admin);
    await removeUser(env, { id: 'u-solo' }, admin);
    expect(await removeRole(env, { id: 'r-solo' }, admin)).toEqual({ id: 'r-solo' });
    expect((await auditRows('role.delete')).map((row) => row.target_id)).toEqual(['r-solo']);
    const deletedUser = await getUserDto(env, { id: 'u-solo' }, admin);
    expect(deletedUser.deletedRoleIds).toEqual(['r-solo']);
    // pengguna lain yang kemudian diberi role terhapus ditolak
    await expect(
      saveUser(
        env,
        {
          id: 'u-a',
          email: 'a@gmail.com',
          name: 'A',
          status: 'active',
          assignments: [{ locationId: null, roleIds: ['r-solo'] }],
          buAssignments: [],
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  test('role terhapus tidak memberi hak pada pengguna yang masih menyimpannya', async () => {
    await seedRole(env, { id: 'r-x', name: 'X', permissions: { item: 'manage' } });
    await seedUser(env, { id: 'u-x', email: 'x@gmail.com', roleIds: ['r-x'] });
    expect((await ctxOf('x@gmail.com')).permissions.item).toBe('manage');
    await env.DB.prepare(
      "UPDATE roles SET deleted_at = '2026-11-01T00:00:00.000Z', deleted_by = 'admin@gmail.com' WHERE id = 'r-x'",
    ).run();
    expect((await ctxOf('x@gmail.com')).permissions.item).toBe('none');
    // rujukan tersimpan: pengguna tetap dapat disimpan selama role terhapus tidak berubah pada entri yang sama
    const saved = await saveUser(
      env,
      {
        id: 'u-x',
        email: 'x@gmail.com',
        name: 'X baru',
        status: 'active',
        assignments: [{ locationId: null, roleIds: ['r-x'] }],
        buAssignments: [{ buId: null, roleIds: ['r-x'] }],
      },
      admin,
    );
    expect(saved.name).toBe('X baru');
    expect(saved.deletedRoleIds).toEqual(['r-x']);
  });

  test('canManageSerialSettings mengabaikan role terhapus', async () => {
    await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'manage' } });
    await seedBusinessUnit(env, { id: 'bu-1', code: 'B1' });
    await seedUser(env, {
      id: 'u-sn',
      email: 'sn@gmail.com',
      buAssignments: [{ buId: 'bu-1', roleIds: ['r-sn'] }],
    });
    expect(await canManageSerialSettings(env, await ctxOf('sn@gmail.com'))).toBe(true);
    await env.DB.prepare(
      "UPDATE roles SET deleted_at = '2026-11-01T00:00:00.000Z', deleted_by = 'x' WHERE id = 'r-sn'",
    ).run();
    expect(await canManageSerialSettings(env, await ctxOf('sn@gmail.com'))).toBe(false);
  });

  test('daftar/get role terhapus dan pulihkan; role tidak punya status (tanpa Nonaktif)', async () => {
    await removeRole(env, { id: 'r-kosong' }, admin);
    expect((await listRoleDtos(env, null, admin)).map((role) => role.id)).not.toContain('r-kosong');
    expect((await listRoleDtos(env, { status: 'deleted' }, admin)).map((role) => role.id)).toEqual([
      'r-kosong',
    ]);
    const viewer = await ctxOf('b@gmail.com');
    expect(
      (await captureAppErrorAsync(() => getRoleDto(env, { id: 'r-kosong' }, viewer))).code,
    ).toBe('NOT_FOUND');
    const restored = await restoreRole(env, { id: 'r-kosong' }, admin);
    expect(restored.deleted).toBeUndefined();
    expect((await auditRows('role.restore')).map((row) => row.target_id)).toEqual(['r-kosong']);
  });

  test('pulihkan role yang namanya kini dipakai role hidup = CONFLICT', async () => {
    await withoutOldIndex(env, 'roles', 'roles_name_unique', '`name`', async () => {
      await seedRole(env, { id: 'r-lama', name: 'Gudang' });
      await removeRole(env, { id: 'r-lama' }, admin);
      await saveRole(env, { name: 'Gudang', description: '', permissions: {} }, admin);
      const error = await captureAppErrorAsync(() => restoreRole(env, { id: 'r-lama' }, admin));
      expect(error.code).toBe('CONFLICT');
      expect(error.message).toBe('Nama role sudah dipakai');
    });
  });

  test('batch hapus role: pemakai hidup membatalkan seluruh batch', async () => {
    const error = await captureAppErrorAsync(() =>
      removeRoleBatch(env, { ids: ['r-kosong', 'r-view'] }, admin),
    );
    expect(error.code).toBe('CONFLICT');
    expect((await listRoleDtos(env, null, admin)).map((role) => role.id)).toContain('r-kosong');
  });
});
