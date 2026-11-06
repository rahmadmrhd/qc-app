import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GoogleClient } from '@server/core/google/client';
import type { GoogleSettings } from '@server/core/google/settings';
import { createGoogleRig, type GoogleRig, SPREADSHEET_ID } from '@server-test/google-rig';
import { type DumpDeps, runDumpCli } from './dump-sheets';
import { approvalFor, cleanDump, importWithApproval, withLegacyDetail } from './fixtures';
import { readDumpFile } from './import-sheets';
import { IGNORED_SHEETS, TABLES } from './schema-map';

let rig: GoogleRig | null = null;
const dirs: string[] = [];

afterEach(async () => {
  rig?.restoreConsole();
  rig = null;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qc-dump-'));
  dirs.push(dir);
  return dir;
}

const book = (current: GoogleRig) =>
  current.fake.sheets.get(SPREADSHEET_ID) as Map<string, string[][]>;

/** Spreadsheet palsu berisi dump bersih fixture, ditambah sheet ekspor yang TIDAK boleh disentuh. */
async function seededRig(): Promise<GoogleRig> {
  const current = await createGoogleRig();
  rig = current;
  for (const [name, grid] of Object.entries(cleanDump())) {
    book(current).set(
      name,
      grid.map((row) => row.map((cell) => String(cell ?? ''))),
    );
  }
  book(current).set('export_rahasia', [['id'], ['SENTINEL-EXPORT-JANGAN-BACA']]);
  return current;
}

interface Run {
  code: number;
  out: string;
  captured: GoogleSettings[];
}

async function run(current: GoogleRig, argv: string[], deps: Partial<DumpDeps> = {}): Promise<Run> {
  const captured: GoogleSettings[] = [];
  const dir = await tempDir();
  const out = path.join(dir, 'dump.json');
  const code = await runDumpCli(
    argv.map((arg) => (arg === '<OUT>' ? out : arg)),
    {
      env: { GOOGLE_SA_KEY_FILE: '/run/secrets/google-sa.json' },
      createClient: (settings): GoogleClient => {
        captured.push(settings);
        return current.make({
          GOOGLE_SA_KEY_FILE: settings.GOOGLE_SA_KEY_FILE,
          GOOGLE_SPREADSHEET_ID: settings.GOOGLE_SPREADSHEET_ID,
        });
      },
      ...deps,
    },
  );
  return { code, out, captured };
}

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

describe('runDumpCli', () => {
  test('dump lolos masuk import-sheets dan menghasilkan SQL yang sama dengan fixture asli (round-trip)', async () => {
    const current = await seededRig();
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);

    const parsed = JSON.parse(await readFile(out, 'utf8')) as {
      tables: Record<string, string[][]>;
    };
    expect(Object.keys(parsed).sort()).toEqual(['tables']);
    const expectedSheets = [...TABLES.map((table) => table.name), ...IGNORED_SHEETS].sort();
    // counters tidak ada di fixture: sheet pelengkap opsional, hanya dibaca bila ada.
    expect(Object.keys(parsed.tables).sort()).toEqual(
      expectedSheets.filter((name) => name !== 'counters'),
    );

    const dump = await readDumpFile(out);
    const result = importWithApproval(dump as Record<string, string[][]>);
    expect(result.report.errors).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.sql).not.toBeNull();
    expect(result.sql).toBe(importWithApproval(cleanDump()).sql);
    // Persetujuan pembuangan dari dump hasil CLI cocok dengan dump asli (isi sel identik).
    expect(approvalFor(dump as Record<string, string[][]>)).toEqual(approvalFor(cleanDump()));
  });

  test('hanya membaca sheet data yang dipetakan; sheet export_* tak pernah diminta, dibaca, atau ditulis', async () => {
    const current = await seededRig();
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const urls = current.fake.requests.map((request) => decodeURIComponent(request.url.href));
    expect(urls.some((url) => url.includes('export_'))).toBe(false);
    // Hanya baca: tidak ada permintaan sheet selain GET.
    const sheetWrites = current.fake.requests.filter(
      (request) => request.url.hostname === 'sheets.googleapis.com' && request.method !== 'GET',
    );
    expect(sheetWrites).toEqual([]);
    expect(await readFile(out, 'utf8')).not.toContain('SENTINEL-EXPORT');
    expect(book(current).get('export_rahasia')).toEqual([['id'], ['SENTINEL-EXPORT-JANGAN-BACA']]);
  });

  function seedLegacy(current: GoogleRig, details: Record<number, string> = {}): void {
    const dump = withLegacyDetail(cleanDump(), details);
    book(current).set(
      'audit_log',
      (dump.audit_log as string[][]).map((row) => row.map((cell) => String(cell ?? ''))),
    );
  }

  test('kolom legasi detail pada audit_log (sel kosong): dump lolos, header dibawa apa adanya, impor identik', async () => {
    const current = await seededRig();
    seedLegacy(current);
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const parsed = JSON.parse(await readFile(out, 'utf8')) as {
      tables: Record<string, string[][]>;
    };
    expect(parsed.tables.audit_log?.[0]).toContain('detail');
    expect(current.logs.join('\n')).not.toMatch(/peringatan|detail/i);
    const result = importWithApproval(parsed.tables);
    expect(result.report.errors).toEqual([]);
    expect(result.sql).toBe(importWithApproval(cleanDump()).sql);
  });

  test('kolom legasi detail berisi data: dump tetap ditulis, peringatan memuat jumlah dan nomor baris tanpa isi sel; impor yang berhenti', async () => {
    const current = await seededRig();
    seedLegacy(current, { 2: 'ISI-RAHASIA-1', 3: 'ISI-RAHASIA-2' });
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const log = current.logs.join('\n');
    expect(log).toMatch(/PERINGATAN.*audit_log.*detail.*2 baris.*2, 3/s);
    expect(log).not.toContain('ISI-RAHASIA');
    const parsed = JSON.parse(await readFile(out, 'utf8')) as {
      tables: Record<string, string[][]>;
    };
    const result = importWithApproval(parsed.tables);
    expect(result.sql).toBeNull();
    expect(result.report.errors.map((e) => e.code)).toEqual([
      'KOLOM_LEGASI_TERISI',
      'KOLOM_LEGASI_TERISI',
    ]);
  });

  test('kolom tak dikenal lain di audit_log tetap menolak dump walau kolom legasi detail ada', async () => {
    const current = await seededRig();
    seedLegacy(current);
    const grid = book(current).get('audit_log') as string[][];
    grid.forEach((row, index) => {
      row.push(index === 0 ? 'aneh' : '');
    });
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(1);
    const log = current.logs.join('\n');
    expect(log).toMatch(/audit_log.*kolom tak dikenal.*aneh/s);
    expect(log).not.toMatch(/kolom tak dikenal:[^\n]*detail/);
    expect(await exists(out)).toBe(false);
  });

  test('kolom legasi detail dua kali di header tetap ditolak (ganda)', async () => {
    const current = await seededRig();
    seedLegacy(current);
    const grid = book(current).get('audit_log') as string[][];
    grid.forEach((row, index) => {
      row.push(index === 0 ? 'detail' : '');
    });
    const { code } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(1);
    expect(current.logs.join('\n')).toMatch(/audit_log.*kolom ganda.*detail/s);
  });

  test('sheet tambahan di luar pemetaan tidak ikut dump', async () => {
    const current = await seededRig();
    book(current).set('settings', [
      ['key', 'value'],
      ['A', 'B'],
    ]);
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const parsed = JSON.parse(await readFile(out, 'utf8')) as { tables: Record<string, unknown> };
    expect(parsed.tables.settings).toBeUndefined();
  });

  const BAD_HEADERS: Array<[string, (grid: string[][]) => string[][], RegExp]> = [
    [
      'kolom hilang',
      (grid) => [(grid[0] as string[]).filter((name) => name !== 'email'), ...grid.slice(1)],
      /users.*email/s,
    ],
    [
      'kolom tak dikenal',
      (grid) => [[...(grid[0] as string[]), 'kolom_aneh'], ...grid.slice(1)],
      /users.*kolom_aneh/s,
    ],
    [
      'kolom ganda',
      (grid) => [[...(grid[0] as string[]), 'email'], ...grid.slice(1)],
      /users.*email.*ganda|users.*ganda.*email/s,
    ],
    ['sheet kosong tanpa header', () => [], /users.*kosong|users.*header/s],
  ];
  for (const [label, change, message] of BAD_HEADERS) {
    test(`header tak cocok ditolak (${label}): galat per sheet dan tidak ada berkas`, async () => {
      const current = await seededRig();
      book(current).set('users', change(book(current).get('users') as string[][]));
      const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
      expect(code).toBe(1);
      expect(current.logs.join('\n')).toMatch(message);
      expect(await exists(out)).toBe(false);
      expect(await readdir(path.dirname(out))).toEqual([]);
    });
  }

  test('semua galat header dilaporkan sekaligus, bukan satu per satu', async () => {
    const current = await seededRig();
    book(current).set('users', [['id']]);
    book(current).set('roles', [['id']]);
    const { code } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(1);
    const log = current.logs.join('\n');
    expect(log).toContain('users');
    expect(log).toContain('roles');
  });

  test('sheet data yang hilang dari spreadsheet ditolak dengan nama sheetnya', async () => {
    const current = await seededRig();
    book(current).delete('qr_designs');
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(1);
    expect(current.logs.join('\n')).toMatch(/qr_designs.*tidak ada/s);
    expect(await exists(out)).toBe(false);
  });

  test('sheet penghitung (sync_state, counters) opsional: hilang bukan galat', async () => {
    const current = await seededRig();
    book(current).delete('sync_state');
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const parsed = JSON.parse(await readFile(out, 'utf8')) as { tables: Record<string, unknown> };
    expect(parsed.tables.sync_state).toBeUndefined();
  });

  test('tabel buangan dan penghitung ikut dibaca (gerbang pembuangan butuh isinya)', async () => {
    const current = await seededRig();
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const parsed = JSON.parse(await readFile(out, 'utf8')) as {
      tables: Record<string, string[][]>;
    };
    for (const name of ['handovers', 'items', 'brands', 'customers', 'sync_state']) {
      expect(parsed.tables[name]?.length).toBeGreaterThan(1);
    }
  });

  test('berkas keluaran yang sudah ada = galat tanpa --force (tanpa menyentuh Google), dengan --force diganti', async () => {
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'dump.json');
    await writeFile(out, 'LAMA');
    const base = ['--out', out, '--spreadsheet', SPREADSHEET_ID];
    const deps = { env: { GOOGLE_SA_KEY_FILE: '/k.json' } };

    expect(await runDumpCli(base, { ...deps, createClient: () => current.make() })).toBe(1);
    expect(await readFile(out, 'utf8')).toBe('LAMA');
    expect(current.fake.requests).toEqual([]);
    expect(current.logs.join('\n')).toContain('--force');

    expect(
      await runDumpCli([...base, '--force'], { ...deps, createClient: () => current.make() }),
    ).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8'))).toHaveProperty('tables');
    expect(await readdir(dir)).toEqual(['dump.json']);
  });

  test('keluaran konsol hanya ringkasan nama sheet dan jumlah baris, tanpa isi, kunci, atau token', async () => {
    const current = await seededRig();
    const { code, out } = await run(current, ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID]);
    expect(code).toBe(0);
    const log = current.logs.join('\n');
    expect(log).toMatch(/users\D+2\b/);
    expect(log).toContain(out);
    const body = await readFile(out, 'utf8');
    const emails = Object.values(cleanDump().users as string[][])
      .slice(1)
      .map((row) => String(row[1]));
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(log).not.toContain(email);
    for (const text of [log, body]) {
      expect(text).not.toContain('BEGIN PRIVATE KEY');
      expect(text).not.toContain(
        current.privateKeyPem.replace(/-----[^-]+-----|\s/g, '').slice(0, 40),
      );
      expect(text).not.toContain('ya29.');
      expect(text).not.toContain(current.keyJson);
    }
  });

  test('kegagalan di jalur galat juga tidak membocorkan kunci atau token', async () => {
    const current = await seededRig();
    const { code } = await run(current, ['--out', '<OUT>', '--spreadsheet', 'TIDAKADASPREAD01']);
    expect(code).toBe(1);
    const log = current.logs.join('\n');
    expect(log).not.toContain('BEGIN PRIVATE KEY');
    expect(log).not.toContain('ya29.');
    expect(log).not.toContain(current.keyJson);
  });

  test('izin berkas 0600 dan folder yang dibuat 0700 (dilewati di Windows)', async () => {
    if (process.platform === 'win32') return;
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'baru', 'dump.json');
    const code = await runDumpCli(['--out', out, '--spreadsheet', SPREADSHEET_ID], {
      env: { GOOGLE_SA_KEY_FILE: '/k.json' },
      createClient: () => current.make(),
    });
    expect(code).toBe(0);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(out))).mode & 0o777).toBe(0o700);
  });

  test('folder tujuan yang belum ada dibuat', async () => {
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'a', 'b', 'dump.json');
    const code = await runDumpCli(['--out', out, '--spreadsheet', SPREADSHEET_ID], {
      env: { GOOGLE_SA_KEY_FILE: '/k.json' },
      createClient: () => current.make(),
    });
    expect(code).toBe(0);
    expect(await exists(out)).toBe(true);
  });

  test('atomik: kegagalan Google di tengah jalan tidak meninggalkan dump.json maupun berkas sementara', async () => {
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'dump.json');
    const failing = {
      sheetsDump: async () => {
        throw new Error('putus di tengah');
      },
    } as unknown as GoogleClient;
    const code = await runDumpCli(['--out', out, '--spreadsheet', SPREADSHEET_ID], {
      env: { GOOGLE_SA_KEY_FILE: '/k.json' },
      createClient: () => failing,
    });
    expect(code).toBe(1);
    expect(await readdir(dir)).toEqual([]);
    current.restoreConsole();
  });

  test('atomik: rename gagal membuang berkas sementara dan --force tidak merusak berkas lama', async () => {
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'dump.json');
    await writeFile(out, 'LAMA');
    const code = await runDumpCli(['--out', out, '--force', '--spreadsheet', SPREADSHEET_ID], {
      env: { GOOGLE_SA_KEY_FILE: '/k.json' },
      createClient: () => current.make(),
      rename: async () => {
        throw new Error('disk penuh');
      },
    });
    expect(code).toBe(1);
    expect(await readFile(out, 'utf8')).toBe('LAMA');
    expect(await readdir(dir)).toEqual(['dump.json']);
  });

  test('pemakaian salah: tanpa --out, argumen tak dikenal, tanpa spreadsheet atau kunci = galat sebelum menyentuh Google', async () => {
    const current = await seededRig();
    const dir = await tempDir();
    const out = path.join(dir, 'dump.json');
    const make = () => current.make();
    expect(await runDumpCli([], { env: {}, createClient: make })).toBe(2);
    expect(await runDumpCli(['--out', out, '--aneh'], { env: {}, createClient: make })).toBe(2);
    // Tanpa id spreadsheet / berkas kunci (argumen maupun env).
    expect(
      await runDumpCli(['--out', out], { env: { GOOGLE_SA_KEY_FILE: '/k' }, createClient: make }),
    ).toBe(2);
    expect(
      await runDumpCli(['--out', out, '--spreadsheet', SPREADSHEET_ID], {
        env: {},
        createClient: make,
      }),
    ).toBe(2);
    // Id yang bukan id Drive yang sah.
    expect(
      await runDumpCli(['--out', out, '--spreadsheet', '../x'], {
        env: { GOOGLE_SA_KEY_FILE: '/k' },
        createClient: make,
      }),
    ).toBe(2);
    expect(current.fake.requests).toEqual([]);
    expect(await exists(out)).toBe(false);
  });

  test('argumen mengalahkan env, dan env dipakai bila argumen tak ada', async () => {
    const current = await seededRig();
    const first = await run(
      current,
      ['--out', '<OUT>', '--spreadsheet', SPREADSHEET_ID, '--key-file', '/arg.json'],
      {
        env: { GOOGLE_SA_KEY_FILE: '/env.json', GOOGLE_SPREADSHEET_ID: 'ENVSPREADSHEET01' },
      },
    );
    expect(first.code).toBe(0);
    expect(first.captured[0]?.GOOGLE_SA_KEY_FILE).toBe('/arg.json');
    expect(first.captured[0]?.GOOGLE_SPREADSHEET_ID).toBe(SPREADSHEET_ID);

    const second = await run(current, ['--out', '<OUT>'], {
      env: { GOOGLE_SA_KEY_FILE: '/env.json', GOOGLE_SPREADSHEET_ID: SPREADSHEET_ID },
    });
    expect(second.code).toBe(0);
    expect(second.captured[0]?.GOOGLE_SA_KEY_FILE).toBe('/env.json');
    expect(second.captured[0]?.GOOGLE_SPREADSHEET_ID).toBe(SPREADSHEET_ID);
  });

  test('mkdir tidak dipanggil untuk folder yang sudah ada (tak mengubah izinnya)', async () => {
    if (process.platform === 'win32') return;
    const current = await seededRig();
    const dir = await tempDir();
    const sub = path.join(dir, 'ada');
    await mkdir(sub, { mode: 0o755 });
    const code = await runDumpCli(
      ['--out', path.join(sub, 'dump.json'), '--spreadsheet', SPREADSHEET_ID],
      {
        env: { GOOGLE_SA_KEY_FILE: '/k.json' },
        createClient: () => current.make(),
      },
    );
    expect(code).toBe(0);
    expect((await stat(sub)).mode & 0o777).toBe(0o755);
  });
});
