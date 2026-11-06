import { beforeEach, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { seedCustomer } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { listCustomers } from './repo';
import {
  listCustomerDtos,
  planCustomerByName,
  renameCustomer,
  resolveCustomerByName,
  setCustomerStatus,
} from './service';
import {
  validateCustomerName,
  validateRenameCustomer,
  validateSetCustomerStatus,
} from './validate';

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

async function lastAudit() {
  const row = await env.DB.prepare(
    'SELECT action, target, `before`, `after` FROM audit_log ORDER BY id DESC LIMIT 1',
  ).first<{ action: string; target: string; before: string; after: string }>();
  if (!row) throw new Error('audit kosong');
  return {
    action: row.action,
    target: row.target,
    before: JSON.parse(row.before) as unknown,
    after: JSON.parse(row.after) as unknown,
  };
}

const auditCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n;

test('resolveCustomerByName membuat customer baru, mengaudit, dan memakai ulang ejaan resmi untuk varian', async () => {
  const created = await resolveCustomerByName(env, 'PT Maju Jaya', admin);
  expect(created).toMatchObject({ name: 'PT Maju Jaya', status: 'active' });
  expect(await lastAudit()).toMatchObject({
    action: 'customer.create',
    target: 'PT Maju Jaya',
    before: null,
  });
  const again = await resolveCustomerByName(env, ' pt. MAJU  jaya ', admin);
  expect(again.id).toBe(created.id);
  expect(again.name).toBe('PT Maju Jaya');
  expect(await listCustomers(env)).toHaveLength(1);
});

test('customer nonaktif tidak dipakai untuk task baru, kecuali task itu sudah memakainya', async () => {
  await seedCustomer(env, { id: 'c1', name: 'Lama', key: 'lama', status: 'inactive' });
  const error = await captureAppErrorAsync(() => resolveCustomerByName(env, 'lama', admin));
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    customerName: 'Customer dinonaktifkan; aktifkan dulu di halaman Customer',
  });
  expect((await resolveCustomerByName(env, 'lama', admin, 'c1')).id).toBe('c1');
});

test('dua task membuat customer yang sama bersamaan: hanya satu baris, keduanya mendapat id yang sama', async () => {
  const [a, b] = await Promise.all([
    resolveCustomerByName(env, 'PT Kembar', admin),
    resolveCustomerByName(env, 'pt kembar', admin),
  ]);
  expect(a.id).toBe(b.id);
  expect(await listCustomers(env)).toHaveLength(1);
  expect(await auditCount()).toBe(1);
});

test('planCustomerByName: pernyataan penyisipan + audit digabung ke batch pemanggil', async () => {
  const plan = await planCustomerByName(env, 'PT Baru', admin);
  expect(plan.statements).toHaveLength(2);
  expect(await listCustomers(env)).toHaveLength(0);
  await env.DB.batch(plan.statements);
  expect(await listCustomers(env)).toHaveLength(1);
});

test('daftar customer terurut nama; rename: unik, no-op tanpa audit, audit customer.rename', async () => {
  await seedCustomer(env, { id: 'cz', name: 'Zeta', key: 'zeta' });
  await seedCustomer(env, { id: 'ca', name: 'Alfa', key: 'alfa' });
  expect((await listCustomerDtos(env)).map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
  expect(
    (await captureAppErrorAsync(() => renameCustomer(env, { id: 'ca', name: 'zeta' }, admin)))
      .fields,
  ).toEqual({ name: 'Nama customer sudah dipakai' });
  const before = await auditCount();
  expect((await renameCustomer(env, { id: 'ca', name: 'Alfa' }, admin)).name).toBe('Alfa');
  expect(await auditCount()).toBe(before);
  expect((await renameCustomer(env, { id: 'ca', name: 'ALFA' }, admin)).name).toBe('ALFA');
  expect(await lastAudit()).toMatchObject({
    action: 'customer.rename',
    before: { name: 'Alfa' },
    after: { name: 'ALFA' },
  });
  expect(
    (await captureAppErrorAsync(() => renameCustomer(env, { id: 'x', name: 'Z' }, admin))).code,
  ).toBe('NOT_FOUND');
});

test('nonaktifkan/aktifkan dicatat; status sama tanpa audit; id tak dikenal NOT_FOUND', async () => {
  await seedCustomer(env, { id: 'ca', name: 'Alfa', key: 'alfa' });
  await setCustomerStatus(env, { id: 'ca', status: 'inactive' }, admin);
  expect((await lastAudit()).action).toBe('customer.deactivate');
  const before = await auditCount();
  await setCustomerStatus(env, { id: 'ca', status: 'inactive' }, admin);
  expect(await auditCount()).toBe(before);
  await setCustomerStatus(env, { id: 'ca', status: 'active' }, admin);
  expect((await lastAudit()).action).toBe('customer.activate');
  expect(
    (await captureAppErrorAsync(() => setCustomerStatus(env, { id: 'x', status: 'active' }, admin)))
      .code,
  ).toBe('NOT_FOUND');
});

test('singkatan bertitik dan tanpa titik adalah customer yang sama (kunci membuang tanda baca)', async () => {
  const first = await resolveCustomerByName(env, 'C.V. Abadi', admin);
  const second = await resolveCustomerByName(env, 'CV Abadi', admin);
  expect(second.id).toBe(first.id);
  expect(second.name).toBe('C.V. Abadi');
  expect(await listCustomers(env)).toHaveLength(1);
  await seedCustomer(env, { id: 'cl', name: 'Lain', key: 'lain' });
  expect(
    (await captureAppErrorAsync(() => renameCustomer(env, { id: 'cl', name: 'c.v abadi' }, admin)))
      .fields,
  ).toEqual({ name: 'Nama customer sudah dipakai' });
});

test('validator nama customer, rename, dan status', () => {
  expect(validateCustomerName({ customerName: '  PT A ' }, 'customerName')).toBe('PT A');
  expect(
    captureAppError(() => validateCustomerName({ customerName: '' }, 'customerName')).fields,
  ).toEqual({ customerName: 'Wajib diisi' });
  expect(
    captureAppError(() => validateCustomerName({ customerName: '--' }, 'customerName')).fields,
  ).toEqual({ customerName: 'Nama customer harus memuat huruf atau angka' });
  expect(
    captureAppError(() => validateCustomerName({ customerName: 'x'.repeat(101) }, 'customerName'))
      .fields,
  ).toEqual({ customerName: 'Maksimal 100 karakter' });
  expect(validateRenameCustomer({ id: 'c1', name: ' B ' })).toEqual({ id: 'c1', name: 'B' });
  expect(captureAppError(() => validateRenameCustomer({ id: '', name: '' })).fields).toEqual({
    id: 'Wajib diisi',
    name: 'Wajib diisi',
  });
  expect(validateSetCustomerStatus({ id: 'c1', status: 'inactive' })).toEqual({
    id: 'c1',
    status: 'inactive',
  });
});

test('izin rute customer: list = item view; rename dan setStatus = item manage', () => {
  const routes = getRoutes();
  expect(routes['customers.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['customers.rename'].permission).toEqual({ module: 'item', level: 'manage' });
  expect(routes['customers.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
});

test('kunci customer di tingkat layanan: Sony, "sony ", "SONY " satu customer; Sone dan Soné berbeda', async () => {
  const first = await resolveCustomerByName(env, 'Sony', admin);
  for (const variant of ['sony ', ' SONY ']) {
    expect((await resolveCustomerByName(env, variant, admin)).id).toBe(first.id);
  }
  const sone = await resolveCustomerByName(env, 'Sone', admin);
  const soneAccent = await resolveCustomerByName(env, 'Soné', admin);
  expect(new Set([first.id, sone.id, soneAccent.id]).size).toBe(3);
  expect((await listCustomers(env)).map((c) => c.key).sort()).toEqual(['sone', 'sony', 'soné']);
});

test('dua rename serentak ke nama yang sama: satu berhasil, satu CONFLICT lewat indeks customers_key', async () => {
  await seedCustomer(env, { id: 'c1', name: 'Satu', key: 'satu' });
  await seedCustomer(env, { id: 'c2', name: 'Dua', key: 'dua' });
  const results = await Promise.allSettled([
    renameCustomer(env, { id: 'c1', name: 'Baru' }, admin),
    renameCustomer(env, { id: 'c2', name: 'Baru' }, admin),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({
    code: 'CONFLICT',
    fields: { name: 'Nama customer sudah dipakai' },
  });
  expect((await listCustomers(env)).filter((c) => c.name === 'Baru')).toHaveLength(1);
});
