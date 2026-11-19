// Daftar Laporan (rancangan 2026-11-14 §4.5): `serialCases.list`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { caseSummary } from './case-list';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;

const list = async (email: string, input: unknown = {}): Promise<CallOut> =>
  (await restCall(env, email, 'serialCases.list', input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z'));
  await seedSerialWorld(env);
});

const reportEvent = (serialId: string, caseId: string, message: string, extra = '') =>
  env.DB.prepare(
    `INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, ?, 2, 'report_failure', '2026-11-10', '2026-11-10T00:00:00.000Z', 'x', 'Pelapor', 'qc', ?, ?, '{}')`,
  )
    .bind(
      `${caseId}-rep${extra}`,
      serialId,
      caseId,
      message,
      '[{"field":"status","from":null,"to":"Dilaporkan"}]',
    )
    .run();

async function seedCase(
  id: string,
  n: number,
  over: {
    buId?: string;
    itemId?: string;
    closed?: boolean;
    createdAt?: string;
    message?: string;
    number?: string;
  } = {},
): Promise<void> {
  const createdAt = over.createdAt ?? `2026-11-0${n}T00:00:00.000Z`;
  await seedSerial(env, {
    id: `sn-${id}`,
    serial: `SN-${id.toUpperCase()}`,
    buId: over.buId ?? 'bu-a',
    itemId: over.itemId ?? 'i-a1',
    status: over.closed ? 'good' : 'reported',
    openCase: {
      id,
      number: over.number ?? `LP/A/2611-000${n}`,
      openedOn: `2026-11-0${n}`,
      createdAt,
      createdBy: 'pelapor@gmail.com',
    },
  });
  if (over.closed) {
    await env.DB.prepare(
      "UPDATE serial_cases SET closed_on = '2026-11-09', outcome = 'good' WHERE id = ?",
    )
      .bind(id)
      .run();
    await env.DB.prepare("UPDATE serials SET open_case_id = '' WHERE id = ?")
      .bind(`sn-${id}`)
      .run();
  }
  await reportEvent(`sn-${id}`, id, over.message ?? `Rusak ${id}`);
}

describe('serialCases.list', () => {
  test('satu baris per laporan, terbaru dulu, dengan ringkasan, hari di status, dan pelapor', async () => {
    await seedCase('c1', 1);
    await seedCase('c2', 3);
    const out = await list(SERIAL_USERS.viewer);
    expect(out.ok).toBe(true);
    expect(out.data.items.map((i: Json) => i.id)).toEqual(['c2', 'c1']);
    expect(out.data.items[0]).toMatchObject({
      number: 'LP/A/2611-0003',
      serialId: 'sn-c2',
      serial: 'SN-C2',
      buId: 'bu-a',
      buCode: 'A',
      itemLabel: 'Merk Alfa',
      status: 'reported',
      custody: 'qc',
      openedOn: '2026-11-03',
      closedOn: null,
      outcome: null,
      reporter: 'pelapor@gmail.com',
      summary: 'Rusak c2',
    });
    expect(out.data.nextCursor).toBeNull();
  });

  test('lokasi saat ini dan lama laporan (aktif sampai hari ini, tertutup sampai tanggal tutup)', async () => {
    await seedCase('c1', 3);
    await seedCase('c2', 2, { closed: true });
    const items = (await list(SERIAL_USERS.viewer, { status: undefined })).data.items;
    const byId = Object.fromEntries(items.map((i: Json) => [i.id, i]));
    expect(typeof byId.c1.locationName).toBe('string');
    expect(byId.c1.locationName).not.toBe('');
    // aktif: 3 Nov -> 14 Nov (hari ini) = 11; tertutup: 2 Nov -> 9 Nov = 7
    expect(byId.c1.durationDays).toBe(11);
    expect(byId.c2.durationDays).toBe(7);
  });

  test('hari di status dihitung dari kejadian perubahan status terakhir', async () => {
    await seedCase('c1', 1);
    // 14 Nov (WIB) - 10 Nov (kejadian report_failure) = 4 hari
    expect((await list(SERIAL_USERS.viewer)).data.items[0].daysInStatus).toBe(4);
    await env.DB.prepare(
      `INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('e-send', 'sn-c1', 'c1', 3, 'send', '2026-11-13', '2026-11-13T00:00:00.000Z', 'x', 'X', 'qc', '', '[{"field":"status","from":"Dilaporkan","to":"Di servis"}]', '{}')`,
    ).run();
    expect((await list(SERIAL_USERS.viewer)).data.items[0].daysInStatus).toBe(1);
  });

  test('filter status: active hanya laporan terbuka, closed hanya yang sudah ditutup (hasil dan tanggal tutup)', async () => {
    await seedCase('c1', 1);
    await seedCase('c2', 2, { closed: true });
    const active = await list(SERIAL_USERS.viewer, { status: 'active' });
    const closed = await list(SERIAL_USERS.viewer, { status: 'closed' });
    expect(active.data.items.map((i: Json) => i.id)).toEqual(['c1']);
    expect(closed.data.items.map((i: Json) => i.id)).toEqual(['c2']);
    expect(closed.data.items[0]).toMatchObject({ closedOn: '2026-11-09', outcome: 'good' });
    expect((await list(SERIAL_USERS.viewer, { status: 'x' })).error?.code).toBe('VALIDATION');
  });

  test('BU di luar hak baca tidak tampil; filter buId ke BU terlarang menghasilkan daftar kosong', async () => {
    await seedCase('c1', 1);
    await seedCase('cb', 2, { buId: 'bu-b', itemId: 'i-b' });
    expect((await list(SERIAL_USERS.viewer)).data.items.map((i: Json) => i.id)).toEqual(['c1']);
    expect((await list(SERIAL_USERS.viewer, { buId: 'bu-b' })).data.items).toEqual([]);
    expect((await list(SERIAL_USERS.both)).data.items.map((i: Json) => i.id)).toEqual(['cb', 'c1']);
    expect(
      (await list(SERIAL_USERS.both, { buId: 'bu-b' })).data.items.map((i: Json) => i.id),
    ).toEqual(['cb']);
  });

  test('tim servis murni (serialservice saja) melihat semua laporan BU-nya, apa pun status serialnya', async () => {
    await seedCase('c1', 1);
    await env.DB.prepare("UPDATE serials SET status = 'broken' WHERE id = 'sn-c1'").run();
    await seedCase('c2', 2, { closed: true });
    const out = await list(SERIAL_USERS.service);
    expect(out.ok).toBe(true);
    expect(out.data.items.map((i: Json) => i.id).sort()).toEqual(['c1', 'c2']);
  });

  test('tanpa peran atau tanpa penugasan BU: FORBIDDEN / daftar kosong', async () => {
    await seedCase('c1', 1);
    expect((await list(SERIAL_USERS.nobu)).error?.code).toBe('FORBIDDEN');
    expect((await list(SERIAL_USERS.svcB)).data.items).toEqual([]);
  });

  test('pencarian menurut nomor LP atau Serial Number (awalan, huruf besar tak dibedakan)', async () => {
    await seedCase('c1', 1);
    await seedCase('c2', 2);
    const byNumber = await list(SERIAL_USERS.viewer, { query: 'lp/a/2611-0002' });
    expect(byNumber.data.items.map((i: Json) => i.id)).toEqual(['c2']);
    const bySerial = await list(SERIAL_USERS.viewer, { query: 'sn-c1' });
    expect(bySerial.data.items.map((i: Json) => i.id)).toEqual(['c1']);
    // karakter LIKE tidak diperlakukan sebagai wildcard
    expect((await list(SERIAL_USERS.viewer, { query: '%' })).data.items).toEqual([]);
  });

  test('daftar memuat nomor format lama dan baru: urutan terbaru dulu, pencarian awalan keduanya, kursor melewati nomor ber-/', async () => {
    await seedCase('old', 1, { number: 'LP-20261101-001' });
    await seedCase('n1', 2, { number: 'LP/SBY/2611-0001' });
    await seedCase('n2', 3, { number: 'LP/SBY/2611-0002' });
    await seedCase('n3', 4, { number: 'LP/JKT/2611-0001' });
    const all = await list(SERIAL_USERS.viewer);
    expect(all.data.items.map((i: Json) => i.id)).toEqual(['n3', 'n2', 'n1', 'old']);
    const byNew = await list(SERIAL_USERS.viewer, { query: 'LP/SBY/2611' });
    expect(byNew.data.items.map((i: Json) => i.id)).toEqual(['n2', 'n1']);
    const byOld = await list(SERIAL_USERS.viewer, { query: 'LP-2026' });
    expect(byOld.data.items.map((i: Json) => i.id)).toEqual(['old']);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 4; guard++) {
      const out = await list(SERIAL_USERS.viewer, { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...out.data.items.map((i: Json) => i.id));
      if (!out.data.nextCursor) break;
      cursor = out.data.nextCursor;
    }
    expect(seen).toEqual(['n3', 'n2', 'n1', 'old']);
  });

  test('halaman berkursor: tanpa duplikat dan tanpa celah', async () => {
    for (const n of [1, 2, 3, 4, 5]) await seedCase(`c${n}`, n);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 5; guard++) {
      const out = await list(SERIAL_USERS.viewer, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...out.data.items.map((i: Json) => i.id));
      if (!out.data.nextCursor) break;
      cursor = out.data.nextCursor;
    }
    expect(seen).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect((await list(SERIAL_USERS.viewer, { cursor: 'rusak' })).error?.code).toBe('VALIDATION');
    expect((await list(SERIAL_USERS.viewer, { limit: 0 })).error?.code).toBe('VALIDATION');
  });

  test('ringkasan: baris pertama catatan, Markdown dibersihkan, dipotong 120 karakter', async () => {
    await seedCase('c1', 1, { message: `**Layar** mati\nbaris kedua` });
    await seedCase('c2', 2, { message: 'x'.repeat(300) });
    const out = await list(SERIAL_USERS.viewer);
    const byId = new Map(out.data.items.map((i: Json) => [i.id, i.summary]));
    expect(byId.get('c1')).toBe('Layar mati');
    const long = byId.get('c2') as string;
    expect([...long]).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });

  test('caseSummary murni: kosong dan hanya gambar', () => {
    expect(caseSummary('')).toBe('');
    expect(caseSummary('\n\n  baris  ')).toBe('baris');
  });

  test('lewat REST GET /serial-cases', async () => {
    await seedCase('c1', 1);
    const res = await restClient(env).get('/serial-cases?status=active', {
      email: SERIAL_USERS.viewer,
    });
    expect(res.status).toBe(200);
    expect(((await jsonOf(res)).items as unknown[]).length).toBe(1);
  });
});
