// Hapus lunak customer (redesain fase 4c, spek soft delete §4): batch status, hapus, pulihkan, dan hubungan dengan
// Serah Terima (customer terhapus tidak disarankan dan tidak dipakai ulang; task lama tetap menampilkan namanya).
import { beforeEach, describe, expect, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { captureAppErrorAsync } from '@server-test/errors';
import { callRest, ENV, seedHandoverEnv } from '@server-test/handover-env';
import { seedCustomer } from '@server-test/item-fixtures';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  getCustomerDto,
  listCustomerDtos,
  removeCustomer,
  removeCustomerBatch,
  restoreCustomer,
  restoreCustomerBatch,
  setCustomerStatus,
  setCustomerStatusBatch,
} from './service';

let env: TestEnv;
let admin: UserContext;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

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
  await seedHandoverEnv(env);
  admin = await ctxOf('admin@gmail.com');
});

describe('customers: ubah status massal', () => {
  test('audit per customer membawa target_id; status sama = tanpa audit; id asing membatalkan semuanya', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Satu' });
    await seedCustomer(env, { id: 'c2', name: 'PT Dua' });
    const result = await setCustomerStatusBatch(
      env,
      { ids: ['c1', 'c2'], status: 'inactive' },
      admin,
    );
    expect(result.items.map((customer) => customer.status)).toEqual(['inactive', 'inactive']);
    expect((await auditRows('customer.deactivate')).map((row) => row.target_id).sort()).toEqual([
      'c1',
      'c2',
    ]);
    await setCustomerStatusBatch(env, { ids: ['c1'], status: 'inactive' }, admin);
    expect((await auditRows('customer.deactivate')).length).toBe(2);
    const error = await captureAppErrorAsync(() =>
      setCustomerStatusBatch(env, { ids: ['c1', 'tidak-ada'], status: 'active' }, admin),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect((await listCustomerDtos(env, { status: 'active' }, admin)).length).toBe(0);
  });
});

describe('customers: hapus dan pulihkan', () => {
  test('customer Aktif ditolak dengan pesan tetap; Nonaktif dapat dihapus dan hilang dari daftar bawaan', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Satu' });
    const error = await captureAppErrorAsync(() => removeCustomer(env, { id: 'c1' }, admin));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Nonaktifkan customer dulu sebelum dihapus');
    const mixed = await captureAppErrorAsync(() =>
      removeCustomerBatch(env, { ids: ['c1'] }, admin),
    );
    expect(mixed.message).toBe('Nonaktifkan customer dulu sebelum dihapus');
    await setCustomerStatus(env, { id: 'c1', status: 'inactive' }, admin);
    expect(await removeCustomerBatch(env, { ids: ['c1'] }, admin)).toEqual({ ids: ['c1'] });
    expect(await auditRows('customer.delete')).toEqual([{ target: 'PT Satu', target_id: 'c1' }]);
    expect(await listCustomerDtos(env, null, admin)).toEqual([]);
    const deleted = await listCustomerDtos(env, { status: 'deleted' }, admin);
    expect(deleted.map((customer) => customer.id)).toEqual(['c1']);
    expect(deleted[0]?.deleted?.deletedBy).toBe('admin@gmail.com');
  });

  test('status=deleted dan get customer terhapus hanya bagi item: manage', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Satu', status: 'inactive' });
    await removeCustomer(env, { id: 'c1' }, admin);
    const viewer = await ctxOf('noaccess@gmail.com');
    expect(
      (await captureAppErrorAsync(() => listCustomerDtos(env, { status: 'deleted' }, viewer))).code,
    ).toBe('FORBIDDEN');
    expect((await captureAppErrorAsync(() => getCustomerDto(env, { id: 'c1' }, viewer))).code).toBe(
      'NOT_FOUND',
    );
    expect((await getCustomerDto(env, { id: 'c1' }, admin)).deleted).toBeDefined();
  });

  test('hapus ulang = sukses tanpa audit baru; pulihkan = Nonaktif, ulang = tanpa audit baru', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Satu', status: 'inactive' });
    await removeCustomer(env, { id: 'c1' }, admin);
    await removeCustomer(env, { id: 'c1' }, admin);
    expect((await auditRows('customer.delete')).length).toBe(1);
    const restored = await restoreCustomer(env, { id: 'c1' }, admin);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    await restoreCustomerBatch(env, { ids: ['c1'] }, admin);
    expect((await auditRows('customer.restore')).length).toBe(1);
  });

  test('pulihkan customer yang namanya kini dipakai customer hidup = CONFLICT', async () => {
    await withoutOldIndex(env, 'customers', 'customers_key', '`key`', async () => {
      await seedCustomer(env, { id: 'c-lama', name: 'PT Kembar', status: 'inactive' });
      await removeCustomer(env, { id: 'c-lama' }, admin);
      await seedCustomer(env, { id: 'c-baru', name: 'PT Kembar' });
      const error = await captureAppErrorAsync(() => restoreCustomer(env, { id: 'c-lama' }, admin));
      expect(error.code).toBe('CONFLICT');
    });
  });
});

describe('customer terhapus dan Serah Terima', () => {
  test('tak muncul di saran form task; task lama tetap menampilkan nama customernya', async () => {
    const created = await call('wh@gmail.com', 'handovers.save', {
      locationId: ENV.locA,
      customerName: 'PT Hapus',
      note: 'x',
    });
    expect(created.ok).toBe(true);
    const customerId = created.data.customerId as string;
    await setCustomerStatus(env, { id: customerId, status: 'inactive' }, admin);
    await removeCustomer(env, { id: customerId }, admin);
    const options = await call('wh@gmail.com', 'handovers.options', { locationIds: [ENV.locA] });
    expect(options.data.customers.map((c: { name: string }) => c.name)).not.toContain('PT Hapus');
    expect(options.data.inactiveCustomerNames).not.toContain('PT Hapus');
    const task = await call('wh@gmail.com', 'handovers.get', {
      id: created.data.id,
      locationIds: [ENV.locA],
    });
    expect(task.data.customerName).toBe('PT Hapus');
  });

  test('menyimpan task dengan nama customer terhapus membuat customer baru (nama dipakai ulang)', async () => {
    await withoutOldIndex(env, 'customers', 'customers_key', '`key`', async () => {
      await seedCustomer(env, { id: 'c-lama', name: 'PT Ulang', status: 'inactive' });
      await removeCustomer(env, { id: 'c-lama' }, admin);
      const created = await call('wh@gmail.com', 'handovers.save', {
        locationId: ENV.locA,
        customerName: 'PT Ulang',
        note: 'x',
      });
      expect(created.ok).toBe(true);
      expect(created.data.customerId).not.toBe('c-lama');
      expect((await listCustomerDtos(env, null, admin)).map((c) => c.name)).toEqual(['PT Ulang']);
    });
  });
});
