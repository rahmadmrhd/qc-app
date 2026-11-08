import { expect, test } from 'bun:test';
import { captureAppError } from '@server-test/errors';
import {
  validateDeleteRole,
  validateListAudit,
  validateSaveRole,
  validateSaveUser,
  validateSetUserStatus,
} from './validate';

test('validateSaveUser menormalisasi email, merapikan nama, dan membuang role duplikat per penugasan', () => {
  expect(
    validateSaveUser({
      email: ' Budi@Gmail.COM ',
      name: '  Budi ',
      status: 'active',
      assignments: [{ locationId: null, roleIds: ['a', 'a', 'b'] }],
      buAssignments: [{ buId: null, roleIds: ['x', 'x'] }],
    }),
  ).toEqual({
    email: 'budi@gmail.com',
    name: 'Budi',
    status: 'active',
    assignments: [{ locationId: null, roleIds: ['a', 'b'] }],
    buAssignments: [{ buId: null, roleIds: ['x'] }],
  });
});

test('validateSaveUser mengumpulkan semua error field', () => {
  const error = captureAppError(() =>
    validateSaveUser({ email: '', name: '', status: 'x', assignments: 'a', buAssignments: 'b' }),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    email: 'Wajib diisi',
    name: 'Wajib diisi',
    status: 'Nilai tidak valid',
    assignments: 'Harus berupa daftar penugasan',
    buAssignments: 'Harus berupa daftar penugasan BU',
  });
});

test('validateSaveUser menolak penugasan ganda untuk satu lokasi dan entri rusak', () => {
  const base = { email: 'b@gmail.com', name: 'B', status: 'active' };
  expect(
    captureAppError(() =>
      validateSaveUser({
        ...base,
        assignments: [
          { locationId: 'l1', roleIds: ['r'] },
          { locationId: 'l1', roleIds: ['r'] },
        ],
      }),
    ).fields?.assignments,
  ).toBe('Satu lokasi hanya boleh muncul sekali');
  expect(
    captureAppError(() =>
      validateSaveUser({
        ...base,
        assignments: [
          { locationId: null, roleIds: ['r'] },
          { locationId: null, roleIds: ['r'] },
        ],
      }),
    ).fields?.assignments,
  ).toBe('Satu lokasi hanya boleh muncul sekali');
  for (const entry of [
    { roleIds: [] },
    { locationId: '', roleIds: [] },
    { locationId: 3, roleIds: [] },
    { locationId: null, roleIds: 'x' },
    { locationId: null, roleIds: [1] },
    'teks',
  ]) {
    expect(
      captureAppError(() => validateSaveUser({ ...base, assignments: [entry] })).fields
        ?.assignments,
    ).toBeDefined();
  }
});

test('validateSaveUser: buAssignments wajib berupa daftar; BU kembar, Semua BU ganda, tanpa role, dan entri rusak ditolak', () => {
  const base = { email: 'b@gmail.com', name: 'B', status: 'active', assignments: [] };
  expect(captureAppError(() => validateSaveUser(base)).fields?.buAssignments).toBe(
    'Harus berupa daftar penugasan BU',
  );
  expect(
    validateSaveUser({ ...base, buAssignments: [{ buId: ' bu1 ', roleIds: [' r ', 'r'] }] })
      .buAssignments,
  ).toEqual([{ buId: 'bu1', roleIds: ['r'] }]);
  for (const entries of [
    [
      { buId: 'bu1', roleIds: ['r'] },
      { buId: 'bu1', roleIds: ['r'] },
    ],
    [
      { buId: null, roleIds: ['r'] },
      { buId: null, roleIds: ['r'] },
    ],
  ]) {
    expect(
      captureAppError(() => validateSaveUser({ ...base, buAssignments: entries })).fields
        ?.buAssignments,
    ).toBe('Satu BU hanya boleh muncul sekali');
  }
  for (const entry of [
    { roleIds: ['r'] },
    { buId: '', roleIds: ['r'] },
    { buId: 3, roleIds: ['r'] },
    { buId: null, roleIds: 'x' },
    { buId: null, roleIds: [1] },
    { buId: 'bu1', roleIds: [] },
    { buId: null, roleIds: ['  '] },
    'teks',
  ]) {
    expect(
      captureAppError(() => validateSaveUser({ ...base, buAssignments: [entry] })).fields
        ?.buAssignments,
    ).toBeDefined();
  }
});

test('validateSaveUser menolak format email salah dan input bukan objek', () => {
  expect(
    captureAppError(() =>
      validateSaveUser({
        email: 'budi',
        name: 'B',
        status: 'active',
        assignments: [],
        buAssignments: [],
      }),
    ).fields,
  ).toEqual({ email: 'Format email tidak valid' });
  expect(captureAppError(() => validateSaveUser('teks')).fields?._).toBe(
    'Input harus berupa objek',
  );
});

test('validateSetUserStatus dan validateDeleteRole mewajibkan id', () => {
  expect(validateSetUserStatus({ id: 'u1', status: 'inactive' })).toEqual({
    id: 'u1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateDeleteRole({})).fields).toEqual({ id: 'Wajib diisi' });
});

test('validateSaveRole menolak modul atau level yang tidak dikenal', () => {
  expect(
    validateSaveRole({
      name: ' QC ',
      description: '',
      permissions: { item: 'edit', stock: 'none' },
    }),
  ).toEqual({ name: 'QC', description: '', permissions: { item: 'edit', stock: 'none' } });
  const error = captureAppError(() =>
    validateSaveRole({ name: 'QC', description: '', permissions: { item: 'superuser' } }),
  );
  expect(error.fields?.permissions).toContain('item');
});

test('validateSaveRole menolak level yang tidak tersedia untuk modulnya', () => {
  const error = captureAppError(() =>
    validateSaveRole({
      name: 'X',
      description: '',
      permissions: { access: 'edit', stock: 'view' },
    }),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields?.permissions).toContain('access');
  expect(
    validateSaveRole({
      name: 'X',
      description: '',
      permissions: { access: 'manage', stock: 'view' },
    }).permissions,
  ).toEqual({ access: 'manage', stock: 'view' });
});

test('validateSaveUser menolak penugasan tanpa role', () => {
  const base = { email: 'b@gmail.com', name: 'B', status: 'active' };
  for (const locationId of [null, 'l1']) {
    expect(
      captureAppError(() =>
        validateSaveUser({ ...base, assignments: [{ locationId, roleIds: [] }] }),
      ).fields?.assignments,
    ).toBe('Penugasan harus punya minimal satu role');
  }
});

test('validateListAudit: input kosong memakai bawaan; batas dan kursor diperiksa', () => {
  expect(validateListAudit(null)).toEqual({ limit: 20, action: '', query: '' });
  expect(
    validateListAudit({
      limit: 50,
      action: 'user.create',
      query: ' Budi ',
      cursor: '2026-01-01T00:00:00.000Z~12',
    }),
  ).toEqual({
    limit: 50,
    action: 'user.create',
    query: 'Budi',
    cursor: '2026-01-01T00:00:00.000Z~12',
  });
  for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '5' }]) {
    expect(captureAppError(() => validateListAudit(bad)).fields?.limit).toBeDefined();
  }
  for (const cursor of ['x', '~3', 'ts~0', 'ts~abc', 5]) {
    expect(captureAppError(() => validateListAudit({ cursor })).fields?.cursor).toBe(
      'Kursor tidak valid',
    );
  }
});
