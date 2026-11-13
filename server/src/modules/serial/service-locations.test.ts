// Konfigurasi lokasi tim servis (laporan rusak 2026-11-14 §4.6): kunci `SERIAL_SERVICE_LOCATIONS`, rute
// `serialServiceSettings.get|save` dan `serials.serviceLocations`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { effectiveServiceLocations, SETTING_SERIAL_SERVICE_LOCATIONS } from './service-locations';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const MGR = 'kelola-semua@gmail.com';
const MGR_ONE = 'kelola-satu@gmail.com';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z'));
  await seedSerialWorld(env);
  await seedLocation(env, { id: 'loc-bdg', code: 'BDG', name: 'Bandung' });
  await seedRole(env, { id: 'r-mgr', name: 'Kelola Serial', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MGR,
    buAssignments: [{ buId: null, roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-mgr1',
    email: MGR_ONE,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-mgr'] }],
  });
});

const ids = (list: { id: string }[]) => list.map((location) => location.id);
const save = (locationIds: string[], expectedUpdatedAt = '', email = MGR) =>
  call(email, 'serialServiceSettings.save', { expectedUpdatedAt, locationIds });

describe('effectiveServiceLocations', () => {
  test('tanpa pengaturan: semua lokasi aktif urut kode', async () => {
    expect(ids(await effectiveServiceLocations(env))).toEqual(['loc-bdg', 'loc-jkt', 'loc-sby']);
  });

  test('satu lokasi tercantum: hanya itu', async () => {
    await save(['loc-jkt']);
    expect(ids(await effectiveServiceLocations(env))).toEqual(['loc-jkt']);
  });

  test('banyak lokasi tercantum: urut kode', async () => {
    await save(['loc-sby', 'loc-bdg']);
    expect(ids(await effectiveServiceLocations(env))).toEqual(['loc-bdg', 'loc-sby']);
  });

  test('lokasi nonaktif yang tercantum diabaikan', async () => {
    await save(['loc-jkt', 'loc-sby']);
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-jkt'").run();
    expect(ids(await effectiveServiceLocations(env))).toEqual(['loc-sby']);
  });

  test('semua yang tercantum nonaktif: kembali ke semua lokasi aktif', async () => {
    await save(['loc-jkt']);
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-jkt'").run();
    expect(ids(await effectiveServiceLocations(env))).toEqual(['loc-bdg', 'loc-sby']);
  });

  test('daftar kosong tersimpan = semua lokasi aktif; nilai tersimpan rusak = bawaan', async () => {
    await save(['loc-jkt']);
    const stored = (await call(MGR, 'serialServiceSettings.get', null)).data;
    await save([], stored.updatedAt);
    expect(ids(await effectiveServiceLocations(env))).toHaveLength(3);
    await env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ?')
      .bind('{rusak', SETTING_SERIAL_SERVICE_LOCATIONS)
      .run();
    expect(ids(await effectiveServiceLocations(env))).toHaveLength(3);
  });
});

describe('serialServiceSettings', () => {
  test('bawaan kosong; simpan, get menyajikan nilainya, dan audit tercatat', async () => {
    const first = await call(MGR, 'serialServiceSettings.get', null);
    expect(first.data).toEqual({ locationIds: [], updatedAt: '' });
    const saved = await save(['loc-sby', 'loc-jkt']);
    expect(saved.ok).toBe(true);
    expect(saved.data).toEqual({
      locationIds: ['loc-sby', 'loc-jkt'],
      updatedAt: '2026-11-14T03:00:00.000Z',
    });
    expect((await call(MGR, 'serialServiceSettings.get', null)).data.locationIds).toEqual([
      'loc-sby',
      'loc-jkt',
    ]);
    const audits = await env.DB.prepare(
      "SELECT action, target FROM audit_log WHERE action = 'serial.service_locations'",
    ).all<{ action: string; target: string }>();
    expect(audits.results).toEqual([
      { action: 'serial.service_locations', target: 'settings:SERIAL_SERVICE_LOCATIONS' },
    ]);
  });

  test('ETag usang: 412 lewat REST dan CONFLICT lewat rute; nilai lama bertahan', async () => {
    const rest = restClient(env);
    const first = await save(['loc-sby']);
    env.clock.advance(60_000);
    const stale = await save(['loc-jkt'], '');
    expect(stale.error?.code).toBe('CONFLICT');
    const res = await rest.put('/serial-service-settings', {
      email: MGR,
      body: { expectedUpdatedAt: '2026-01-01T00:00:00.000Z', locationIds: ['loc-jkt'] },
      headers: { 'If-Match': '"2026-01-01T00:00:00.000Z"' },
    });
    expect(res.status).toBe(412);
    expect((await jsonOf(res)).code).toBeDefined();
    const kept = await call(MGR, 'serialServiceSettings.get', null);
    expect(kept.data.locationIds).toEqual(['loc-sby']);
    expect(kept.data.updatedAt).toBe(first.data.updatedAt);
  });

  test('validasi: lokasi tak ada, ganda, bukan daftar, lebih dari 500: VALIDATION', async () => {
    expect((await save(['tidak-ada'])).error?.code).toBe('VALIDATION');
    expect((await save(['loc-sby', 'loc-sby'])).error?.code).toBe('VALIDATION');
    expect((await save('loc-sby' as never)).error?.code).toBe('VALIDATION');
    const many = Array.from({ length: 501 }, (_, index) => `x${index}`);
    expect((await save(many)).error?.code).toBe('VALIDATION');
    expect((await save([])).ok).toBe(true);
  });

  test('izin: serial manage di semua BU atau super admin boleh; satu BU, edit, view, servis, tanpa peran: FORBIDDEN', async () => {
    expect((await call(MGR, 'serialServiceSettings.get', null)).ok).toBe(true);
    expect((await call('admin@gmail.com', 'serialServiceSettings.get', null)).ok).toBe(true);
    for (const email of [
      MGR_ONE,
      SERIAL_USERS.writer,
      SERIAL_USERS.viewer,
      SERIAL_USERS.svcEdit,
      SERIAL_USERS.nobu,
    ]) {
      expect([email, (await call(email, 'serialServiceSettings.get', null)).error?.code]).toEqual([
        email,
        'FORBIDDEN',
      ]);
      expect([email, (await save(['loc-sby'], '', email)).error?.code]).toEqual([
        email,
        'FORBIDDEN',
      ]);
    }
    const stored = await env.DB.prepare('SELECT 1 AS present FROM settings WHERE `key` = ?')
      .bind(SETTING_SERIAL_SERVICE_LOCATIONS)
      .first();
    expect(stored).toBeNull();
  });
});

describe('serials.serviceLocations', () => {
  test('pencatat mendapat lokasi servis efektif; respons tidak memuat penerima surel', async () => {
    await save(['loc-jkt']);
    const out = await call(SERIAL_USERS.writer, 'serials.serviceLocations', null);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ locations: [{ id: 'loc-jkt', code: 'JKT', name: 'Jakarta' }] });
    expect(JSON.stringify(out.data)).not.toContain('recipients');
  });

  test('tim servis saja, pembaca, dan tanpa peran: FORBIDDEN', async () => {
    for (const email of [SERIAL_USERS.svcEdit, SERIAL_USERS.viewer, SERIAL_USERS.nobu]) {
      expect([email, (await call(email, 'serials.serviceLocations', null)).error?.code]).toEqual([
        email,
        'FORBIDDEN',
      ]);
    }
  });

  test('serials.locationOptions hanya untuk serial: edit (tim servis FORBIDDEN)', async () => {
    expect((await call(SERIAL_USERS.writer, 'serials.locationOptions', null)).ok).toBe(true);
    expect((await call(SERIAL_USERS.svcEdit, 'serials.locationOptions', null)).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});
