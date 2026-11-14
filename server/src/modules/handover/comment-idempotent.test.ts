import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

const comment = (extra: Record<string, unknown> = {}, email = 'viewer@gmail.com') =>
  call(email, 'handovers.comment', {
    id: 't1',
    locationId: ENV.locA,
    quote: '',
    before: '',
    after: '',
    body: 'Halo',
    ...extra,
  });

const count = async (table: string): Promise<number> =>
  Number(
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0,
  );

async function task(id = 't1'): Promise<{ updated_at: string; version: number }> {
  const row = await env.DB.prepare('SELECT updated_at, version FROM handovers WHERE id = ?')
    .bind(id)
    .first<{ updated_at: string; version: number }>();
  if (!row) throw new Error(`task ${id} tidak ada`);
  return row;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
  await seedHandoverEnv(env);
  await seedHandover(env, {
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerId: '',
    customerName: '',
    note: '- [ ] A',
  });
});

describe('komentar idempoten lewat clientId', () => {
  test('clientId baru disimpan pada baris komentar', async () => {
    const clientId = crypto.randomUUID();
    const out = await comment({ clientId });
    expect(out.ok).toBe(true);
    expect(out.data.comments).toHaveLength(1);
    const row = await env.DB.prepare('SELECT client_id FROM handover_comments').first<{
      client_id: string | null;
    }>();
    expect(row?.client_id).toBe(clientId);
  });

  test('kirim ulang yang sama: DTO sama, nol baris/audit/notifikasi baru, updatedAt tak berubah', async () => {
    const clientId = crypto.randomUUID();
    const first = await comment({ clientId });
    expect(first.ok).toBe(true);
    const before = {
      comments: await count('handover_comments'),
      audit: await count('audit_log'),
      notifications: await count('notifications'),
      pending: await count('notification_pending'),
      pendingItems: await count('notification_pending_items'),
      task: await task(),
    };
    env.clock.advance(5000);
    const again = await comment({ clientId });
    expect(again.ok).toBe(true);
    expect(again.data).toEqual(first.data);
    expect(again.data.comments).toHaveLength(1);
    expect({
      comments: await count('handover_comments'),
      audit: await count('audit_log'),
      notifications: await count('notifications'),
      pending: await count('notification_pending'),
      pendingItems: await count('notification_pending_items'),
      task: await task(),
    }).toEqual(before);
  });

  test('clientId milik pelaku lain: CONFLICT generik tanpa nomor task, email, atau id', async () => {
    const clientId = crypto.randomUUID();
    expect((await comment({ clientId }, 'viewer@gmail.com')).ok).toBe(true);
    const other = await comment({ clientId }, 'wh@gmail.com');
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('CONFLICT');
    const text = JSON.stringify(other.error);
    expect(text).not.toContain('ST-20261015-001');
    expect(text).not.toContain('viewer@gmail.com');
    expect(text).not.toContain('t1');
    expect(await count('handover_comments')).toBe(1);
  });

  test('clientId milik komentar di task lain atau lokasi lain: CONFLICT generik', async () => {
    await seedHandover(env, {
      id: 't2',
      number: 'ST-20261015-002',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] B',
    });
    await seedHandover(env, {
      id: 't3',
      number: 'ST-20261015-003',
      locationId: ENV.locB,
      customerId: '',
      customerName: '',
      note: '- [ ] C',
    });
    const clientId = crypto.randomUUID();
    expect((await comment({ clientId })).ok).toBe(true);
    const otherTask = await comment({ id: 't2', clientId });
    expect(otherTask.ok).toBe(false);
    expect(otherTask.error.code).toBe('CONFLICT');
    const otherLocation = await call('multi@gmail.com', 'handovers.comment', {
      id: 't3',
      locationId: ENV.locB,
      quote: '',
      before: '',
      after: '',
      body: 'Halo',
      clientId,
    });
    expect(otherLocation.ok).toBe(false);
    expect(otherLocation.error.code).toBe('CONFLICT');
    for (const result of [otherTask, otherLocation]) {
      const text = JSON.stringify(result.error);
      expect(text).not.toContain('ST-2026');
      expect(text).not.toContain('viewer@gmail.com');
      expect(text).not.toContain('t1');
    }
    expect(await count('handover_comments')).toBe(1);
  });

  test('clientId bukan UUID huruf kecil 36 karakter: VALIDATION', async () => {
    for (const clientId of [
      'abc',
      crypto.randomUUID().toUpperCase(),
      `${crypto.randomUUID()}0`,
      42,
      {},
    ]) {
      const out = await comment({ clientId });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
      expect(out.error.fields.clientId).toBeDefined();
    }
    expect(await count('handover_comments')).toBe(0);
  });

  test('clientId kosong atau tidak ada = perilaku lama (komentar ganda diperbolehkan)', async () => {
    expect((await comment()).ok).toBe(true);
    expect((await comment()).ok).toBe(true);
    expect((await comment({ clientId: '' })).ok).toBe(true);
    expect((await comment({ clientId: '' })).ok).toBe(true);
    expect(await count('handover_comments')).toBe(4);
  });

  test('replay atas task yang kini dibatalkan tetap mengembalikan DTO', async () => {
    const clientId = crypto.randomUUID();
    const first = await comment({ clientId });
    expect(first.ok).toBe(true);
    const cancel = await call('wh@gmail.com', 'handovers.cancel', {
      id: 't1',
      locationId: ENV.locA,
    });
    expect(cancel.ok).toBe(true);
    const again = await comment({ clientId });
    expect(again.ok).toBe(true);
    expect(again.data.status).toBe('cancelled');
    expect(again.data.comments).toHaveLength(1);
    // komentar baru (tanpa replay) tetap ditolak pada task Dibatalkan
    const fresh = await comment({ clientId: crypto.randomUUID() });
    expect(fresh.ok).toBe(false);
    expect(await count('handover_comments')).toBe(1);
  });

  test('dua permintaan serentak ber-clientId sama: tepat satu baris, keduanya sukses dengan komentar itu sekali', async () => {
    const clientId = crypto.randomUUID();
    const [a, b] = await Promise.all([comment({ clientId }), comment({ clientId })]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.data.comments).toHaveLength(1);
    expect(b.data.comments).toHaveLength(1);
    expect(a.data.comments[0].id).toBe(b.data.comments[0].id);
    expect(await count('handover_comments')).toBe(1);
    expect(await count('audit_log')).toBe(1);
  });
});
