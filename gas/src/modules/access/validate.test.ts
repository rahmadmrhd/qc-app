import { expect, test } from 'bun:test';
import { captureAppError } from '@gas-test/errors';
import {
  validateDeleteRole_,
  validateSaveRole_,
  validateSaveUser_,
  validateSetUserStatus_,
} from './validate';

test('validateSaveUser_ menormalisasi email, merapikan nama, dan membuang role duplikat', () => {
  expect(
    validateSaveUser_({
      email: ' Budi@Gmail.COM ',
      name: '  Budi ',
      status: 'active',
      roleIds: ['a', 'a', 'b'],
    }),
  ).toEqual({ email: 'budi@gmail.com', name: 'Budi', status: 'active', roleIds: ['a', 'b'] });
});

test('validateSaveUser_ mengumpulkan semua error field', () => {
  const error = captureAppError(() =>
    validateSaveUser_({ email: '', name: '', status: 'x', roleIds: 'a' }),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    email: 'Wajib diisi',
    name: 'Wajib diisi',
    status: 'Nilai tidak valid',
    roleIds: 'Harus berupa daftar teks',
  });
});

test('validateSaveUser_ menolak format email salah dan input bukan objek', () => {
  expect(
    captureAppError(() =>
      validateSaveUser_({ email: 'budi', name: 'B', status: 'active', roleIds: [] }),
    ).fields,
  ).toEqual({ email: 'Format email tidak valid' });
  expect(captureAppError(() => validateSaveUser_('teks')).fields?._).toBe(
    'Input harus berupa objek',
  );
});

test('validateSetUserStatus_ dan validateDeleteRole_ mewajibkan id', () => {
  expect(validateSetUserStatus_({ id: 'u1', status: 'inactive' })).toEqual({
    id: 'u1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateDeleteRole_({})).fields).toEqual({ id: 'Wajib diisi' });
});

test('validateSaveRole_ menolak modul atau level yang tidak dikenal', () => {
  expect(
    validateSaveRole_({
      name: ' QC ',
      description: '',
      permissions: { item: 'edit', stock: 'none' },
    }),
  ).toEqual({ name: 'QC', description: '', permissions: { item: 'edit', stock: 'none' } });
  const error = captureAppError(() =>
    validateSaveRole_({ name: 'QC', description: '', permissions: { item: 'superuser' } }),
  );
  expect(error.fields?.permissions).toContain('item');
});

test('validateSaveRole_ menolak level yang tidak tersedia untuk modulnya', () => {
  const error = captureAppError(() =>
    validateSaveRole_({
      name: 'X',
      description: '',
      permissions: { access: 'edit', stock: 'view' },
    }),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields?.permissions).toContain('access');
  expect(
    validateSaveRole_({
      name: 'X',
      description: '',
      permissions: { access: 'manage', stock: 'view' },
    }).permissions,
  ).toEqual({ access: 'manage', stock: 'view' });
});
