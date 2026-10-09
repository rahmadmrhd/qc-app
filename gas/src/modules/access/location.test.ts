import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { UserContext } from './context';
import { loadUserContext_ } from './context';
import { listLocationDtos_, saveLocation_, setLocationStatus_ } from './location-service';
import { insertLocation_, listAuditRecords_ } from './repo';
import { validateSaveLocation_, validateSetLocationStatus_ } from './validate';

let admin: UserContext;

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com' },
      now: () => Date.parse('2026-10-09T00:00:00.000Z'),
    }),
  );
  insertLocation_(location({ id: 'l-bdg', code: 'BDG', name: 'Bandung' }));
  insertLocation_(location({ id: 'l-jkt', code: 'JKT', name: 'Jakarta' }));
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

function lastAudit() {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
}

test('listLocationDtos_ terurut menurut kode', () => {
  expect(listLocationDtos_().map((l) => l.code)).toEqual(['BDG', 'JKT']);
});

test('membuat lokasi: aktif, tercatat pelakunya, audit before kosong', () => {
  const created = saveLocation_({ code: 'SBY', name: 'Surabaya' }, admin);
  expect(created).toMatchObject({
    code: 'SBY',
    name: 'Surabaya',
    status: 'active',
    updatedBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(listLocationDtos_().map((l) => l.code)).toEqual(['BDG', 'JKT', 'SBY']);
  expect(lastAudit()).toMatchObject({
    action: 'location.create',
    target: 'SBY',
    before: null,
    after: { code: 'SBY', name: 'Surabaya', status: 'active' },
  });
});

test('kode dan nama harus unik (nama tanpa membedakan huruf besar)', () => {
  expect(captureAppError(() => saveLocation_({ code: 'JKT', name: 'Lain' }, admin))).toMatchObject({
    code: 'CONFLICT',
    fields: { code: 'Kode lokasi sudah dipakai' },
  });
  expect(
    captureAppError(() => saveLocation_({ code: 'XXX', name: 'jakarta' }, admin)),
  ).toMatchObject({
    code: 'CONFLICT',
    fields: { name: 'Nama lokasi sudah dipakai' },
  });
});

test('mengubah nama menyimpan snapshot sebelum dan sesudah; kode tidak dapat diubah', () => {
  const updated = saveLocation_({ id: 'l-jkt', code: 'JKT', name: 'Jakarta Pusat' }, admin);
  expect(updated.name).toBe('Jakarta Pusat');
  expect(lastAudit()).toMatchObject({
    action: 'location.update',
    before: { code: 'JKT', name: 'Jakarta', status: 'active' },
    after: { code: 'JKT', name: 'Jakarta Pusat', status: 'active' },
  });
  expect(
    captureAppError(() => saveLocation_({ id: 'l-jkt', code: 'JK2', name: 'Jakarta' }, admin)),
  ).toMatchObject({ code: 'VALIDATION', fields: { code: 'Kode tidak dapat diubah' } });
  expect(
    captureAppError(() => saveLocation_({ id: 'tidak-ada', code: 'ZZZ', name: 'Z' }, admin)).code,
  ).toBe('NOT_FOUND');
});

test('nonaktifkan dan aktifkan lokasi tercatat; status sama tidak mencatat apa pun', () => {
  expect(setLocationStatus_({ id: 'l-bdg', status: 'inactive' }, admin).status).toBe('inactive');
  expect(lastAudit()).toMatchObject({
    action: 'location.deactivate',
    target: 'BDG',
    before: { status: 'active' },
    after: { status: 'inactive' },
  });
  const count = listAuditRecords_().length;
  setLocationStatus_({ id: 'l-bdg', status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(count);
  expect(setLocationStatus_({ id: 'l-bdg', status: 'active' }, admin).status).toBe('active');
  expect(lastAudit().action).toBe('location.activate');
  expect(
    captureAppError(() => setLocationStatus_({ id: 'tidak-ada', status: 'active' }, admin)).code,
  ).toBe('NOT_FOUND');
});

test('validateSaveLocation_ menormalkan kode ke huruf besar dan menolak yang tidak sah', () => {
  expect(validateSaveLocation_({ code: ' jkt-01 ', name: ' Jakarta ' })).toEqual({
    code: 'JKT-01',
    name: 'Jakarta',
  });
  expect(validateSaveLocation_({ id: 'x', code: 'A', name: 'B' })).toEqual({
    id: 'x',
    code: 'A',
    name: 'B',
  });
  expect(captureAppError(() => validateSaveLocation_({ code: '', name: '' })).fields).toEqual({
    code: 'Wajib diisi',
    name: 'Wajib diisi',
  });
  expect(
    captureAppError(() => validateSaveLocation_({ code: 'AB CD', name: 'X' })).fields?.code,
  ).toBe('Hanya huruf, angka, dan tanda hubung');
  expect(
    captureAppError(() => validateSaveLocation_({ code: 'ABCDEFGHIJK', name: 'X' })).fields?.code,
  ).toBe('Maksimal 10 karakter');
});

test('validateSetLocationStatus_ mewajibkan id dan status sah', () => {
  expect(validateSetLocationStatus_({ id: 'l1', status: 'inactive' })).toEqual({
    id: 'l1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateSetLocationStatus_({ id: '', status: 'x' })).fields).toEqual(
    {
      id: 'Wajib diisi',
      status: 'Nilai tidak valid',
    },
  );
});
