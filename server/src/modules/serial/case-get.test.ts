// Detail laporan (`serialCases.get`): baris yang sama dengan daftar + penutup (turunan kejadian penutup) + status serial.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;
const getCase = (email: string, id: string): Promise<CallOut> =>
  call(email, 'serialCases.get', { id });

const W = SERIAL_USERS.writer;
const SVC = SERIAL_USERS.svcEdit;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare("UPDATE users SET name = 'Wati Pencatat' WHERE email = ?").bind(W).run();
  await env.DB.prepare("UPDATE users SET name = 'Sari Servis' WHERE email = ?").bind(SVC).run();
});

async function openCase(
  id: string,
  extra: { status?: string; custody?: string; buId?: string; itemId?: string } = {},
): Promise<void> {
  await seedSerial(env, {
    id: `sn-${id}`,
    serial: `SN-${id.toUpperCase()}`,
    buId: extra.buId ?? 'bu-a',
    itemId: extra.itemId ?? 'i-a1',
    status: extra.status ?? 'reported',
    custody: extra.custody ?? 'qc',
    openCase: {
      id,
      number: `LP/A/2611-000${id.length}`,
      openedOn: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      createdBy: 'pelapor@gmail.com',
    },
  });
  await env.DB.prepare(
    `INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, ?, 2, 'report_failure', '2026-11-10', '2026-11-10T00:00:00.000Z', 'x', 'Pelapor', 'qc', 'Layar mati total', '[]', '{}')`,
  )
    .bind(`${id}-rep`, `sn-${id}`, id)
    .run();
}

async function serialUpdatedAt(serialId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT updated_at FROM serials WHERE id = ?')
    .bind(serialId)
    .first<{ updated_at: string }>();
  return row?.updated_at ?? '';
}

describe('serialCases.get', () => {
  test('pembaca sah melihat laporan terbuka: baris sama dengan daftar, tanpa penutup, status serial kini', async () => {
    await openCase('c1');
    const result = await getCase(SERIAL_USERS.viewer, 'c1');
    expect(result.ok).toBe(true);
    const detail = result.data as Json;
    expect(detail.id).toBe('c1');
    expect(detail.number).toBe('LP/A/2611-0002');
    expect(detail.serial).toBe('SN-C1');
    expect(detail.serialId).toBe('sn-c1');
    expect(detail.buCode).toBe('A');
    expect(detail.itemLabel).toBe('Merk Alfa');
    expect(detail.status).toBe('reported');
    expect(detail.serialStatus).toBe('reported');
    expect(detail.closedOn).toBeNull();
    expect(detail.outcome).toBeNull();
    expect(detail.reporter).toBe('pelapor@gmail.com');
    expect(detail.summary).toBe('Layar mati total');
    expect(detail.closedBy).toBeUndefined();
    expect(detail.closedByTeam).toBeUndefined();
    expect(Object.keys(detail)).not.toContain('closedBy');
    // Baris yang sama dengan daftar (kecuali kolom detail).
    const list = (await call(SERIAL_USERS.viewer, 'serialCases.list', {})).data as Json;
    const { serialStatus: _s, ...rest } = detail;
    expect(list.items[0]).toEqual(rest);
  });

  test('pembaca serialservice murni sah; BU lain, tanpa hak, dan id tak ada = NOT_FOUND/FORBIDDEN', async () => {
    await openCase('c1');
    expect((await getCase(SERIAL_USERS.service, 'c1')).ok).toBe(true);
    const otherBu = await getCase(SERIAL_USERS.svcB, 'c1');
    const unknown = await getCase(SERIAL_USERS.viewer, 'tak-ada');
    expect(otherBu.ok).toBe(false);
    expect(otherBu.error.code).toBe('NOT_FOUND');
    expect(unknown.error.code).toBe('NOT_FOUND');
    expect(otherBu.error.message).toBe(unknown.error.message);
    // Tanpa izin serial/serialservice sama sekali: ditolak di tingkat rute.
    expect((await getCase(SERIAL_USERS.nobu, 'c1')).error.code).toBe('FORBIDDEN');
  });

  test('laporan milik serial yang pernah di BU pembaca (riwayat BU) tetap terbaca', async () => {
    await openCase('c1');
    // Serial pindah ke BU B; BU A tercatat di riwayat (left_at terisi) sehingga pembaca BU A tetap membaca.
    await env.DB.prepare("UPDATE serials SET bu_id = 'bu-b' WHERE id = 'sn-c1'").run();
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn-c1', 'bu-a', '2026-11-01T00:00:00.000Z', '2026-11-12T00:00:00.000Z'), ('sn-c1', 'bu-b', '2026-11-12T00:00:00.000Z', '') ON DUPLICATE KEY UPDATE left_at = VALUES(left_at)",
    ).run();
    expect((await getCase(SERIAL_USERS.viewer, 'c1')).ok).toBe(true);
    expect((await getCase(SERIAL_USERS.svcB, 'c1')).ok).toBe(true);
  });

  test('serial terhapus = NOT_FOUND walau bagi pemegang manage; setelah dipulihkan terbaca lagi', async () => {
    await openCase('c1');
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-13T00:00:00.000Z', deleted_by = 'x' WHERE id = 'sn-c1'",
    ).run();
    expect((await getCase(SERIAL_USERS.viewer, 'c1')).error.code).toBe('NOT_FOUND');
    expect((await getCase('admin@gmail.com', 'c1')).error.code).toBe('NOT_FOUND');
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '', deleted_by = '' WHERE id = 'sn-c1'",
    ).run();
    expect((await getCase(SERIAL_USERS.viewer, 'c1')).ok).toBe(true);
  });

  test('ditutup lewat declare_broken: closedBy dan tim penutup dari kejadian penutup, hasil rusak', async () => {
    await openCase('c1', { status: 'diagnosis', custody: 'service' });
    const closed = await call(SVC, 'serials.act', {
      id: 'sn-c1',
      expectedUpdatedAt: await serialUpdatedAt('sn-c1'),
      action: 'declare_broken',
      occurredOn: '2026-11-14',
      message: 'Papan utama terbakar',
    });
    expect(closed.ok).toBe(true);
    const detail = (await getCase(SERIAL_USERS.viewer, 'c1')).data as Json;
    expect(detail.closedOn).toBe('2026-11-14');
    expect(detail.outcome).toBe('broken');
    expect(detail.closedBy).toBe('Sari Servis');
    expect(detail.closedByTeam).toBe('service');
    expect(detail.serialStatus).toBe('broken');
  });

  test('ditutup lewat recheck_pass: closedBy = pencek ulang, hasil lolos, status serial Lolos', async () => {
    await openCase('c1');
    const closed = await call(W, 'serials.act', {
      id: 'sn-c1',
      expectedUpdatedAt: await serialUpdatedAt('sn-c1'),
      action: 'recheck_pass',
      occurredOn: '2026-11-14',
      message: '',
      stickerIds: [],
    });
    expect(closed.ok).toBe(true);
    const detail = (await getCase(SERIAL_USERS.viewer, 'c1')).data as Json;
    expect(detail.closedOn).toBe('2026-11-14');
    expect(detail.outcome).toBe('good');
    expect(detail.closedBy).toBe('Wati Pencatat');
    expect(detail.closedByTeam).toBe('qc');
    expect(detail.serialStatus).toBe('good');
  });

  test('id kosong = VALIDATION', async () => {
    const result = await call(SERIAL_USERS.viewer, 'serialCases.get', { id: '' });
    expect(result.ok).toBe(false);
  });
});
