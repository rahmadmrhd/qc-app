import { beforeEach, describe, expect, test } from 'bun:test';
import { listAudit, writeAudit } from '@server/core/audit';
import { callRoute } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { getRoutes } from '@server/routes';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { measureCpu } from '@server-test/measure';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { AuditEntryDto } from '@shared/rpc';
import type { UserContext } from './context';
import { loadUserContext } from './context';
import { listLocationDtos, saveLocation, setLocationStatus } from './location-service';
import {
  listAuditPage,
  listRoleDtos,
  listUserDtos,
  removeRole,
  saveRole,
  saveUser,
  setUserStatus,
} from './service';

const everywhere = (...roleIds: string[]) => [{ locationId: null, roleIds }];

let env: TestEnv;
let admin: UserContext;

async function contextOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

async function auditRows() {
  const rows = await env.DB.prepare(
    'SELECT action, target, "before" AS before, "after" AS after FROM audit_log ORDER BY id',
  ).all<{ action: string; target: string; before: string; after: string }>();
  return rows.results.map((row) => ({
    action: row.action,
    target: row.target,
    before: JSON.parse(row.before) as unknown,
    after: JSON.parse(row.after) as unknown,
  }));
}

async function lastAudit() {
  const rows = await auditRows();
  const row = rows.at(-1);
  if (!row) throw new Error('audit_log kosong');
  return row;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-08T00:00:00.000Z'));
  await seedRole(env, { id: 'r-qc', name: 'QC Staff', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-access', name: 'Admin Akses', permissions: { access: 'manage' } });
  await seedRole(env, { id: 'r-kosong', name: 'Kosong' });
  await seedUser(env, {
    id: 'u-budi',
    email: 'budi@gmail.com',
    name: 'Budi',
    roleIds: ['r-qc', 'r-access'],
  });
  await seedLocation(env, { id: 'l-a', code: 'A', name: 'Cabang A' });
  await seedLocation(env, { id: 'l-mati', code: 'MATI', name: 'Mati', status: 'inactive' });
  admin = await contextOf('admin@gmail.com');
});

describe('user', () => {
  test('membuat user baru, mencatat audit, dan langsung berlaku untuk login', async () => {
    expect(await loadUserContext(env, 'ani@gmail.com')).toBeNull();
    const created = await saveUser(
      env,
      { email: 'ani@gmail.com', name: 'Ani', status: 'active', assignments: everywhere('r-qc') },
      admin,
    );
    expect(created).toMatchObject({
      email: 'ani@gmail.com',
      updatedBy: 'admin@gmail.com',
      updatedAt: '2026-10-08T00:00:00.000Z',
    });
    expect((await listUserDtos(env)).map((u) => u.email)).toEqual([
      'ani@gmail.com',
      'budi@gmail.com',
    ]);
    expect((await lastAudit()).action).toBe('user.create');
    expect((await loadUserContext(env, 'ani@gmail.com'))?.permissions.item).toBe('edit');
  });

  test('menolak email yang sudah terdaftar walau beda huruf besar', async () => {
    const error = await captureAppErrorAsync(() =>
      saveUser(
        env,
        { email: ' BUDI@Gmail.com ', name: 'B', status: 'active', assignments: [] },
        admin,
      ),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', fields: { email: 'Email sudah terdaftar' } });
  });

  test('dua pembuatan email sama bersamaan: tepat satu berhasil, lainnya CONFLICT (indeks unik)', async () => {
    const make = () =>
      saveUser(
        env,
        { email: 'kembar@gmail.com', name: 'K', status: 'active', assignments: [] },
        admin,
      );
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe('CONFLICT');
    const audit = (await auditRows()).filter((row) => row.target === 'kembar@gmail.com');
    expect(audit).toHaveLength(1);
  });

  test('menolak role yang tidak dikenal', async () => {
    const error = await captureAppErrorAsync(() =>
      saveUser(
        env,
        {
          email: 'ani@gmail.com',
          name: 'Ani',
          status: 'active',
          assignments: everywhere('r-hilang'),
        },
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.assignments).toBeDefined();
  });

  test('email tidak dapat diubah saat edit; user tidak dikenal NOT_FOUND', async () => {
    const error = await captureAppErrorAsync(() =>
      saveUser(
        env,
        { id: 'u-budi', email: 'baru@gmail.com', name: 'Budi', status: 'active', assignments: [] },
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(
      (
        await captureAppErrorAsync(() =>
          saveUser(
            env,
            { id: 'x', email: 'x@gmail.com', name: 'X', status: 'active', assignments: [] },
            admin,
          ),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('admin tidak bisa menonaktifkan akun sendiri', async () => {
    const budi = await contextOf('budi@gmail.com');
    const viaSave = await captureAppErrorAsync(() =>
      saveUser(
        env,
        {
          id: 'u-budi',
          email: 'budi@gmail.com',
          name: 'Budi',
          status: 'inactive',
          assignments: everywhere('r-access'),
        },
        budi,
      ),
    );
    expect(viaSave.code).toBe('CONFLICT');
    expect(
      (
        await captureAppErrorAsync(() =>
          setUserStatus(env, { id: 'u-budi', status: 'inactive' }, budi),
        )
      ).code,
    ).toBe('CONFLICT');
  });

  test('menonaktifkan user lain langsung mencabut aksesnya, termasuk lewat RPC berikutnya', async () => {
    const token = await signSessionToken(env, 'budi@gmail.com', env.clock.now());
    const call = () => callRoute(env, token, 'auth.me', null, getRoutes());
    expect((await call()).ok).toBe(true);
    expect((await setUserStatus(env, { id: 'u-budi', status: 'inactive' }, admin)).status).toBe(
      'inactive',
    );
    expect(await loadUserContext(env, 'budi@gmail.com')).toBeNull();
    const after = await call();
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('UNAUTHENTICATED');
  });

  test('mengganti peran berlaku pada permintaan berikutnya', async () => {
    expect((await contextOf('budi@gmail.com')).permissions.access).toBe('manage');
    await saveUser(
      env,
      {
        id: 'u-budi',
        email: 'budi@gmail.com',
        name: 'Budi',
        status: 'active',
        assignments: everywhere('r-qc'),
      },
      admin,
    );
    expect((await contextOf('budi@gmail.com')).permissions.access).toBe('none');
  });

  test('nama berawalan = disimpan dan dibaca kembali sebagai teks literal', async () => {
    await saveUser(
      env,
      { email: 'ani@gmail.com', name: '=HYPERLINK("http://x")', status: 'active', assignments: [] },
      admin,
    );
    expect((await listUserDtos(env)).find((u) => u.email === 'ani@gmail.com')?.name).toBe(
      '=HYPERLINK("http://x")',
    );
  });

  test('menyimpan penugasan per lokasi dan menghitung userCount role dari semua penugasan', async () => {
    await saveUser(
      env,
      {
        email: 'ani@gmail.com',
        name: 'Ani',
        status: 'active',
        assignments: [
          { locationId: null, roleIds: ['r-qc'] },
          { locationId: 'l-a', roleIds: ['r-access'] },
        ],
      },
      admin,
    );
    const ani = (await listUserDtos(env)).find((u) => u.email === 'ani@gmail.com');
    expect(ani?.assignments).toEqual([
      { locationId: null, roleIds: ['r-qc'] },
      { locationId: 'l-a', roleIds: ['r-access'] },
    ]);
    expect((await listRoleDtos(env)).find((r) => r.id === 'r-access')?.userCount).toBe(2);
    expect(await lastAudit()).toMatchObject({
      action: 'user.create',
      after: { assignments: { '*': ['r-qc'], 'l-a': ['r-access'] } },
    });
  });

  test('menolak lokasi yang tidak dikenal atau tidak aktif pada penugasan baru', async () => {
    for (const locationId of ['tidak-ada', 'l-mati']) {
      const error = await captureAppErrorAsync(() =>
        saveUser(
          env,
          {
            email: 'ani@gmail.com',
            name: 'Ani',
            status: 'active',
            assignments: [{ locationId, roleIds: ['r-qc'] }],
          },
          admin,
        ),
      );
      expect(error).toMatchObject({
        code: 'VALIDATION',
        fields: { assignments: 'Lokasi tidak dikenal atau tidak aktif' },
      });
    }
  });

  test('penugasan lama pada lokasi yang kini nonaktif tetap boleh dipertahankan saat edit', async () => {
    await seedUser(env, {
      id: 'u-lama',
      email: 'lama@gmail.com',
      assignments: [{ locationId: 'l-mati', roleIds: ['r-qc'] }],
    });
    const saved = await saveUser(
      env,
      {
        id: 'u-lama',
        email: 'lama@gmail.com',
        name: 'Lama Baru',
        status: 'active',
        assignments: [{ locationId: 'l-mati', roleIds: ['r-qc'] }],
      },
      admin,
    );
    expect(saved.name).toBe('Lama Baru');
  });

  test('admin non-super tidak dapat menghilangkan akses Kelola global miliknya sendiri (FR-AS5)', async () => {
    await seedUser(env, {
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    });
    const pusat = await contextOf('pusat@gmail.com');
    const base = {
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      name: 'Pusat',
      status: 'active' as const,
    };
    const error = await captureAppErrorAsync(() =>
      saveUser(
        env,
        { ...base, assignments: [{ locationId: 'l-a', roleIds: ['r-access'] }] },
        pusat,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(
      (
        await saveUser(
          env,
          { ...base, assignments: [{ locationId: null, roleIds: ['r-access', 'r-qc'] }] },
          pusat,
        )
      ).assignments[0]?.roleIds,
    ).toEqual(['r-access', 'r-qc']);
    // Super admin boleh mengubah penugasan siapa pun.
    expect((await saveUser(env, { ...base, assignments: [] }, admin)).assignments).toEqual([]);
  });
});

describe('role', () => {
  test('nama role unik tanpa membedakan huruf besar', async () => {
    const error = await captureAppErrorAsync(() =>
      saveRole(env, { name: 'qc staff', description: '', permissions: {} }, admin),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', fields: { name: 'Nama role sudah dipakai' } });
  });

  test('perubahan permission role langsung memengaruhi user', async () => {
    await saveRole(
      env,
      {
        id: 'r-qc',
        name: 'QC Staff',
        description: '',
        permissions: { item: 'manage', stock: 'none' },
      },
      admin,
    );
    expect((await loadUserContext(env, 'budi@gmail.com'))?.permissions.item).toBe('manage');
  });

  test('role yang dipakai tidak bisa dihapus; role kosong terhapus dan tercatat di audit', async () => {
    expect((await captureAppErrorAsync(() => removeRole(env, { id: 'r-qc' }, admin))).code).toBe(
      'CONFLICT',
    );
    expect(await removeRole(env, { id: 'r-kosong' }, admin)).toEqual({ id: 'r-kosong' });
    expect((await listRoleDtos(env)).map((r) => r.id)).not.toContain('r-kosong');
    expect((await lastAudit()).action).toBe('role.delete');
    expect(
      (await captureAppErrorAsync(() => removeRole(env, { id: 'r-kosong' }, admin))).code,
    ).toBe('NOT_FOUND');
  });

  test('listRoleDtos menyertakan jumlah user per role, terurut nama', async () => {
    expect((await listRoleDtos(env)).map((r) => [r.name, r.userCount])).toEqual([
      ['Admin Akses', 1],
      ['Kosong', 0],
      ['QC Staff', 1],
    ]);
  });

  test('admin non-super tidak dapat menurunkan role yang memberi Kelola global miliknya sendiri', async () => {
    await seedUser(env, {
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    });
    const pusat = await contextOf('pusat@gmail.com');
    const error = await captureAppErrorAsync(() =>
      saveRole(
        env,
        { id: 'r-access', name: 'Admin Akses', description: '', permissions: { access: 'view' } },
        pusat,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect((await listRoleDtos(env)).find((r) => r.id === 'r-access')?.permissions).toEqual({
      access: 'manage',
    });
    expect(
      (
        await saveRole(
          env,
          {
            id: 'r-access',
            name: 'Admin Akses 2',
            description: '',
            permissions: { access: 'manage' },
          },
          pusat,
        )
      ).name,
    ).toBe('Admin Akses 2');
    expect(
      (
        await saveRole(
          env,
          {
            id: 'r-access',
            name: 'Admin Akses 2',
            description: '',
            permissions: { access: 'view' },
          },
          admin,
        )
      ).permissions,
    ).toEqual({ access: 'view' });
  });
});

describe('audit atomik dan snapshot', () => {
  test('perubahan dan audit satu batch: gagal di tengah tidak meninggalkan audit', async () => {
    const before = (await auditRows()).length;
    await expect(
      saveUser(
        env,
        { email: 'x@gmail.com', name: 'X', status: 'active', assignments: [] },
        admin,
      ).then(() =>
        env.DB.batch([
          env.DB.prepare("INSERT INTO roles (id, name) VALUES ('r-x', 'X')"),
          writeAudit(env.DB, { actor: 'a', action: 'role.create', target: 'X' }),
          env.DB.prepare("INSERT INTO roles (id, name) VALUES ('r-y', 'x')"),
        ]),
      ),
    ).rejects.toThrow();
    // hanya audit user.create yang tersisa; batch gagal membatalkan role dan auditnya
    expect((await auditRows()).length).toBe(before + 1);
    const roles = await env.DB.prepare("SELECT id FROM roles WHERE id = 'r-x'").all();
    expect(roles.results).toHaveLength(0);
  });

  test('user.create: before kosong, after berisi snapshot lengkap dengan roleIds', async () => {
    await saveUser(
      env,
      { email: 'ani@gmail.com', name: 'Ani', status: 'active', assignments: everywhere('r-qc') },
      admin,
    );
    expect(await lastAudit()).toEqual({
      action: 'user.create',
      target: 'ani@gmail.com',
      before: null,
      after: {
        email: 'ani@gmail.com',
        name: 'Ani',
        status: 'active',
        assignments: { '*': ['r-qc'] },
      },
    });
  });

  test('user.update dan user.deactivate memuat snapshot sebelum dan sesudah', async () => {
    await saveUser(
      env,
      {
        id: 'u-budi',
        email: 'budi@gmail.com',
        name: 'Budi S',
        status: 'active',
        assignments: everywhere('r-qc'),
      },
      admin,
    );
    expect(await lastAudit()).toEqual({
      action: 'user.update',
      target: 'budi@gmail.com',
      before: {
        email: 'budi@gmail.com',
        name: 'Budi',
        status: 'active',
        assignments: { '*': ['r-qc', 'r-access'] },
      },
      after: {
        email: 'budi@gmail.com',
        name: 'Budi S',
        status: 'active',
        assignments: { '*': ['r-qc'] },
      },
    });
    await setUserStatus(env, { id: 'u-budi', status: 'inactive' }, admin);
    expect(await lastAudit()).toMatchObject({
      action: 'user.deactivate',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
  });

  test('role.update, role.create (before kosong), role.delete (after kosong)', async () => {
    await saveRole(
      env,
      { id: 'r-qc', name: 'QC Senior', description: 'Tim QC', permissions: { item: 'manage' } },
      admin,
    );
    expect(await lastAudit()).toEqual({
      action: 'role.update',
      target: 'QC Senior',
      before: { name: 'QC Staff', description: '', permissions: { item: 'edit' } },
      after: { name: 'QC Senior', description: 'Tim QC', permissions: { item: 'manage' } },
    });
    await saveRole(
      env,
      { name: 'Gudang', description: 'WH', permissions: { stock: 'view' } },
      admin,
    );
    expect(await lastAudit()).toEqual({
      action: 'role.create',
      target: 'Gudang',
      before: null,
      after: { name: 'Gudang', description: 'WH', permissions: { stock: 'view' } },
    });
    await removeRole(env, { id: 'r-kosong' }, admin);
    expect(await lastAudit()).toEqual({
      action: 'role.delete',
      target: 'Kosong',
      before: { name: 'Kosong', description: '', permissions: {} },
      after: null,
    });
  });
});

describe('lokasi', () => {
  beforeEach(async () => {
    await seedLocation(env, { id: 'l-bdg', code: 'BDG', name: 'Bandung' });
    await seedLocation(env, { id: 'l-jkt', code: 'JKT', name: 'Jakarta' });
  });

  test('listLocationDtos terurut menurut kode', async () => {
    expect((await listLocationDtos(env)).map((l) => l.code)).toEqual(['A', 'BDG', 'JKT', 'MATI']);
  });

  test('membuat lokasi: aktif, tercatat pelakunya, audit before kosong', async () => {
    const created = await saveLocation(env, { code: 'SBY', name: 'Surabaya' }, admin);
    expect(created).toMatchObject({
      code: 'SBY',
      status: 'active',
      updatedBy: 'admin@gmail.com',
      createdAt: '2026-10-08T00:00:00.000Z',
    });
    expect(await lastAudit()).toMatchObject({
      action: 'location.create',
      target: 'SBY',
      before: null,
      after: { code: 'SBY', name: 'Surabaya', status: 'active' },
    });
  });

  test('kode dan nama harus unik (nama tanpa membedakan huruf besar)', async () => {
    expect(
      await captureAppErrorAsync(() => saveLocation(env, { code: 'JKT', name: 'Lain' }, admin)),
    ).toMatchObject({ code: 'CONFLICT', fields: { code: 'Kode lokasi sudah dipakai' } });
    expect(
      await captureAppErrorAsync(() => saveLocation(env, { code: 'XXX', name: 'jakarta' }, admin)),
    ).toMatchObject({ code: 'CONFLICT', fields: { name: 'Nama lokasi sudah dipakai' } });
  });

  test('mengubah nama menyimpan snapshot; kode tidak dapat diubah; id tak dikenal NOT_FOUND', async () => {
    const updated = await saveLocation(
      env,
      { id: 'l-jkt', code: 'JKT', name: 'Jakarta Pusat' },
      admin,
    );
    expect(updated.name).toBe('Jakarta Pusat');
    expect(await lastAudit()).toMatchObject({
      action: 'location.update',
      before: { code: 'JKT', name: 'Jakarta', status: 'active' },
      after: { code: 'JKT', name: 'Jakarta Pusat', status: 'active' },
    });
    expect(
      await captureAppErrorAsync(() =>
        saveLocation(env, { id: 'l-jkt', code: 'JK2', name: 'Jakarta' }, admin),
      ),
    ).toMatchObject({ code: 'VALIDATION', fields: { code: 'Kode tidak dapat diubah' } });
    expect(
      (
        await captureAppErrorAsync(() =>
          saveLocation(env, { id: 'tidak-ada', code: 'ZZZ', name: 'Z' }, admin),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('nonaktifkan dan aktifkan lokasi tercatat; status sama tidak mencatat apa pun', async () => {
    expect((await setLocationStatus(env, { id: 'l-bdg', status: 'inactive' }, admin)).status).toBe(
      'inactive',
    );
    expect(await lastAudit()).toMatchObject({
      action: 'location.deactivate',
      target: 'BDG',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
    const count = (await auditRows()).length;
    await setLocationStatus(env, { id: 'l-bdg', status: 'inactive' }, admin);
    expect(await auditRows()).toHaveLength(count);
    expect((await setLocationStatus(env, { id: 'l-bdg', status: 'active' }, admin)).status).toBe(
      'active',
    );
    expect((await lastAudit()).action).toBe('location.activate');
    expect(
      (
        await captureAppErrorAsync(() =>
          setLocationStatus(env, { id: 'tidak-ada', status: 'active' }, admin),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('menonaktifkan lokasi mencabut akses lokasi itu pada permintaan berikutnya', async () => {
    await seedUser(env, {
      id: 'u-bdg',
      email: 'bdg@gmail.com',
      assignments: [{ locationId: 'l-bdg', roleIds: ['r-qc'] }],
    });
    await seedRole(env, { id: 'r-ho', name: 'ST', permissions: { handover: 'view' } });
    await env.DB.prepare(
      'UPDATE users SET assignments = \'[{"locationId":"l-bdg","roleIds":["r-ho"]}]\' WHERE id = \'u-bdg\'',
    ).run();
    expect(Object.keys((await contextOf('bdg@gmail.com')).locations)).toEqual(['l-bdg']);
    await setLocationStatus(env, { id: 'l-bdg', status: 'inactive' }, admin);
    expect(Object.keys((await contextOf('bdg@gmail.com')).locations)).toEqual([]);
  });
});

describe('audit.list (kursor)', () => {
  async function add(ts: string, action: string, target: string, before: unknown, after: unknown) {
    await writeAudit(env.DB, { ts, actor: 'admin@gmail.com', action, target, before, after }).run();
  }

  async function clear() {
    await env.DB.prepare('DELETE FROM audit_log').run();
  }

  test('terbaru dahulu dan mengurai snapshot', async () => {
    await clear();
    await add('2026-10-08T01:00:00.000Z', 'user.create', 'a@gmail.com', null, { name: 'A' });
    await add(
      '2026-10-08T03:00:00.000Z',
      'user.update',
      'a@gmail.com',
      { name: 'A' },
      { name: 'B' },
    );
    await add('2026-10-08T02:00:00.000Z', 'role.delete', 'QC', { name: 'QC' }, null);
    const page = await listAuditPage(env, {});
    expect(page.nextCursor).toBeNull();
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

  test('filter aksi persis dan kata kunci (target/pelaku) tanpa beda huruf besar', async () => {
    await clear();
    await add('2026-10-08T01:00:00.000Z', 'user.create', 'budi@gmail.com', null, { name: 'Budi' });
    await add('2026-10-08T02:00:00.000Z', 'role.create', 'Gudang', null, { name: 'Gudang' });
    expect((await listAuditPage(env, { action: 'role.create' })).entries).toHaveLength(1);
    expect((await listAuditPage(env, { query: 'BUDI' })).entries[0]?.target).toBe('budi@gmail.com');
    expect((await listAuditPage(env, { query: 'admin@' })).entries).toHaveLength(2);
    expect(
      (await listAuditPage(env, { action: 'user.create', query: 'gudang' })).entries,
    ).toHaveLength(0);
    // kata kunci panjang (> 50 byte) tidak terkena batas pola LIKE
    expect((await listAuditPage(env, { query: 'x'.repeat(100) })).entries).toHaveLength(0);
  });

  test('halaman berkursor: tanpa duplikat/lompatan walau ts sama, batas default 20', async () => {
    await clear();
    for (let index = 0; index < 120; index++) {
      // 3 baris berbagi ts yang sama
      const ts = new Date(Date.UTC(2026, 9, 8, 0, 0, Math.floor(index / 3))).toISOString();
      await add(ts, 'user.update', `u${index}@gmail.com`, { name: 'a' }, { name: 'b' });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listAuditPage(env, { limit: 50, ...(cursor ? { cursor } : {}) });
      seen.push(...page.entries.map((entry: AuditEntryDto) => entry.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect((await listAuditPage(env, {})).entries).toHaveLength(20);
    // urutan menurun menurut (ts, id)
    const ids = seen.map(Number);
    expect(ids.slice(0, 3)).toEqual([120, 119, 118]);
  });

  test('tidak jatuh bila sel before/after rusak atau bukan objek', async () => {
    await clear();
    await env.DB.prepare(
      "INSERT INTO audit_log (ts, actor, action, target, \"before\", \"after\") VALUES ('2026-10-08T01:00:00.000Z', 'x', 'user.update', 'a', '{rusak', '[1,2]'), ('2026-10-08T02:00:00.000Z', 'x', 'user.update', 'b', '', '\"teks\"')",
    ).run();
    const page = await listAuditPage(env, {});
    expect(page.entries.map((entry) => [entry.before, entry.after])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  test('CPU kasar: halaman audit dari 2.000 baris di bawah anggaran', async () => {
    await clear();
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 2000; index++) {
      statements.push(
        writeAudit(env.DB, {
          ts: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
          actor: 'admin@gmail.com',
          action: 'user.update',
          target: `u${index}@gmail.com`,
          before: { name: 'a' },
          after: { name: 'b' },
        }),
      );
      if (statements.length === 50) {
        await env.DB.batch(statements.splice(0));
      }
    }
    const { result, ms } = await measureCpu(() =>
      listAudit(env, {
        limit: 50,
        action: '',
        query: 'u19',
      }),
    );
    expect(result.entries.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(25);
  });
});

describe('izin rute access', () => {
  test('view boleh membaca, hanya manage boleh menulis; audit.list lewat RPC berkursor', async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat Akses', permissions: { access: 'view' } });
    await seedUser(env, { id: 'u-v', email: 'viewer@gmail.com', roleIds: ['r-view'] });
    const token = await signSessionToken(env, 'viewer@gmail.com', env.clock.now());
    const routes = getRoutes();
    const read = await callRoute(env, token, 'access.users.list', null, routes);
    expect(read.ok).toBe(true);
    const write = await callRoute(
      env,
      token,
      'access.locations.save',
      { code: 'ZZ', name: 'Zed' },
      routes,
    );
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe('FORBIDDEN');
    const audit = await callRoute(env, token, 'access.audit.list', { limit: 2 }, routes);
    expect(audit.ok).toBe(true);
    const bad = await callRoute(env, token, 'access.audit.list', { limit: 500 }, routes);
    expect(bad.ok).toBe(false);
  });
});
