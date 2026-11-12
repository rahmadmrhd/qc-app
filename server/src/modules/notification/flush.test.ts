import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { startNotificationLoop, startScheduler } from '@server/jobs/runner';
import { seedUser } from '@server-test/access-fixtures';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { CHECK_WINDOW_MS, NOTIFICATION_RETENTION_DAYS } from '@shared/notifications';
import { flushDueCheckSummaries } from './flush';
import { insertNotificationStmts } from './repo';

setDefaultTimeout(60_000);

let env: TestEnv;
const realError = console.error;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

const ref = { id: 't1', locationId: ENV.locA };
const WH = 'wh@gmail.com';
const QC = 'qc@gmail.com';
const QC2 = 'qc2@gmail.com';
const WH_SIDE = ['multi@gmail.com', 'viewer@gmail.com', 'wh@gmail.com', 'whedit@gmail.com'];
const T0 = Date.parse('2026-10-15T03:00:00.000Z');

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(T0);
  await seedHandoverEnv(env);
  await seedUser(env, {
    id: 'u-qc2',
    email: QC2,
    assignments: [{ locationId: ENV.locA, roleIds: ['role-qc'] }],
  });
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error('waitFor: batas waktu terlampaui');
}

async function seed(note: string, extra: Record<string, unknown> = {}) {
  await seedHandover(env, {
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerId: '',
    customerName: 'PT Maju',
    note,
    ...extra,
  } as Parameters<typeof seedHandover>[1]);
}

async function check(email: string, index: number, text: string, checked = true) {
  const out = await call(email, 'handovers.setCheck', { ...ref, index, text, checked });
  expect(out.ok).toBe(true);
}

interface Row {
  recipient: string;
  kind: string;
  count: number;
  actor_email: string;
  created_at: string;
}
async function rows(kind?: string): Promise<Row[]> {
  const result = await env.DB.prepare(
    'SELECT recipient, kind, `count`, actor_email, created_at FROM notifications ORDER BY recipient, actor_email, kind',
  ).all<Row>();
  return result.results
    .map((row) => ({ ...row, count: Number(row.count) }))
    .filter((row) => kind === undefined || row.kind === kind);
}

async function pendingCount(): Promise<number> {
  const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM notification_pending').first<{
    n: number | string;
  }>();
  const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM notification_pending_items').first<{
    n: number | string;
  }>();
  return Number(a?.n) + Number(b?.n);
}

const items = (n: number) => Array.from({ length: n }, (_, i) => `- [ ] butir ${i + 1}`).join('\n');

describe('jendela 5 menit', () => {
  test('10 centang dalam 3 menit -> satu ringkasan count 10 per penerima WH, tepat setelah 5 menit', async () => {
    await seed(`${items(10)}\n- [ ] sisa`);
    for (let i = 0; i < 10; i++) {
      env.clock.set(T0 + i * 20_000);
      await check(QC, i, `butir ${i + 1}`);
    }
    // Centang tidak langsung menjadi notifikasi.
    expect(await rows()).toEqual([]);
    env.clock.set(T0 + CHECK_WINDOW_MS - 1);
    expect(await flushDueCheckSummaries(env)).toBe(0);
    expect(await rows()).toEqual([]);
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(1);
    const list = await rows();
    expect(list.map((r) => r.recipient).sort()).toEqual(WH_SIDE);
    expect(list.every((r) => r.kind === 'checked' && r.count === 10 && r.actor_email === QC)).toBe(
      true,
    );
    expect(list[0]?.created_at).toBe(new Date(T0 + CHECK_WINDOW_MS).toISOString());
    expect(await pendingCount()).toBe(0);
    // Sudah dilepas: flush berikutnya tak mengirim lagi.
    expect(await flushDueCheckSummaries(env)).toBe(0);
    expect(await rows()).toHaveLength(WH_SIDE.length);
  });

  test('centang ke-2 pada menit 3 tidak memundurkan release_at (tetap sejak yang pertama)', async () => {
    await seed(items(3));
    await check(QC, 0, 'butir 1');
    env.clock.set(T0 + 3 * 60_000);
    await check(QC, 1, 'butir 2');
    const pending = await env.DB.prepare(
      'SELECT first_at, release_at FROM notification_pending',
    ).all<{ first_at: string; release_at: string }>();
    expect(pending.results).toHaveLength(1);
    expect(pending.results[0]).toEqual({
      first_at: new Date(T0).toISOString(),
      release_at: new Date(T0 + CHECK_WINDOW_MS).toISOString(),
    });
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(1);
    expect((await rows())[0]?.count).toBe(2);
  });
});

describe('ringkasan hantu dan notifikasi berantai (Review Focus 4)', () => {
  test('centang lalu lepas butir yang sama -> flush menghasilkan nol baris', async () => {
    await seed(items(2));
    await check(QC, 0, 'butir 1', true);
    env.clock.advance(1000);
    await check(QC, 0, 'butir 1', false);
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(0);
    expect(await rows()).toEqual([]);
    expect(await pendingCount()).toBe(0);
  });

  test('centang butir terakhir yang menyelesaikan task -> satu done, tunggu (termasuk pelaku lain) hilang', async () => {
    await seed(items(3));
    await check(QC2, 0, 'butir 1');
    env.clock.advance(1000);
    await check(QC, 1, 'butir 2');
    expect(await pendingCount()).toBeGreaterThan(0);
    env.clock.advance(1000);
    await check(QC, 2, 'butir 3');
    expect(await pendingCount()).toBe(0);
    const list = await rows();
    expect(list.map((r) => r.kind)).toEqual(['done', 'done', 'done', 'done']);
    expect(list.map((r) => r.recipient).sort()).toEqual(WH_SIDE);
    env.clock.set(T0 + CHECK_WINDOW_MS + 60_000);
    expect(await flushDueCheckSummaries(env)).toBe(0);
    expect(await rows('checked')).toEqual([]);
    expect(await rows()).toHaveLength(WH_SIDE.length);
  });

  test('dua pelaku berbeda -> dua ringkasan terpisah (kunci task, pelaku)', async () => {
    await seed(items(4));
    await check(QC, 0, 'butir 1');
    await check(QC2, 1, 'butir 2');
    await check(QC2, 2, 'butir 3');
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(2);
    const list = await rows('checked');
    expect(list).toHaveLength(WH_SIDE.length * 2);
    expect(list.filter((r) => r.actor_email === QC).every((r) => r.count === 1)).toBe(true);
    expect(list.filter((r) => r.actor_email === QC2).every((r) => r.count === 2)).toBe(true);
  });

  test('cancel saat tunggu -> ringkasan tetap terkirim sesuai jadwal', async () => {
    await seed(items(2));
    await check(QC, 0, 'butir 1');
    env.clock.advance(1000);
    expect((await call(WH, 'handovers.cancel', ref)).ok).toBe(true);
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(1);
    expect(await rows('checked')).toHaveLength(WH_SIDE.length);
    expect((await rows('cancelled')).map((r) => r.recipient).sort()).toEqual([QC, QC2].sort());
  });

  test('butir yang dihapus dari catatan sebelum flush tidak dihitung', async () => {
    await seed('- [ ] A = 1\n- [ ] B = 2\n- [ ] C = 3', {
      checks: [
        { text: 'A = 1', by: 'seed@gmail.com', at: '2026-01-01T00:00:00.000Z', occurrence: 0 },
      ],
    });
    await check(QC, 0, 'A = 1', false);
    await check(QC, 1, 'B = 2', true);
    env.clock.advance(1000);
    const saved = await call(WH, 'handovers.save', {
      ...ref,
      customerName: '',
      note: '- [ ] B = 2\n- [ ] C = 3',
    });
    expect(saved.ok).toBe(true);
    env.clock.set(T0 + CHECK_WINDOW_MS);
    expect(await flushDueCheckSummaries(env)).toBe(1);
    const list = await rows('checked');
    expect(list).toHaveLength(WH_SIDE.length);
    expect(list.every((r) => r.count === 1)).toBe(true);
  });

  test('Promise.all([flush, flush]) -> hasil sama dengan satu flush, tanpa ringkasan ganda', async () => {
    await seed(items(3));
    await check(QC, 0, 'butir 1');
    await check(QC, 1, 'butir 2');
    env.clock.set(T0 + CHECK_WINDOW_MS);
    const [a, b] = await Promise.all([flushDueCheckSummaries(env), flushDueCheckSummaries(env)]);
    expect(a + b).toBe(1);
    const list = await rows('checked');
    expect(list).toHaveLength(WH_SIDE.length);
    expect(list.every((r) => r.count === 2)).toBe(true);
    expect(await pendingCount()).toBe(0);
  });
});

describe('akses saat dilepas', () => {
  test('penerima dihitung saat flush: pengguna yang dinonaktifkan tidak menerima', async () => {
    await seed(items(2));
    await check(QC, 0, 'butir 1');
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?")
      .bind('viewer@gmail.com')
      .run();
    env.clock.set(T0 + CHECK_WINDOW_MS);
    await flushDueCheckSummaries(env);
    expect((await rows('checked')).map((r) => r.recipient).sort()).toEqual([
      'multi@gmail.com',
      'wh@gmail.com',
      'whedit@gmail.com',
    ]);
  });
});

describe('putaran latar', () => {
  test('startNotificationLoop melepas ringkasan yang jatuh tempo', async () => {
    await seed(items(2));
    await check(QC, 0, 'butir 1');
    env.clock.set(T0 + CHECK_WINDOW_MS);
    const stop = startNotificationLoop(env, { intervalMs: 20 });
    try {
      await waitFor(async () => (await rows('checked')).length === WH_SIDE.length);
    } finally {
      await stop();
    }
  });

  test('detak penjadwal membuang notifikasi berumur lebih dari 90 hari', async () => {
    const day = 86_400_000;
    const base = {
      recipient: QC,
      kind: 'created' as const,
      handoverId: 'h1',
      locationId: ENV.locA,
      number: 'ST-1',
      customerName: '',
      actorEmail: WH,
      actorName: 'WH',
      count: 0,
      preview: '',
    };
    await env.DB.batch(
      insertNotificationStmts(env.DB, [
        {
          ...base,
          number: 'LAMA',
          createdAt: new Date(T0 - (NOTIFICATION_RETENTION_DAYS + 1) * day).toISOString(),
        },
        { ...base, number: 'BARU', createdAt: new Date(T0 - 89 * day).toISOString() },
      ]),
    );
    const stop = startScheduler(env, { intervalMs: 10_000 });
    try {
      await waitFor(async () => {
        const left = await env.DB.prepare('SELECT number FROM notifications').all<{
          number: string;
        }>();
        return left.results.length === 1;
      });
      const left = await env.DB.prepare('SELECT number FROM notifications').all<{
        number: string;
      }>();
      expect(left.results[0]?.number).toBe('BARU');
    } finally {
      await stop();
    }
  });
});
