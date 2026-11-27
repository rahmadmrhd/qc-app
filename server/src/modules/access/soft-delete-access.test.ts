// Soft delete (keputusan pemilik 9 dan 10): konteks akses mengabaikan pengguna/role/lokasi terhapus, sedangkan BU terhapus
// tetap memberi hak seperti BU nonaktif. Rancangan `docs/superpowers/specs/2026-11-20-soft-delete-design.md` §4.2.
import { beforeEach, describe, expect, test } from 'bun:test';
import { setItemStatus } from '@server/modules/item/service';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { canActOnAllBus } from '@shared/business-units';
import { loadActiveUserContexts, loadUserContext } from './context';

let env: TestEnv;

const DELETED_AT = '2026-02-02T00:00:00.000Z';

async function softDelete(table: string, id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE ${table} SET deleted_at = ?, deleted_by = 'admin@gmail.com' WHERE id = ?`,
  )
    .bind(DELETED_AT, id)
    .run();
}

async function ctxOf(email: string) {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
});

describe('pengguna terhapus', () => {
  beforeEach(async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { access: 'view' } });
    await seedUser(env, { id: 'u1', email: 'hapus@gmail.com', roleIds: ['r-view'] });
    await seedUser(env, { id: 'u2', email: 'hidup@gmail.com', roleIds: ['r-view'] });
  });

  test('loadUserContext = null (seperti nonaktif) dan keluar dari daftar pengguna aktif', async () => {
    expect(await loadUserContext(env, 'hapus@gmail.com')).not.toBeNull();
    await softDelete('users', 'u1');
    expect(await loadUserContext(env, 'hapus@gmail.com')).toBeNull();
    expect((await loadActiveUserContexts(env)).map((c) => c.email)).toEqual(['hidup@gmail.com']);
  });

  test('sesi yang sudah terbit ditolak UNAUTHENTICATED (status apa pun)', async () => {
    const before = await restCall(env, 'hapus@gmail.com', 'auth.me', null);
    expect(before.ok).toBe(true);
    await softDelete('users', 'u1');
    const after = await restCall(env, 'hapus@gmail.com', 'auth.me', null);
    expect(after.ok).toBe(false);
    expect((after as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    // juga bila statusnya nonaktif
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE id = 'u1'").run();
    const inactive = await restCall(env, 'hapus@gmail.com', 'auth.me', null);
    expect((inactive as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  test('pengguna baru beremail pengguna terhapus = CONFLICT (users_email tetap unik penuh)', async () => {
    await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { access: 'manage' } });
    await seedUser(env, { id: 'u-adm', email: 'adm@gmail.com', roleIds: ['r-manage'] });
    await softDelete('users', 'u1');
    const rest = restClient(env);
    const response = await rest.post('/users', {
      email: 'adm@gmail.com',
      body: {
        email: 'hapus@gmail.com',
        name: 'Baru',
        status: 'active',
        assignments: [],
        buAssignments: [],
      },
    });
    expect(response.status).toBe(409);
    expect(await jsonOf(response)).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('role terhapus', () => {
  test('izin role yang terhapus tidak berlaku walau masih tercantum di penugasan', async () => {
    await seedRole(env, { id: 'r-a', name: 'A', permissions: { access: 'view' } });
    await seedRole(env, { id: 'r-b', name: 'B', permissions: { handover: 'edit' } });
    await seedLocation(env, { id: 'l-1', code: 'L1' });
    await seedUser(env, {
      id: 'u1',
      email: 'u@gmail.com',
      assignments: [
        { locationId: null, roleIds: ['r-a'] },
        { locationId: 'l-1', roleIds: ['r-b'] },
      ],
    });
    const before = await ctxOf('u@gmail.com');
    expect(before.permissions.access).toBe('view');
    expect(before.locations['l-1']?.handover).toBe('edit');
    await softDelete('roles', 'r-a');
    await softDelete('roles', 'r-b');
    const after = await ctxOf('u@gmail.com');
    expect(after.permissions.access).toBe('none');
    expect(after.locations['l-1']).toBeUndefined();
    // juga pada jalur banyak pengguna
    const viaList = (await loadActiveUserContexts(env)).find((c) => c.email === 'u@gmail.com');
    expect(viaList?.permissions.access).toBe('none');
  });
});

describe('lokasi terhapus', () => {
  test('berperilaku sama dengan lokasi nonaktif: tak ada di locations (me.locations/locationIds)', async () => {
    await seedRole(env, { id: 'r-ho', name: 'ST', permissions: { handover: 'edit' } });
    await seedLocation(env, { id: 'l-ok', code: 'OK' });
    await seedLocation(env, { id: 'l-mati', code: 'MATI', status: 'inactive' });
    await seedLocation(env, { id: 'l-hapus', code: 'HAPUS' });
    await softDelete('locations', 'l-hapus');
    await seedUser(env, {
      id: 'u1',
      email: 'staf@gmail.com',
      assignments: [
        { locationId: 'l-ok', roleIds: ['r-ho'] },
        { locationId: 'l-mati', roleIds: ['r-ho'] },
        { locationId: 'l-hapus', roleIds: ['r-ho'] },
      ],
    });
    const ctx = await ctxOf('staf@gmail.com');
    expect(Object.keys(ctx.locations)).toEqual(['l-ok']);
    const me = await restCall(env, 'staf@gmail.com', 'auth.me', null);
    expect(
      (me as { data: { locations: { id: string }[] } }).data.locations.map((l) => l.id),
    ).toEqual(['l-ok']);
    // pemilihan "Semua lokasi" pun tak menyertakan lokasi terhapus (seperti nonaktif)
    await seedUser(env, { id: 'u2', email: 'semua@gmail.com', roleIds: ['r-ho'] });
    const everywhere = await ctxOf('semua@gmail.com');
    expect(Object.keys(everywhere.locations)).toEqual(['l-ok']);
    // super admin: lokasi terhapus seperti nonaktif
    const admin = await ctxOf('admin@gmail.com');
    expect(Object.keys(admin.locations).sort()).toEqual(['l-ok']);
  });
});

describe('BU terhapus', () => {
  beforeEach(async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
    await seedBusinessUnit(env, { id: 'bu-n', code: 'N', status: 'inactive' });
    await seedRole(env, { id: 'r-edit', name: 'Kelola', permissions: { item: 'manage' } });
    await seedBrand(env, 'Sony');
    await seedUser(env, {
      id: 'u-ea',
      email: 'ea@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
    });
    await seedUser(env, {
      id: 'u-eab',
      email: 'eab@gmail.com',
      buAssignments: [
        { buId: 'bu-a', roleIds: ['r-edit'] },
        { buId: 'bu-b', roleIds: ['r-edit'] },
        { buId: 'bu-n', roleIds: ['r-edit'] },
      ],
    });
    await seedItem(env, {
      id: 'i-ab',
      brand: 'Sony',
      model: 'AB',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    await seedItem(env, { id: 'i-b', brand: 'Sony', model: 'B', businessUnitIds: ['bu-b'] });
  });

  test('hak BU terhapus tetap sama seperti BU nonaktif; id tercatat di deletedBuIds', async () => {
    await softDelete('business_units', 'bu-b');
    const ctx = await ctxOf('eab@gmail.com');
    expect(ctx.businessUnits['bu-b']?.item).toBe('manage');
    expect(ctx.businessUnits['bu-n']?.item).toBe('manage');
    expect(ctx.deletedBuIds).toEqual(['bu-b']);
    expect((await ctxOf('ea@gmail.com')).deletedBuIds).toEqual(['bu-b']);
    // super admin tetap memegang semua BU, termasuk yang terhapus
    const admin = await ctxOf('admin@gmail.com');
    expect(Object.keys(admin.businessUnits).sort()).toEqual(['bu-a', 'bu-b', 'bu-n']);
  });

  test('me.businessUnits tetap memuat BU terhapus (sumber hak web) dengan penanda deleted; BU lain tak bertanda', async () => {
    await softDelete('business_units', 'bu-b');
    const me = await restCall(env, 'eab@gmail.com', 'auth.me', null);
    const list = (me as { data: { businessUnits: { id: string; deleted?: boolean }[] } }).data
      .businessUnits;
    expect(list.map((b) => [b.id, b.deleted])).toEqual([
      ['bu-a', false],
      ['bu-b', true],
      ['bu-n', false],
    ]);
  });

  test('me.deletedBusinessUnitIds memuat SEMUA BU terhapus, juga yang bukan penugasan pengguna (web mengenalinya)', async () => {
    await softDelete('business_units', 'bu-b');
    const me = await restCall(env, 'ea@gmail.com', 'auth.me', null);
    const body = (
      me as { data: { businessUnits: { id: string }[]; deletedBusinessUnitIds: string[] } }
    ).data;
    expect(body.businessUnits.map((b) => b.id)).toEqual(['bu-a']);
    expect(body.deletedBusinessUnitIds).toEqual(['bu-b']);
  });

  test('item yang hanya ber-BU terhapus tetap dapat diubah oleh pemegang hak BU itu', async () => {
    await softDelete('business_units', 'bu-b');
    const user = await ctxOf('eab@gmail.com');
    const dto = await setItemStatus(env, { id: 'i-b', status: 'inactive' }, user);
    expect(dto.status).toBe('inactive');
  });

  test('tulis item ber-BU {terhapus, hidup}: cukup level pada BU hidup', async () => {
    const editorA = await ctxOf('ea@gmail.com');
    // sebelum penghapusan: butuh level pada SEMUA BU (A dan B)
    const denied = await captureAppErrorAsync(() =>
      setItemStatus(env, { id: 'i-ab', status: 'inactive' }, editorA),
    );
    expect(denied.code).toBe('FORBIDDEN');
    await softDelete('business_units', 'bu-b');
    const after = await ctxOf('ea@gmail.com');
    const dto = await setItemStatus(env, { id: 'i-ab', status: 'inactive' }, after);
    expect(dto.status).toBe('inactive');
  });

  test('BU nonaktif (bukan terhapus) tetap dihitung pada syarat SEMUA BU', async () => {
    await seedItem(env, {
      id: 'i-an',
      brand: 'Sony',
      model: 'AN',
      businessUnitIds: ['bu-a', 'bu-n'],
    });
    const editorA = await ctxOf('ea@gmail.com');
    const denied = await captureAppErrorAsync(() =>
      setItemStatus(env, { id: 'i-an', status: 'inactive' }, editorA),
    );
    expect(denied.code).toBe('FORBIDDEN');
  });
});

describe('canActOnAllBus dengan BU terhapus', () => {
  const none = {
    item: 'none',
    serial: 'none',
    serialservice: 'none',
    serialwh: 'none',
    countrylock: 'none',
  } as const;
  const edit = { ...none, item: 'edit' } as const;

  test('mengabaikan BU terhapus selama masih ada BU hidup; semuanya terhapus = berlaku atas semuanya', () => {
    const byBu = { A: edit, B: none };
    expect(canActOnAllBus(byBu, 'item', 'edit', ['A', 'B'])).toBe(false);
    expect(canActOnAllBus(byBu, 'item', 'edit', ['A', 'B'], ['B'])).toBe(true);
    expect(canActOnAllBus(byBu, 'item', 'edit', ['B'], ['B'])).toBe(false);
    expect(canActOnAllBus({ B: edit }, 'item', 'edit', ['B'], ['B'])).toBe(true);
    expect(canActOnAllBus(byBu, 'item', 'edit', [], ['B'])).toBe(false);
  });
});
