import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location, role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { UserContext } from './context';
import { loadUserContext_ } from './context';
import { insertLocation_, insertRole_, insertUser_ } from './repo';
import {
  listRoleDtos_,
  listUserDtos_,
  removeRole_,
  saveRole_,
  saveUser_,
  setUserStatus_,
} from './service';

const everywhere = (...roleIds: string[]) => [{ locationId: null, roleIds }];

let platform: MemoryPlatform;
let admin: UserContext;

function contextOf(email: string): UserContext {
  const ctx = loadUserContext_(email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com' },
    now: () => Date.parse('2026-10-08T00:00:00.000Z'),
  });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-qc', name: 'QC Staff', permissions: { item: 'edit' } }));
  insertRole_(role({ id: 'r-access', name: 'Admin Akses', permissions: { access: 'manage' } }));
  insertRole_(role({ id: 'r-kosong', name: 'Kosong' }));
  insertUser_(
    user({ id: 'u-budi', email: 'budi@gmail.com', name: 'Budi', roleIds: ['r-qc', 'r-access'] }),
  );
  insertLocation_(location({ id: 'l-a', code: 'A', name: 'Cabang A' }));
  insertLocation_(location({ id: 'l-mati', code: 'MATI', name: 'Mati', status: 'inactive' }));
  admin = contextOf('admin@gmail.com');
});

test('membuat user baru, mencatat audit, dan langsung berlaku untuk login', () => {
  expect(loadUserContext_('ani@gmail.com')).toBeNull();
  const created = saveUser_(
    { email: 'ani@gmail.com', name: 'Ani', status: 'active', assignments: everywhere('r-qc') },
    admin,
  );
  expect(created).toMatchObject({
    email: 'ani@gmail.com',
    updatedBy: 'admin@gmail.com',
    updatedAt: '2026-10-08T00:00:00.000Z',
  });
  expect(listUserDtos_().map((u) => u.email)).toEqual(['ani@gmail.com', 'budi@gmail.com']);
  expect(platform.db.sheet('audit_log').rows[1]?.[2]).toBe('user.create');
  expect(loadUserContext_('ani@gmail.com')?.permissions.item).toBe('edit');
});

test('menolak email yang sudah terdaftar walau beda huruf besar', () => {
  const error = captureAppError(() =>
    saveUser_({ email: ' BUDI@Gmail.com ', name: 'B', status: 'active', assignments: [] }, admin),
  );
  expect(error).toMatchObject({ code: 'CONFLICT', fields: { email: 'Email sudah terdaftar' } });
});

test('menolak role yang tidak dikenal', () => {
  const error = captureAppError(() =>
    saveUser_(
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

test('email tidak dapat diubah saat edit', () => {
  const error = captureAppError(() =>
    saveUser_(
      { id: 'u-budi', email: 'baru@gmail.com', name: 'Budi', status: 'active', assignments: [] },
      admin,
    ),
  );
  expect(error.code).toBe('VALIDATION');
});

test('admin tidak bisa menonaktifkan akun sendiri', () => {
  const budi = contextOf('budi@gmail.com');
  const viaSave = captureAppError(() =>
    saveUser_(
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
    captureAppError(() => setUserStatus_({ id: 'u-budi', status: 'inactive' }, budi)).code,
  ).toBe('CONFLICT');
});

test('menonaktifkan user lain langsung mencabut aksesnya', () => {
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  expect(setUserStatus_({ id: 'u-budi', status: 'inactive' }, admin).status).toBe('inactive');
  expect(loadUserContext_('budi@gmail.com')).toBeNull();
});

test('nama berawalan = disimpan dan dibaca kembali sebagai teks literal', () => {
  saveUser_(
    { email: 'ani@gmail.com', name: '=HYPERLINK("http://x")', status: 'active', assignments: [] },
    admin,
  );
  expect(listUserDtos_().find((u) => u.email === 'ani@gmail.com')?.name).toBe(
    '=HYPERLINK("http://x")',
  );
});

test('nama role unik tanpa membedakan huruf besar', () => {
  const error = captureAppError(() =>
    saveRole_({ name: 'qc staff', description: '', permissions: {} }, admin),
  );
  expect(error).toMatchObject({ code: 'CONFLICT', fields: { name: 'Nama role sudah dipakai' } });
});

test('perubahan permission role langsung memengaruhi user', () => {
  saveRole_(
    {
      id: 'r-qc',
      name: 'QC Staff',
      description: '',
      permissions: { item: 'manage', stock: 'none' },
    },
    admin,
  );
  expect(loadUserContext_('budi@gmail.com')?.permissions.item).toBe('manage');
});

test('role yang dipakai tidak bisa dihapus; role kosong terhapus dan tercatat di audit', () => {
  expect(captureAppError(() => removeRole_({ id: 'r-qc' }, admin)).code).toBe('CONFLICT');
  expect(removeRole_({ id: 'r-kosong' }, admin)).toEqual({ id: 'r-kosong' });
  expect(listRoleDtos_().map((r) => r.id)).not.toContain('r-kosong');
  expect(platform.db.sheet('audit_log').rows.at(-1)?.[2]).toBe('role.delete');
});

function lastAudit(): { action: string; target: string; before: unknown; after: unknown } {
  const [header = [], ...rows] = platform.db.sheet('audit_log').rows;
  const row = rows.at(-1);
  if (!row) throw new Error('audit_log kosong');
  const cell = (name: string): string => String(row[header.indexOf(name)] ?? '');
  return {
    action: cell('action'),
    target: cell('target'),
    before: JSON.parse(cell('before')),
    after: JSON.parse(cell('after')),
  };
}

test('audit user.create: before kosong, after berisi snapshot lengkap dengan roleIds', () => {
  saveUser_(
    { email: 'ani@gmail.com', name: 'Ani', status: 'active', assignments: everywhere('r-qc') },
    admin,
  );
  expect(lastAudit()).toEqual({
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

test('audit user.update: before dan after memuat semua field, roleIds tetap berupa id', () => {
  saveUser_(
    {
      id: 'u-budi',
      email: 'budi@gmail.com',
      name: 'Budi S',
      status: 'active',
      assignments: everywhere('r-qc'),
    },
    admin,
  );
  expect(lastAudit()).toEqual({
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
});

test('audit user.deactivate: snapshot sebelum dan sesudah, bukan null', () => {
  setUserStatus_({ id: 'u-budi', status: 'inactive' }, admin);
  expect(lastAudit()).toEqual({
    action: 'user.deactivate',
    target: 'budi@gmail.com',
    before: {
      email: 'budi@gmail.com',
      name: 'Budi',
      status: 'active',
      assignments: { '*': ['r-qc', 'r-access'] },
    },
    after: {
      email: 'budi@gmail.com',
      name: 'Budi',
      status: 'inactive',
      assignments: { '*': ['r-qc', 'r-access'] },
    },
  });
});

test('audit role.update: perubahan nama dan deskripsi ikut tercatat, bukan hanya permission', () => {
  saveRole_(
    {
      id: 'r-qc',
      name: 'QC Senior',
      description: 'Tim QC',
      permissions: { item: 'manage' },
    },
    admin,
  );
  expect(lastAudit()).toEqual({
    action: 'role.update',
    target: 'QC Senior',
    before: { name: 'QC Staff', description: '', permissions: { item: 'edit' } },
    after: { name: 'QC Senior', description: 'Tim QC', permissions: { item: 'manage' } },
  });
});

test('audit role.create: before kosong; role.delete: after kosong', () => {
  saveRole_({ name: 'Gudang', description: 'WH', permissions: { stock: 'view' } }, admin);
  expect(lastAudit()).toEqual({
    action: 'role.create',
    target: 'Gudang',
    before: null,
    after: { name: 'Gudang', description: 'WH', permissions: { stock: 'view' } },
  });
  removeRole_({ id: 'r-kosong' }, admin);
  expect(lastAudit()).toEqual({
    action: 'role.delete',
    target: 'Kosong',
    before: { name: 'Kosong', description: '', permissions: {} },
    after: null,
  });
});

test('listRoleDtos_ menyertakan jumlah user per role, terurut nama', () => {
  expect(listRoleDtos_().map((r) => [r.name, r.userCount])).toEqual([
    ['Admin Akses', 1],
    ['Kosong', 0],
    ['QC Staff', 1],
  ]);
});

test('menyimpan penugasan per lokasi dan menghitung userCount role dari semua penugasan', () => {
  saveUser_(
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
  const ani = listUserDtos_().find((u) => u.email === 'ani@gmail.com');
  expect(ani?.assignments).toEqual([
    { locationId: null, roleIds: ['r-qc'] },
    { locationId: 'l-a', roleIds: ['r-access'] },
  ]);
  expect(listRoleDtos_().find((r) => r.id === 'r-access')?.userCount).toBe(2);
  expect(lastAudit()).toMatchObject({
    action: 'user.create',
    after: { assignments: { '*': ['r-qc'], 'l-a': ['r-access'] } },
  });
});

test('menolak lokasi yang tidak dikenal atau tidak aktif pada penugasan baru', () => {
  for (const locationId of ['tidak-ada', 'l-mati']) {
    const error = captureAppError(() =>
      saveUser_(
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

test('penugasan lama pada lokasi yang kini nonaktif tetap boleh dipertahankan saat edit', () => {
  insertUser_(
    user({
      id: 'u-lama',
      email: 'lama@gmail.com',
      assignments: [{ locationId: 'l-mati', roleIds: ['r-qc'] }],
    }),
  );
  const saved = saveUser_(
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

test('admin non-super tidak dapat menghilangkan akses Kelola global miliknya sendiri (FR-AS5)', () => {
  insertUser_(
    user({
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    }),
  );
  const pusat = contextOf('pusat@gmail.com');
  const error = captureAppError(() =>
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [{ locationId: 'l-a', roleIds: ['r-access'] }],
      },
      pusat,
    ),
  );
  expect(error.code).toBe('CONFLICT');
  expect(
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [{ locationId: null, roleIds: ['r-access', 'r-qc'] }],
      },
      pusat,
    ).assignments[0]?.roleIds,
  ).toEqual(['r-access', 'r-qc']);
  // Super admin boleh mengubah penugasan siapa pun, termasuk miliknya.
  expect(
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [],
      },
      admin,
    ).assignments,
  ).toEqual([]);
});

test('admin non-super tidak dapat menurunkan role yang memberi Kelola global miliknya sendiri', () => {
  insertUser_(
    user({
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    }),
  );
  const pusat = contextOf('pusat@gmail.com');
  const error = captureAppError(() =>
    saveRole_(
      { id: 'r-access', name: 'Admin Akses', description: '', permissions: { access: 'view' } },
      pusat,
    ),
  );
  expect(error.code).toBe('CONFLICT');
  expect(listRoleDtos_().find((r) => r.id === 'r-access')?.permissions).toEqual({
    access: 'manage',
  });
  // Mengubah hal lain pada role itu tetap boleh, dan super admin tidak dibatasi.
  expect(
    saveRole_(
      { id: 'r-access', name: 'Admin Akses 2', description: '', permissions: { access: 'manage' } },
      pusat,
    ).name,
  ).toBe('Admin Akses 2');
  expect(
    saveRole_(
      { id: 'r-access', name: 'Admin Akses 2', description: '', permissions: { access: 'view' } },
      admin,
    ).permissions,
  ).toEqual({ access: 'view' });
});
