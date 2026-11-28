import { beforeEach, describe, expect, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { saveClFile } from './files-service';
import {
  listClFirmwares,
  listFirmwareOptions,
  removeClFirmware,
  saveClFirmware,
  validateListFirmwareOptions,
  validateRemoveClFirmware,
  validateSaveClFirmware,
} from './firmware-service';
import { firmwareKeyGuardStmt } from './repo';
import { seedCountryLockFirmwares } from './seed';
import { validateSaveClFile } from './validate';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const ACTOR = { email: 'admin@gmail.com' };

const itemBase = {
  businessUnitIds: [DEFAULT_TEST_BU_ID],
  model: 'AF-5XHD',
  isCountryLock: true,
  aliases: [] as string[],
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: DEFAULT_TEST_BU_ID, code: 'DEF', name: 'BU Bawaan Tes' });
  await seedBrand(env, 'Ubiquiti');
  await seedBrand(env, 'Mikrotik');
  await seedBrand(env, 'Cambium');
  await seedCountryLockFirmwares(env);
});

type Failure = { code?: string; stale?: boolean; message: string };

async function errorOf(promise: Promise<unknown>): Promise<Failure> {
  return promise.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (error: Failure) => error,
  );
}

const saveFirmware = async (input: Record<string, unknown>) =>
  saveClFirmware(
    env,
    validateSaveClFirmware({
      brand: 'ubiquiti',
      code: 'NEW',
      label: 'Baru',
      scriptPath: null,
      parallel: false,
      sort: 500,
      ...input,
    }),
    ACTOR,
  );

const removeFirmware = (id: string) =>
  removeClFirmware(env, validateRemoveClFirmware({ id }), ACTOR);

async function createItem(brand: string, firmware: string, model = 'AF-5XHD') {
  const response = await rest.post('/items', {
    body: { ...itemBase, model, brandId: brandIdOf(brand), firmware },
  });
  return { status: response.status, json: await jsonOf(response) };
}

async function idOfFirmware(brand: string, code: string): Promise<string> {
  const row = (await listClFirmwares(env)).find((f) => f.brand === brand && f.code === code);
  if (!row) throw new Error(`firmware ${brand}/${code} tidak ada`);
  return row.id;
}

describe('options dan list', () => {
  test('options hanya firmware hidup brand itu, urut sort; yang dihapus tidak muncul', async () => {
    const mikrotik = await listFirmwareOptions(
      env,
      validateListFirmwareOptions({ brand: 'mikrotik' }),
    );
    expect(mikrotik.map((o) => o.code)).toEqual([
      'AC',
      '5Ghz',
      '2Ghz',
      'AC2',
      'ARM',
      'Mantbox 19s',
      'AX',
      'AX2',
    ]);
    expect(mikrotik[1]).toEqual({ code: '5Ghz', label: '5GHz' });
    const created = await saveFirmware({ code: 'ZERO', label: 'Nol', sort: 1 });
    expect(created.sort).toBe(1);
    const ubiquiti = await listFirmwareOptions(
      env,
      validateListFirmwareOptions({ brand: 'ubiquiti' }),
    );
    expect(ubiquiti[0]?.code).toBe('ZERO');
    expect(ubiquiti).toHaveLength(10);
    await removeFirmware(created.id);
    const after = await listFirmwareOptions(
      env,
      validateListFirmwareOptions({ brand: 'ubiquiti' }),
    );
    expect(after.map((o) => o.code)).not.toContain('ZERO');
    expect(() => validateListFirmwareOptions({ brand: 'cambium' })).toThrow();
    expect(() => validateListFirmwareOptions({})).toThrow();
  });

  test('list memuat inUseCount per firmware dari item hidup merk itu', async () => {
    expect((await createItem('Ubiquiti', 'af5xhd')).status).toBe(201);
    expect((await createItem('Ubiquiti', 'af5xhd', 'AF-5XHD-2')).status).toBe(201);
    const list = await listClFirmwares(env);
    const af = list.find((f) => f.brand === 'ubiquiti' && f.code === 'af5xhd');
    expect(af?.inUseCount).toBe(2);
    expect(list.find((f) => f.brand === 'ubiquiti' && f.code === 'XC')?.inUseCount).toBe(0);
    expect(af).toMatchObject({ label: 'AF-5XHD', scriptPath: null, parallel: false });
  });
});

describe('saveClFirmware', () => {
  test('kode ganda pada brand yang sama = CONFLICT; kode sama di brand lain boleh', async () => {
    await saveFirmware({ code: 'DUP' });
    expect((await errorOf(saveFirmware({ code: 'DUP', label: 'Lain' }))).code).toBe('CONFLICT');
    expect((await saveFirmware({ brand: 'mikrotik', code: 'DUP' })).brand).toBe('mikrotik');
  });

  test('scriptPath wajib berkas skrip hidup', async () => {
    expect((await errorOf(saveFirmware({ code: 'S1', scriptPath: 'tidak/ada.rsc' }))).code).toBe(
      'VALIDATION',
    );
    await saveClFile(
      env,
      validateSaveClFile({ path: 'mikrotik/AC.rsc', role: 'script', text: ':put 1' }),
      ACTOR,
    );
    await saveClFile(
      env,
      validateSaveClFile({ path: 'os/system.npk', role: 'router', text: 'x' }),
      ACTOR,
    );
    const ok = await saveFirmware({ code: 'S2', scriptPath: 'mikrotik/AC.rsc' });
    expect(ok.scriptPath).toBe('mikrotik/AC.rsc');
    // berkas berperan router bukan skrip
    expect((await errorOf(saveFirmware({ code: 'S3', scriptPath: 'os/system.npk' }))).code).toBe(
      'VALIDATION',
    );
  });

  test('ubah label/sort/parallel boleh walau dipakai; ubah kode atau brand firmware yang dipakai = CONFLICT', async () => {
    await createItem('Ubiquiti', 'af5xhd');
    const id = await idOfFirmware('ubiquiti', 'af5xhd');
    env.clock.advance(1000);
    const renamed = await saveFirmware({
      id,
      code: 'af5xhd',
      label: 'AF 5XHD',
      parallel: true,
      sort: 7,
    });
    expect(renamed).toMatchObject({ label: 'AF 5XHD', parallel: true, sort: 7, inUseCount: 1 });
    const code = await errorOf(saveFirmware({ id, code: 'af5xhd2', label: 'x' }));
    expect(code.code).toBe('CONFLICT');
    const brand = await errorOf(
      saveFirmware({ id, brand: 'mikrotik', code: 'af5xhd', label: 'x' }),
    );
    expect(brand.code).toBe('CONFLICT');
    // firmware yang tidak dipakai boleh berganti kode
    const free = await idOfFirmware('ubiquiti', 'XC');
    expect((await saveFirmware({ id: free, code: 'XC9', label: 'XC9' })).code).toBe('XC9');
  });

  test('expectedUpdatedAt basi = stale', async () => {
    const created = await saveFirmware({ code: 'ST' });
    env.clock.advance(1000);
    await saveFirmware({ id: created.id, code: 'ST', label: 'Dua' });
    const stale = await errorOf(
      saveFirmware({
        id: created.id,
        code: 'ST',
        label: 'Tiga',
        expectedUpdatedAt: created.updatedAt,
      }),
    );
    expect(stale).toMatchObject({ code: 'CONFLICT', stale: true });
  });

  test('validasi: kode dan label wajib, brand valid, sort bulat', () => {
    const base = {
      brand: 'ubiquiti',
      code: 'C',
      label: 'L',
      scriptPath: null,
      parallel: false,
      sort: 1,
    };
    expect(validateSaveClFirmware(base).code).toBe('C');
    for (const bad of [
      { ...base, code: '' },
      { ...base, code: 'x'.repeat(41) },
      { ...base, code: 'a\nb' },
      { ...base, code: 'a\u202Eb' }, // pengatur arah teks (bidi)
      { ...base, code: 'a\u2028b' }, // pemisah baris
      { ...base, label: 'L\u0007' },
      { ...base, label: 'L\u2066x' },
      { ...base, label: '' },
      { ...base, label: 'x'.repeat(121) },
      { ...base, brand: 'cambium' },
      { ...base, sort: 1.5 },
      { ...base, parallel: 'ya' },
      { ...base, scriptPath: 5 },
    ]) {
      expect(() => validateSaveClFirmware(bad)).toThrow();
    }
  });
});

describe('removeClFirmware', () => {
  test('dipakai item hidup = CONFLICT; tidak dipakai = sukses, hilang dari options, kodenya dapat dipakai lagi', async () => {
    await createItem('Ubiquiti', 'af5xhd');
    const used = await idOfFirmware('ubiquiti', 'af5xhd');
    expect((await errorOf(removeFirmware(used))).code).toBe('CONFLICT');
    const free = await idOfFirmware('ubiquiti', 'XC');
    await removeFirmware(free);
    const options = await listFirmwareOptions(
      env,
      validateListFirmwareOptions({ brand: 'ubiquiti' }),
    );
    expect(options.map((o) => o.code)).not.toContain('XC');
    expect((await errorOf(removeFirmware(free))).code).toBe('NOT_FOUND');
    expect((await saveFirmware({ code: 'XC', label: 'XC baru' })).code).toBe('XC');
    const audit = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
      action: string;
    }>();
    expect(audit.results.map((r) => r.action)).toContain('countrylock.firmware_remove');
  });

  test('item terhapus (soft delete) tidak menahan penghapusan firmware', async () => {
    const created = await createItem('Ubiquiti', 'af5xhd');
    await env.DB.prepare("UPDATE items SET deleted_at = '2026-11-28T00:00:00.000Z' WHERE id = ?")
      .bind(created.json.id as string)
      .run();
    await removeFirmware(await idOfFirmware('ubiquiti', 'af5xhd'));
  });
});

describe('penjaga firmware pada items.save', () => {
  test('firmware brand lain, tak dikenal, atau yang sudah dihapus ditolak VALIDATION', async () => {
    for (const [brand, code] of [
      ['Ubiquiti', 'AC'],
      ['Mikrotik', 'af5xhd'],
      ['Cambium', 'AC'],
      ['Ubiquiti', 'ngawur'],
    ] as const) {
      const result = await createItem(brand, code);
      expect(result.status, `${brand}/${code}`).toBe(422);
      expect(result.json).toMatchObject({
        code: 'VALIDATION',
        fields: { firmware: expect.any(String) },
      });
    }
    await removeFirmware(await idOfFirmware('ubiquiti', 'XC'));
    const removed = await createItem('Ubiquiti', 'XC');
    expect(removed.status).toBe(422);
  });

  test('firmware baru buatan admin langsung dapat dipilih item', async () => {
    await saveFirmware({ code: 'XR', label: 'XR Firmware' });
    const result = await createItem('Ubiquiti', 'XR');
    expect(result.status).toBe(201);
    expect(result.json.firmware).toBe('XR');
  });

  test('firmwareKeyGuardStmt: lolos untuk firmware hidup, membatalkan batch bila sudah dihapus atau tak ada', async () => {
    await env.DB.batch([firmwareKeyGuardStmt(env.DB, 'ubiquiti', 'XC')]);
    await removeFirmware(await idOfFirmware('ubiquiti', 'XC'));
    const removed = await env.DB.batch([firmwareKeyGuardStmt(env.DB, 'ubiquiti', 'XC')]).catch(
      (error: unknown) => error,
    );
    expect(isGuardFailure(removed)).toBe(true);
    const missing = await env.DB.batch([firmwareKeyGuardStmt(env.DB, 'mikrotik', 'XC')]).catch(
      (error: unknown) => error,
    );
    expect(isGuardFailure(missing)).toBe(true);
  });

  test('KONKURENSI: items.save(firmware X) vs firmwares.remove(X): tepat satu menang dan keadaan akhir konsisten', async () => {
    for (let round = 0; round < 6; round++) {
      const code = `RACE${round}`;
      const created = await saveFirmware({ code, label: code });
      const [saved, removed] = await Promise.allSettled([
        createItem('Ubiquiti', code, `Model ${round}`),
        removeFirmware(created.id),
      ]);
      const itemOk = saved.status === 'fulfilled' && saved.value.status === 201;
      const removeOk = removed.status === 'fulfilled';
      expect(itemOk !== removeOk, `putaran ${round}`).toBe(true);
      const firmware = (await listClFirmwares(env)).find((f) => f.code === code);
      const using = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM items WHERE firmware = ? AND deleted_at = ''",
      )
        .bind(code)
        .first<{ n: number | string }>();
      if (itemOk) {
        expect(firmware?.id).toBe(created.id);
        expect(Number(using?.n)).toBe(1);
        expect((removed as PromiseRejectedResult).reason.code).toBe('CONFLICT');
      } else {
        expect(firmware).toBeUndefined();
        expect(Number(using?.n)).toBe(0);
        if (saved.status === 'fulfilled') expect(saved.value.status).toBe(422);
      }
    }
  });
});

describe('rute REST clFirmwares', () => {
  const call = async (email: string, id: string, input: unknown) =>
    (await restCall(env, email, id, input)) as {
      ok: boolean;
      data?: unknown;
      error?: { code: string };
    };

  beforeEach(async () => {
    await seedRole(env, { id: 'r-v', name: 'CL view', permissions: { countrylock: 'view' } });
    await seedRole(env, { id: 'r-e', name: 'CL edit', permissions: { countrylock: 'edit' } });
    await seedRole(env, { id: 'r-m', name: 'CL manage', permissions: { countrylock: 'manage' } });
    await seedUser(env, { id: 'u-v', email: 'cl-view@gmail.com', roleIds: ['r-v'] });
    await seedUser(env, { id: 'u-e', email: 'cl-edit@gmail.com', roleIds: ['r-e'] });
    await seedUser(env, { id: 'u-m', email: 'cl-manage@gmail.com', roleIds: ['r-m'] });
    await seedUser(env, { id: 'u-n', email: 'tanpa-peran@gmail.com', roleIds: [] });
  });

  test('options cukup login (tanpa izin modul); list/save butuh edit; remove butuh manage', async () => {
    const options = await call('tanpa-peran@gmail.com', 'clFirmwares.options', {
      brand: 'mikrotik',
    });
    expect(options.ok).toBe(true);
    expect((options.data as unknown[]).length).toBe(8);
    expect((await call('cl-view@gmail.com', 'clFirmwares.list', null)).error?.code).toBe(
      'FORBIDDEN',
    );
    expect((await call('cl-edit@gmail.com', 'clFirmwares.list', null)).ok).toBe(true);
    const saved = await call('cl-edit@gmail.com', 'clFirmwares.save', {
      brand: 'mikrotik',
      code: 'REST',
      label: 'Rest',
      scriptPath: null,
      parallel: false,
      sort: 90,
    });
    expect(saved.ok).toBe(true);
    const id = (saved.data as { id: string }).id;
    expect((await call('cl-edit@gmail.com', 'clFirmwares.remove', { id })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect((await call('cl-manage@gmail.com', 'clFirmwares.remove', { id })).ok).toBe(true);
  });
});
