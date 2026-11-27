import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  clBundleDetail,
  clDraft,
  listClBundles,
  publishClBundle,
  reactivateClBundle,
  validateGetClBundle,
  validatePublishClBundle,
  validateReactivateClBundle,
} from './bundle-service';
import { saveClFile } from './files-service';
import { saveClFirmware, validateSaveClFirmware } from './firmware-service';
import { validateSaveClFile } from './validate';

let env: TestEnv;
const ACTOR = { email: 'admin@gmail.com' };

type Failure = { code?: string; message: string };

async function errorOf(promise: Promise<unknown>): Promise<Failure> {
  return promise.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (error: Failure) => error,
  );
}

function settingsJson(routerPassword = 'rahasia'): string {
  const mode = (ipServer: string) => ({
    ip: '',
    ipServer,
    connectVia: 'Target',
    interfaceBridge: 'bridge1',
  });
  const brand = (label: string) => ({
    label,
    username: 'admin',
    password: '',
    web: 'http://{ip}',
    modes: { single: { ...mode('10.0.0.1'), ip: '192.168.1.20' }, multi: mode('10.0.0.1') },
  });
  return JSON.stringify({
    schema: 1,
    router: {
      ip: '10.0.0.1',
      username: 'admin',
      password: routerPassword,
      interfaceBridge: 'bridge1',
    },
    network: { computerIp: '10.0.0.5', prefixLength: 24 },
    brands: { mikrotik: brand('Mikrotik'), ubiquiti: brand('Ubiquiti') },
  });
}

/** Menyimpan (atau memperbarui) berkas teks; berkas yang sudah ada diperbarui dari revisi terbarunya. */
async function putText(path: string, role: string, text: string): Promise<void> {
  const { listClFiles } = await import('./files-service');
  const existing = (await listClFiles(env)).find((file) => file.path === path);
  await saveClFile(
    env,
    validateSaveClFile({
      path,
      role,
      text,
      ...(existing === undefined ? {} : { baseSeq: existing.headRev }),
    }),
    ACTOR,
  );
}

async function putFirmware(extra: Record<string, unknown> = {}) {
  return saveClFirmware(
    env,
    validateSaveClFirmware({
      brand: 'mikrotik',
      code: 'AC',
      label: 'AC',
      scriptPath: 'mikrotik/AC.rsc',
      parallel: false,
      sort: 10,
      ...extra,
    }),
    ACTOR,
  );
}

/** Draf sah minimum: settings.json, satu skrip, satu berkas router yang dirujuk, satu firmware. */
async function validDraft(): Promise<void> {
  await putText('settings.json', 'settings', settingsJson());
  await putText('mikrotik/AC.rsc', 'script', ':put {ipTarget}\n/file print file=/temp/boot.cfg');
  await putText('os/boot.cfg', 'router', 'config');
  await putFirmware();
}

const publish = (note = '') => publishClBundle(env, validatePublishClBundle({ note }), ACTOR);
const reactivate = (number: number, note = '') =>
  reactivateClBundle(env, validateReactivateClBundle({ number: String(number), note }), ACTOR);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
});

describe('clDraft', () => {
  test('draf kosong: SETTINGS_MISSING, belum ada bundel = changed true, publish ditolak', async () => {
    const draft = await clDraft(env);
    expect(draft.issues.map((issue) => issue.code)).toContain('SETTINGS_MISSING');
    expect(draft.files).toEqual([]);
    expect(draft.changed).toBe(true);
    expect(draft.computerHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await errorOf(publish())).code).toBe('CONFLICT');
  });

  test('draf sah tanpa error; teks revisi terbaru ikut divalidasi (rujukan /temp hilang = TEMP_REF_MISSING)', async () => {
    await validDraft();
    const ok = await clDraft(env);
    expect(ok.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(ok.files.map((file) => file.path).sort()).toEqual([
      'mikrotik/AC.rsc',
      'os/boot.cfg',
      'settings.json',
    ]);
    await putText('mikrotik/AC.rsc', 'script', '/file print file=/temp/hilang.npk');
    const broken = await clDraft(env);
    expect(broken.issues.some((issue) => issue.code === 'TEMP_REF_MISSING')).toBe(true);
  });
});

describe('publishClBundle', () => {
  test('nomor 1 lalu 2; ubah skrip: computerHash beda, routerHash sama; ubah sandi router: routerHash berubah', async () => {
    await validDraft();
    const first = await publish('awal');
    expect(first).toMatchObject({
      number: 1,
      note: 'awal',
      publishedBy: 'admin@gmail.com',
      sourceNumber: null,
      fileCount: 3,
      minApp: '0.0.0',
    });
    expect(first.computerHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await clDraft(env)).changed).toBe(false);

    await putText(
      'mikrotik/AC.rsc',
      'script',
      ':put {ipTarget}\n/file print file=/temp/boot.cfg\n:put 2',
    );
    const changed = await clDraft(env);
    expect(changed.changed).toBe(true);
    const second = await publish();
    expect(second.number).toBe(2);
    expect(second.computerHash).not.toBe(first.computerHash);
    expect(second.routerHash).toBe(first.routerHash);

    await putText('settings.json', 'settings', settingsJson('sandi-baru'));
    const third = await publish();
    expect(third.number).toBe(3);
    expect(third.routerHash).not.toBe(second.routerHash);

    const audit = await env.DB.prepare('SELECT action FROM audit_log WHERE action = ?')
      .bind('countrylock.publish')
      .all();
    expect(audit.results).toHaveLength(3);
  });

  test('tanpa perubahan = CONFLICT; hanya firmware yang berubah juga dihitung perubahan', async () => {
    await validDraft();
    await publish();
    expect((await errorOf(publish())).code).toBe('CONFLICT');
    env.clock.advance(1000);
    await putFirmware({ id: (await clDraft(env)).firmwares[0]?.id, parallel: true });
    expect((await clDraft(env)).changed).toBe(true);
    expect((await publish()).number).toBe(2);
  });

  test('publish saat ada error draf (TEMP_REF_MISSING) = CONFLICT dan tak ada bundel', async () => {
    await validDraft();
    await putText('mikrotik/AC.rsc', 'script', '/file print file=/temp/hilang.npk');
    expect((await errorOf(publish())).code).toBe('CONFLICT');
    expect(await listClBundles(env)).toEqual([]);
  });

  test('dua publish serentak dari draf yang berubah: nomor unik, tak pernah ganda', async () => {
    await validDraft();
    await publish();
    await putText(
      'mikrotik/AC.rsc',
      'script',
      ':put {ipTarget}\n/file print file=/temp/boot.cfg\n:put 99',
    );
    const attempts = await Promise.allSettled([publish('A'), publish('B')]);
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('CONFLICT');
    const numbers = (await listClBundles(env)).map((bundle) => bundle.number);
    expect(numbers).toEqual([2, 1]);
  });
});

describe('reactivateClBundle', () => {
  test('bundel baru dengan sourceNumber dan hash persis bundel lama', async () => {
    await validDraft();
    const first = await publish();
    await putText(
      'mikrotik/AC.rsc',
      'script',
      ':put {ipTarget}\n/file print file=/temp/boot.cfg\n:put 2',
    );
    const second = await publish();
    const third = await reactivate(1, 'kembali');
    expect(third).toMatchObject({
      number: 3,
      sourceNumber: 1,
      note: 'kembali',
      computerHash: first.computerHash,
      routerHash: first.routerHash,
    });
    expect(third.computerHash).not.toBe(second.computerHash);
    const detail = await clBundleDetail(env, validateGetClBundle({ number: '3' }));
    const original = await clBundleDetail(env, validateGetClBundle({ number: '1' }));
    expect(detail.files).toEqual(original.files);
    expect(detail.firmwares).toEqual(original.firmwares);
    // aktifkan ulang bundel yang isinya sudah yang terbaru = CONFLICT; nomor tak ada = NOT_FOUND
    expect((await errorOf(reactivate(3))).code).toBe('CONFLICT');
    expect((await errorOf(reactivate(1))).code).toBe('CONFLICT');
    expect((await errorOf(reactivate(99))).code).toBe('NOT_FOUND');
    const audit = await env.DB.prepare('SELECT action FROM audit_log WHERE action = ?')
      .bind('countrylock.reactivate')
      .all();
    expect(audit.results).toHaveLength(1);
  });

  test('draf berubah sejak aktivasi ulang: draf dihitung terhadap bundel terbaru (hasil aktivasi)', async () => {
    await validDraft();
    await publish();
    await putText(
      'mikrotik/AC.rsc',
      'script',
      ':put {ipTarget}\n/file print file=/temp/boot.cfg\n:put 2',
    );
    await publish();
    await reactivate(1);
    // draf masih berisi skrip versi 2, berbeda dari bundel terbaru (isi versi 1)
    expect((await clDraft(env)).changed).toBe(true);
  });
});

describe('daftar dan rincian', () => {
  test('list urut nomor menurun; get memuat berkas dan firmware', async () => {
    await validDraft();
    await publish();
    const list = await listClBundles(env);
    expect(list).toHaveLength(1);
    const detail = await clBundleDetail(env, validateGetClBundle({ number: '1' }));
    expect(detail.files.map((file) => file.path)).toEqual([
      'mikrotik/AC.rsc',
      'os/boot.cfg',
      'settings.json',
    ]);
    expect(detail.firmwares).toEqual([
      {
        brand: 'mikrotik',
        code: 'AC',
        label: 'AC',
        scriptPath: 'mikrotik/AC.rsc',
        parallel: false,
      },
    ]);
    expect((await errorOf(clBundleDetail(env, validateGetClBundle({ number: '5' })))).code).toBe(
      'NOT_FOUND',
    );
    expect(() => validateGetClBundle({ number: '0' })).toThrow();
    expect(() => validatePublishClBundle({ note: 'x'.repeat(201) })).toThrow();
  });
});

describe('rute REST clBundles', () => {
  const call = async (email: string, id: string, input: unknown) =>
    (await restCall(env, email, id, input)) as {
      ok: boolean;
      data?: unknown;
      error?: { code: string };
    };

  test('edit boleh draft/list/get tetapi tidak publish/reactivate (FORBIDDEN); manage boleh', async () => {
    await seedRole(env, { id: 'r-e', name: 'CL edit', permissions: { countrylock: 'edit' } });
    await seedRole(env, { id: 'r-m', name: 'CL manage', permissions: { countrylock: 'manage' } });
    await seedUser(env, { id: 'u-e', email: 'cl-edit@gmail.com', roleIds: ['r-e'] });
    await seedUser(env, { id: 'u-m', email: 'cl-manage@gmail.com', roleIds: ['r-m'] });
    await validDraft();
    expect((await call('cl-edit@gmail.com', 'clBundles.draft', null)).ok).toBe(true);
    expect((await call('cl-edit@gmail.com', 'clBundles.list', null)).ok).toBe(true);
    expect((await call('cl-edit@gmail.com', 'clBundles.publish', { note: '' })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await call('cl-edit@gmail.com', 'clBundles.reactivate', { number: '1', note: '' })).error
        ?.code,
    ).toBe('FORBIDDEN');
    const published = await call('cl-manage@gmail.com', 'clBundles.publish', { note: 'rest' });
    expect(published.ok).toBe(true);
    expect((await call('cl-edit@gmail.com', 'clBundles.get', { number: '1' })).ok).toBe(true);
    expect(
      (await call('cl-manage@gmail.com', 'clBundles.reactivate', { number: '1', note: '' })).error
        ?.code,
    ).toBe('CONFLICT');
  });
});
