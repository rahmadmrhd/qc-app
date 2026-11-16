import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { callRest, ENV, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

const makeTasks = (clientIds: Array<string | undefined>) =>
  clientIds.map((clientId, i) => ({
    customerName: `PT Idem ${i + 1}`,
    note: `- [ ] butir ${i + 1}`,
    ...(clientId === undefined ? {} : { clientId }),
  }));

const saveBatch = (
  tasks: Array<Record<string, unknown>>,
  email = 'wh@gmail.com',
  locationId: string = ENV.locA,
) => call(email, 'handovers.saveBatch', { locationId, tasks });

const count = async (table: string): Promise<number> =>
  Number(
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0,
  );

async function counters(): Promise<Array<{ key: string; value: number }>> {
  const rows = await env.DB.prepare('SELECT `key`, value FROM counters ORDER BY `key`').all<{
    key: string;
    value: number;
  }>();
  return rows.results.map((row) => ({ key: row.key, value: Number(row.value) }));
}

async function snapshot() {
  return {
    handovers: await count('handovers'),
    customers: await count('customers'),
    audit: await count('audit_log'),
    notifications: await count('notifications'),
    pending: await count('notification_pending'),
    counters: await counters(),
  };
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
  await seedHandoverEnv(env);
});

describe('task baru idempoten lewat clientId (saveBatch)', () => {
  test('3 task ber-clientId membuat tiga task dan menyimpan client_id', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const out = await saveBatch(makeTasks(ids));
    expect(out.ok).toBe(true);
    expect(out.data).toHaveLength(3);
    const rows = await env.DB.prepare(
      'SELECT number, client_id FROM handovers ORDER BY number',
    ).all<{
      number: string;
      client_id: string | null;
    }>();
    expect(rows.results.map((row) => row.client_id)).toEqual(ids);
  });

  test('kirim ulang yang sama: DTO urut input, nol task/customer/nomor/audit/notifikasi baru', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const first = await saveBatch(makeTasks(ids));
    expect(first.ok).toBe(true);
    const before = await snapshot();
    env.clock.advance(5000);
    const again = await saveBatch(makeTasks(ids));
    expect(again.ok).toBe(true);
    expect(again.data).toEqual(first.data);
    expect(again.data.map((task: { note: string }) => task.note)).toEqual([
      '- [ ] butir 1',
      '- [ ] butir 2',
      '- [ ] butir 3',
    ]);
    expect(await snapshot()).toEqual(before);
  });

  test('sebagian clientId sudah ada: CONFLICT generik dan tidak ada yang tertulis', async () => {
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    expect((await saveBatch(makeTasks([a, b]))).ok).toBe(true);
    const before = await snapshot();
    const partial = await saveBatch(makeTasks([a, b, c]));
    expect(partial.ok).toBe(false);
    expect(partial.error.code).toBe('CONFLICT');
    expect(JSON.stringify(partial.error)).not.toContain('ST-2026');
    expect(await snapshot()).toEqual(before);
  });

  test('clientId milik pelaku lain atau lokasi lain: CONFLICT generik', async () => {
    const own = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await saveBatch(makeTasks(own))).ok).toBe(true);
    const before = await snapshot();
    const otherActor = await saveBatch(makeTasks(own), 'multi@gmail.com');
    expect(otherActor.ok).toBe(false);
    expect(otherActor.error.code).toBe('CONFLICT');
    expect(JSON.stringify(otherActor.error)).not.toContain('wh@gmail.com');
    expect(JSON.stringify(otherActor.error)).not.toContain('ST-2026');
    // pelaku sama, lokasi lain
    const multi = [crypto.randomUUID()];
    expect((await saveBatch(makeTasks(multi), 'multi@gmail.com', ENV.locA)).ok).toBe(true);
    const moved = await saveBatch(makeTasks(multi), 'multi@gmail.com', ENV.locB);
    expect(moved.ok).toBe(false);
    expect(moved.error.code).toBe('CONFLICT');
    expect(JSON.stringify(moved.error)).not.toContain('multi@gmail.com');
    expect(await count('handovers')).toBe(before.handovers + 1);
  });

  test('clientId ganda dalam satu permintaan atau tak valid: VALIDATION', async () => {
    const id = crypto.randomUUID();
    const dup = await saveBatch(makeTasks([id, id]));
    expect(dup.ok).toBe(false);
    expect(dup.error.code).toBe('VALIDATION');
    for (const bad of ['abc', crypto.randomUUID().toUpperCase(), 7]) {
      const out = await saveBatch([{ customerName: '', note: 'x', clientId: bad }]);
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
    }
    expect(await count('handovers')).toBe(0);
  });

  test('dua saveBatch identik serentak: tepat satu set task, keduanya sukses dengan DTO sama', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const [a, b] = await Promise.all([saveBatch(makeTasks(ids)), saveBatch(makeTasks(ids))]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.data).toEqual(b.data);
    expect(await count('handovers')).toBe(3);
    expect(await count('customers')).toBe(3);
    expect(await count('audit_log')).toBe(6);
    expect(await counters()).toEqual([{ key: 'st:20261015', value: 3 }]);
  });

  test('kirim ulang tetap sukses walau customer-nya kini dinonaktifkan (replay sebelum validasi customer)', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const first = await saveBatch(makeTasks(ids));
    expect(first.ok).toBe(true);
    await env.DB.prepare("UPDATE customers SET status = 'inactive'").run();
    const before = await snapshot();
    const again = await saveBatch(makeTasks(ids));
    expect(again.ok).toBe(true);
    expect(again.data).toEqual(first.data);
    expect(await snapshot()).toEqual(before);
    // task baru (tanpa clientId yang sudah ada) tetap menolak customer nonaktif
    const fresh = await saveBatch([
      { customerName: 'PT Idem 1', note: 'x', clientId: crypto.randomUUID() },
    ]);
    expect(fresh.ok).toBe(false);
    expect(fresh.error.code).toBe('VALIDATION');
  });

  test('tanpa clientId = perilaku lama; handovers.save tak berubah', async () => {
    expect((await saveBatch(makeTasks([undefined, undefined]))).ok).toBe(true);
    expect((await saveBatch(makeTasks([undefined, undefined]))).ok).toBe(true);
    const single = await call('wh@gmail.com', 'handovers.save', {
      locationId: ENV.locA,
      customerName: '',
      note: 'x',
    });
    expect(single.ok).toBe(true);
    expect(await count('handovers')).toBe(5);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM handovers WHERE client_id IS NOT NULL',
    ).first<{ n: number }>();
    expect(Number(row?.n)).toBe(0);
  });
});
