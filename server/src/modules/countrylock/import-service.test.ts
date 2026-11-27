import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  CL_FILES_MAX,
  CL_IMPORT_MAX_JSON_BYTES,
  CL_TEXT_MAX_BYTES,
} from '@shared/countrylock-bundle';
import { listClFiles, saveClFile } from './files-service';
import { listClFirmwares, saveClFirmware, validateSaveClFirmware } from './firmware-service';
import { importCountryLock, validateImportCl } from './import-service';
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

function settings(): Record<string, unknown> {
  const mode = (ip: string) => ({
    ip,
    ipServer: '10.0.0.1',
    connectVia: 'Target',
    interfaceBridge: 'bridge1',
  });
  const brand = (label: string) => ({
    label,
    username: 'admin',
    password: '',
    web: 'http://{ip}',
    modes: { single: mode('192.168.1.20'), multi: mode('') },
  });
  return {
    schema: 1,
    router: { ip: '10.0.0.1', username: 'admin', password: 'rahasia', interfaceBridge: 'bridge1' },
    network: { computerIp: '10.0.0.5', prefixLength: 24 },
    brands: { mikrotik: brand('Mikrotik'), ubiquiti: brand('Ubiquiti') },
  };
}

const SCRIPTS = [
  { path: 'mikrotik/AC.rsc', text: ':put {ipTarget}', brand: 'mikrotik' },
  { path: 'mikrotik/AD.rsc', text: ':put dua', brand: 'mikrotik' },
  { path: 'ubiquiti/XM.sh', text: 'echo tiga', brand: 'ubiquiti' },
];

function payload(overrides: Record<string, unknown> = {}) {
  return validateImportCl({
    settings: settings(),
    scripts: SCRIPTS,
    firmwares: [
      { brand: 'mikrotik', code: 'AC', label: 'AC', scriptPath: 'mikrotik/AC.rsc' },
      { brand: 'mikrotik', code: 'AD', label: 'AD', scriptPath: 'mikrotik/AD.rsc' },
      { brand: 'ubiquiti', code: 'XM', label: 'XM', scriptPath: 'ubiquiti/XM.sh' },
    ],
    ...overrides,
  });
}

async function seedFirmwares(): Promise<void> {
  for (const [brand, code] of [
    ['mikrotik', 'AC'],
    ['mikrotik', 'AD'],
    ['ubiquiti', 'XM'],
  ] as const) {
    await saveClFirmware(
      env,
      validateSaveClFirmware({
        brand,
        code,
        label: code,
        scriptPath: null,
        parallel: false,
        sort: 10,
      }),
      ACTOR,
    );
  }
}

async function auditActions(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((row) => row.action);
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
  await seedFirmwares();
});

describe('importCountryLock', () => {
  test('membuat settings.json + 3 skrip dan mengaitkan firmware; impor ulang melewati semuanya', async () => {
    const first = await importCountryLock(env, payload(), ACTOR);
    expect(first).toEqual({ filesCreated: 4, filesSkipped: 0, firmwaresLinked: 3, issues: [] });
    const files = await listClFiles(env);
    expect(files.map((file) => [file.path, file.role, file.headRev])).toEqual([
      ['mikrotik/AC.rsc', 'script', 1],
      ['mikrotik/AD.rsc', 'script', 1],
      ['settings.json', 'settings', 1],
      ['ubiquiti/XM.sh', 'script', 1],
    ]);
    const firmwares = await listClFirmwares(env);
    expect(firmwares.map((firmware) => firmware.scriptPath).sort()).toEqual([
      'mikrotik/AC.rsc',
      'mikrotik/AD.rsc',
      'ubiquiti/XM.sh',
    ]);
    expect(await auditActions()).toContain('countrylock.import');

    const again = await importCountryLock(env, payload(), ACTOR);
    expect(again).toEqual({ filesCreated: 0, filesSkipped: 4, firmwaresLinked: 0, issues: [] });
    expect((await listClFiles(env)).every((file) => file.headRev === 1)).toBe(true);
  });

  test('berkas bernama sama dengan isi berbeda: warning, isi lama utuh, tidak ditimpa', async () => {
    await saveClFile(
      env,
      validateSaveClFile({ path: 'mikrotik/AC.rsc', role: 'script', text: 'isi lama' }),
      ACTOR,
    );
    const result = await importCountryLock(env, payload(), ACTOR);
    expect(result.filesCreated).toBe(3);
    expect(result.filesSkipped).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      severity: 'warning',
      code: 'IMPORT_CONTENT_DIFFERS',
      path: 'mikrotik/AC.rsc',
    });
    const file = (await listClFiles(env)).find((entry) => entry.path === 'mikrotik/AC.rsc');
    expect(file?.headRev).toBe(1);
    const { getClFile } = await import('./files-service');
    expect((await getClFile(env, { id: file?.id ?? '' })).text).toBe('isi lama');
  });

  test('kode firmware tak dikenal dilaporkan dan tidak dibuat; skrip hilang dan tautan beda dilaporkan', async () => {
    const result = await importCountryLock(
      env,
      payload({
        firmwares: [
          { brand: 'mikrotik', code: 'ZZ', label: 'ZZ', scriptPath: 'mikrotik/AC.rsc' },
          { brand: 'mikrotik', code: 'AC', label: 'AC', scriptPath: 'mikrotik/tidak-ada.rsc' },
          { brand: 'mikrotik', code: 'AD', label: 'AD', scriptPath: null },
        ],
      }),
      ACTOR,
    );
    expect(result.firmwaresLinked).toBe(0);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual([
      'IMPORT_FIRMWARE_SCRIPT_MISSING',
      'IMPORT_FIRMWARE_UNKNOWN',
    ]);
    expect((await listClFirmwares(env)).map((firmware) => firmware.code).sort()).toEqual([
      'AC',
      'AD',
      'XM',
    ]);

    // Firmware yang sudah menaut skrip lain tidak ditimpa: dilaporkan.
    await importCountryLock(env, payload(), ACTOR);
    const differs = await importCountryLock(
      env,
      payload({
        firmwares: [{ brand: 'mikrotik', code: 'AC', label: 'AC', scriptPath: 'mikrotik/AD.rsc' }],
      }),
      ACTOR,
    );
    expect(differs.firmwaresLinked).toBe(0);
    expect(differs.issues.map((issue) => issue.code)).toEqual(['IMPORT_FIRMWARE_LINK_DIFFERS']);
    const ac = (await listClFirmwares(env)).find((firmware) => firmware.code === 'AC');
    expect(ac?.scriptPath).toBe('mikrotik/AC.rsc');
  });

  test('path jahat pada entri ke-2: VALIDATION dan tak ada berkas tersimpan', async () => {
    const error = await errorOf(
      Promise.resolve().then(() =>
        payload({
          scripts: [
            { path: 'mikrotik/AC.rsc', text: 'a', brand: 'mikrotik' },
            { path: '../../etc/passwd', text: 'b', brand: 'mikrotik' },
          ],
        }),
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(await listClFiles(env)).toEqual([]);
  });

  test('kegagalan di tengah penulisan membatalkan seluruhnya (batch atomik)', async () => {
    // Pernyataan terakhir batch dibuat gagal: berkas dan kaitan firmware yang sudah "ditulis" harus ikut batal.
    const realBatch = env.DB.batch.bind(env.DB);
    env.DB.batch = ((statements: Parameters<typeof realBatch>[0]) =>
      realBatch([
        ...statements,
        env.DB.prepare('INSERT INTO cl_files (id) VALUES (NULL)'),
      ])) as typeof env.DB.batch;
    try {
      await errorOf(importCountryLock(env, payload(), ACTOR));
    } finally {
      env.DB.batch = realBatch;
    }
    expect(await listClFiles(env)).toEqual([]);
    expect((await listClFirmwares(env)).every((firmware) => firmware.scriptPath === null)).toBe(
      true,
    );
    expect(await auditActions()).not.toContain('countrylock.import');
  });

  test('masukan melebihi CL_FILES_MAX atau ukuran JSON melebihi batas = VALIDATION', async () => {
    const many = Array.from({ length: CL_FILES_MAX }, (_, index) => ({
      path: `mikrotik/s${index}.rsc`,
      text: 'x',
      brand: 'mikrotik',
    }));
    expect(() => payload({ scripts: many, firmwares: [] })).toThrow();
    const bigText = '"'.repeat(CL_TEXT_MAX_BYTES);
    expect(() =>
      payload({
        scripts: Array.from({ length: 5 }, (_, index) => ({
          path: `mikrotik/b${index}.rsc`,
          text: bigText,
          brand: 'mikrotik',
        })),
        firmwares: [],
      }),
    ).toThrow();
    // Tepat di bawah batas masih diterima: 4 x 100.000 tanda kutip (200 KB JSON tiap berkas) + settings.
    const ok = payload({
      scripts: Array.from({ length: 4 }, (_, index) => ({
        path: `mikrotik/b${index}.rsc`,
        text: '"'.repeat(100_000),
        brand: 'mikrotik',
      })),
      firmwares: [],
    });
    expect(new TextEncoder().encode(JSON.stringify(ok)).length).toBeLessThanOrEqual(
      CL_IMPORT_MAX_JSON_BYTES,
    );
  });

  test('berkas hidup yang ada + berkas baru melebihi CL_FILES_MAX = VALIDATION tanpa menulis', async () => {
    const rows = Array.from({ length: CL_FILES_MAX }, (_, index) => ({
      id: `01ARZ3NDEKTSV4RRFFQ69G${String(index).padStart(4, '0')}`,
      path: `isi/${index}.rsc`,
    }));
    const now = '2026-11-28T00:00:00.000Z';
    // Dua INSERT banyak-baris (bukan 800 panggilan): tunnel lambat.
    await env.DB.prepare(
      `INSERT INTO cl_files (id, path, path_key, role, kind, head_rev, removed_at, created_at, updated_at) VALUES ${rows
        .map(() => "(?, ?, ?, 'script', 'text', 1, '', ?, ?)")
        .join(', ')}`,
    )
      .bind(...rows.flatMap((row) => [row.id, row.path, row.path.toLowerCase(), now, now]))
      .run();
    await env.DB.prepare(
      `INSERT INTO cl_revisions (id, file_id, seq, sha256, size, text_body, message, author, created_at) VALUES ${rows
        .map(() => "(?, ?, 1, ?, 1, 'x', '', 'a', ?)")
        .join(', ')}`,
    )
      .bind(...rows.flatMap((row) => [`R${row.id.slice(1)}`, row.id, 'a'.repeat(64), now]))
      .run();
    const error = await errorOf(importCountryLock(env, payload(), ACTOR));
    expect(error.code).toBe('VALIDATION');
    expect((await listClFiles(env)).length).toBe(CL_FILES_MAX);
  });

  test('settings tak sah / jalur settings.json sebagai skrip / jalur kembar = VALIDATION', () => {
    expect(() => payload({ settings: { schema: 2 } })).toThrow();
    expect(() =>
      payload({ scripts: [{ path: 'settings.json', text: 'x', brand: 'mikrotik' }] }),
    ).toThrow();
    expect(() =>
      payload({
        scripts: [
          { path: 'mikrotik/A.rsc', text: 'x', brand: 'mikrotik' },
          { path: 'MIKROTIK/a.rsc', text: 'y', brand: 'mikrotik' },
        ],
      }),
    ).toThrow();
    expect(() =>
      payload({ scripts: [{ path: 'mikrotik/A.rsc', text: 'x\u0001', brand: 'mikrotik' }] }),
    ).toThrow();
  });
});

describe('rute REST clImport.run', () => {
  test('izin edit boleh, tanpa izin countrylock = FORBIDDEN', async () => {
    await seedRole(env, { id: 'r-e', name: 'CL edit', permissions: { countrylock: 'edit' } });
    await seedRole(env, { id: 'r-v', name: 'CL view', permissions: { countrylock: 'view' } });
    await seedUser(env, { id: 'u-e', email: 'cl-edit@gmail.com', roleIds: ['r-e'] });
    await seedUser(env, { id: 'u-v', email: 'cl-view@gmail.com', roleIds: ['r-v'] });
    const ok = (await restCall(env, 'cl-edit@gmail.com', 'clImport.run', payload())) as {
      ok: boolean;
      data?: { filesCreated: number };
    };
    expect(ok.ok).toBe(true);
    expect(ok.data?.filesCreated).toBe(4);
    const denied = (await restCall(env, 'cl-view@gmail.com', 'clImport.run', payload())) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(denied.error?.code).toBe('FORBIDDEN');
  });
});
