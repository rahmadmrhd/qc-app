import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import { captureAppError } from '@gas-test/errors';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertCustomer_, listCustomers_ } from './repo';
import {
  listCustomerDtos_,
  renameCustomer_,
  resolveCustomerByName_,
  setCustomerStatus_,
} from './service';
import {
  validateCustomerName_,
  validateRenameCustomer_,
  validateSetCustomerStatus_,
} from './validate';

let admin: UserContext;

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T00:00:00.000Z'),
    }),
  );
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const lastAudit = () => {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
};

const base = (name: string, over: Partial<Parameters<typeof insertCustomer_>[0]> = {}) => ({
  id: `c-${name.toLowerCase().split(' ').join('-')}`,
  name,
  key: name.toLowerCase().split(' ').join(' '),
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'seed',
  ...over,
});

test('resolveCustomerByName_ membuat customer baru, mengaudit, dan memakai ulang ejaan resmi untuk varian', () => {
  const created = resolveCustomerByName_('PT Maju Jaya', admin);
  expect(created).toMatchObject({ name: 'PT Maju Jaya', status: 'active' });
  expect(lastAudit()).toMatchObject({
    action: 'customer.create',
    target: 'PT Maju Jaya',
    before: null,
  });
  const again = resolveCustomerByName_(' pt. MAJU  jaya ', admin);
  expect(again.id).toBe(created.id);
  expect(again.name).toBe('PT Maju Jaya');
  expect(listCustomers_()).toHaveLength(1);
});

test('customer nonaktif tidak dipakai untuk task baru (pesan di customerName), kecuali task itu sudah memakainya', () => {
  insertCustomer_(base('Lama', { id: 'c1', key: 'lama', status: 'inactive' }));
  const error = captureAppError(() => resolveCustomerByName_('lama', admin));
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    customerName: 'Customer dinonaktifkan; aktifkan dulu di halaman Customer',
  });
  expect(resolveCustomerByName_('lama', admin, 'c1').id).toBe('c1');
});

test('daftar customer terurut nama; rename: unik, no-op tanpa audit, audit customer.rename', () => {
  insertCustomer_(base('Zeta', { id: 'cz', key: 'zeta' }));
  insertCustomer_(base('Alfa', { id: 'ca', key: 'alfa' }));
  expect(listCustomerDtos_().map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
  expect(captureAppError(() => renameCustomer_({ id: 'ca', name: 'zeta' }, admin)).fields).toEqual({
    name: 'Nama customer sudah dipakai',
  });
  const before = listAuditRecords_().length;
  expect(renameCustomer_({ id: 'ca', name: 'Alfa' }, admin).name).toBe('Alfa');
  expect(listAuditRecords_()).toHaveLength(before);
  expect(renameCustomer_({ id: 'ca', name: 'ALFA' }, admin).name).toBe('ALFA'); // kapitalisasi milik sendiri boleh
  expect(lastAudit()).toMatchObject({
    action: 'customer.rename',
    before: { name: 'Alfa' },
    after: { name: 'ALFA' },
  });
  expect(captureAppError(() => renameCustomer_({ id: 'x', name: 'Z' }, admin)).code).toBe(
    'NOT_FOUND',
  );
});

test('nonaktifkan/aktifkan dicatat; status sama tanpa audit; id tak dikenal NOT_FOUND', () => {
  insertCustomer_(base('Alfa', { id: 'ca', key: 'alfa' }));
  setCustomerStatus_({ id: 'ca', status: 'inactive' }, admin);
  expect(lastAudit().action).toBe('customer.deactivate');
  const before = listAuditRecords_().length;
  setCustomerStatus_({ id: 'ca', status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(before);
  setCustomerStatus_({ id: 'ca', status: 'active' }, admin);
  expect(lastAudit().action).toBe('customer.activate');
  expect(captureAppError(() => setCustomerStatus_({ id: 'x', status: 'active' }, admin)).code).toBe(
    'NOT_FOUND',
  );
});

test('validator nama customer, rename, dan status', () => {
  expect(validateCustomerName_({ customerName: '  PT A ' }, 'customerName')).toBe('PT A');
  expect(
    captureAppError(() => validateCustomerName_({ customerName: '' }, 'customerName')).fields,
  ).toEqual({
    customerName: 'Wajib diisi',
  });
  expect(
    captureAppError(() => validateCustomerName_({ customerName: '--' }, 'customerName')).fields,
  ).toEqual({
    customerName: 'Nama customer harus memuat huruf atau angka',
  });
  expect(
    captureAppError(() => validateCustomerName_({ customerName: 'x'.repeat(101) }, 'customerName'))
      .fields,
  ).toEqual({
    customerName: 'Maksimal 100 karakter',
  });
  expect(validateRenameCustomer_({ id: 'c1', name: ' B ' })).toEqual({ id: 'c1', name: 'B' });
  expect(captureAppError(() => validateRenameCustomer_({ id: '', name: '' })).fields).toEqual({
    id: 'Wajib diisi',
    name: 'Wajib diisi',
  });
  expect(validateSetCustomerStatus_({ id: 'c1', status: 'inactive' })).toEqual({
    id: 'c1',
    status: 'inactive',
  });
});

test('izin rute customer: list = item view; rename dan setStatus = item manage', () => {
  const routes = getRoutes_();
  expect(routes['customers.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['customers.rename'].permission).toEqual({ module: 'item', level: 'manage' });
  expect(routes['customers.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
});

test('singkatan bertitik dan tanpa titik adalah customer yang sama (kunci membuang tanda baca)', () => {
  const first = resolveCustomerByName_('C.V. Abadi', admin);
  const second = resolveCustomerByName_('CV Abadi', admin);
  expect(second.id).toBe(first.id);
  expect(second.name).toBe('C.V. Abadi');
  expect(listCustomers_()).toHaveLength(1);
  insertCustomer_(base('Lain', { id: 'cl', key: 'lain' }));
  expect(
    captureAppError(() => renameCustomer_({ id: 'cl', name: 'c.v abadi' }, admin)).fields,
  ).toEqual({
    name: 'Nama customer sudah dipakai',
  });
});
