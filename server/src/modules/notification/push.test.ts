import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { startNotificationLoop } from '@server/jobs/runner';
import { createFakePush, type FakePush } from '@server-test/fake-push';
import { ENV, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { deliverPendingPushes, PUSH_MAX_AGE_MS } from './push';
import { endpointHash } from './push-service';
import { insertNotificationStmts, type NewNotification } from './repo';

setDefaultTimeout(60_000);

let env: TestEnv;
let push: FakePush;
const realError = console.error;

const VIEWER = 'viewer@gmail.com';
const QC = 'qc@gmail.com';
const NOW = Date.parse('2026-10-15T03:00:00.000Z');
const EP = (name: string) => `https://push.example.test/${name}`;

beforeEach(async () => {
  push = createFakePush();
  env = await createTestEnv({ PUSH: push, VAPID_PUBLIC_KEY: 'pub' });
  env.clock.set(NOW);
  await seedHandoverEnv(env);
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

function note(overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    recipient: VIEWER,
    kind: 'commented',
    handoverId: 'h1',
    locationId: ENV.locA,
    number: 'ST-20261015-001',
    customerName: 'PT Maju',
    actorEmail: QC,
    actorName: 'Qi',
    count: 0,
    preview: 'RAHASIA-ISI-KOMENTAR',
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

async function insert(...rows: NewNotification[]): Promise<void> {
  await env.DB.batch(insertNotificationStmts(env.DB, rows));
}

async function subscribe(recipient: string, name: string, extra: { failCount?: number } = {}) {
  const endpoint = EP(name);
  await env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at, fail_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      endpointHash(endpoint),
      recipient,
      endpoint,
      `p-${name}`,
      `a-${name}`,
      new Date(NOW).toISOString(),
      extra.failCount ?? 0,
    )
    .run();
  return endpoint;
}

async function states(): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT push_state FROM notifications ORDER BY created_at, id',
  ).all<{
    push_state: string;
  }>();
  return rows.results.map((r) => r.push_state);
}

async function subRows(recipient: string) {
  return (
    await env.DB.prepare(
      'SELECT endpoint, fail_count, last_ok_at, last_error FROM push_subscriptions WHERE recipient = ? ORDER BY endpoint',
    )
      .bind(recipient)
      .all<{ endpoint: string; fail_count: number; last_ok_at: string; last_error: string }>()
  ).results;
}

describe('deliverPendingPushes', () => {
  test('terkirim ke semua langganan penerima; sent, last_ok_at, dan fail_count direset', async () => {
    await subscribe(VIEWER, 'a');
    await subscribe(VIEWER, 'b', { failCount: 2 });
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(1);
    expect(push.sent.map((s) => s.sub.endpoint).sort()).toEqual([EP('a'), EP('b')]);
    expect(await states()).toEqual(['sent']);
    const subs = await subRows(VIEWER);
    expect(subs.every((s) => s.fail_count === 0 && s.last_ok_at !== '')).toBe(true);
    // Sudah ditandai: putaran berikutnya tak mengirim ulang.
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(push.sent).toHaveLength(2);
  });

  test('muatan hanya nomor, customer, judul, url, tag; tanpa cuplikan komentar/catatan', async () => {
    await subscribe(VIEWER, 'a');
    await insert(
      note(),
      note({ kind: 'updated', handoverId: 'h2', createdAt: new Date(NOW + 1).toISOString() }),
    );
    await deliverPendingPushes(env);
    expect(push.sent).toHaveLength(2);
    for (const { payload } of push.sent) {
      expect(payload).not.toContain('RAHASIA-ISI-KOMENTAR');
      const parsed = JSON.parse(payload) as Record<string, string>;
      expect(Object.keys(parsed).sort()).toEqual(['body', 'tag', 'title', 'url']);
    }
    const first = JSON.parse(push.sent[0]?.payload ?? '{}') as Record<string, string>;
    expect(first.title).toBe('Qi mengomentari task ST-20261015-001');
    expect(first.body).toBe('ST-20261015-001 - PT Maju');
    expect(first.url).toBe('/handover/h1');
    expect(first.tag).toBe('commented:h1');
  });

  test('langganan gone (410) dihapus; semua gagal -> failed dan fail_count naik', async () => {
    const gone = await subscribe(VIEWER, 'gone');
    const bad = await subscribe(VIEWER, 'bad');
    push.setResult(gone, { ok: false, gone: true, error: 'http 410' });
    push.setResult(bad, { ok: false, gone: false, error: 'http 500' });
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['failed']);
    const subs = await subRows(VIEWER);
    expect(subs.map((s) => s.endpoint)).toEqual([bad]);
    expect(subs[0]).toMatchObject({ fail_count: 1, last_error: 'http 500' });
  });

  test('minimal satu sukses -> sent walau langganan lain gagal', async () => {
    await subscribe(VIEWER, 'ok');
    const bad = await subscribe(VIEWER, 'bad');
    push.setResult(bad, { ok: false, gone: false, error: 'timeout' });
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(1);
    expect(await states()).toEqual(['sent']);
  });

  test('pengirim yang melempar dihitung gagal, tidak menghentikan putaran', async () => {
    await subscribe(VIEWER, 'a');
    push.send = () => Promise.reject(new Error('rusak'));
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['failed']);
  });

  test('akun dinonaktifkan sebelum kirim -> skipped, nol pengiriman (Review Focus 3)', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note());
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(VIEWER).run();
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['skipped']);
    expect(push.sent).toEqual([]);
  });

  test('izin lokasi dicabut sebelum kirim -> skipped, nol pengiriman (Review Focus 3)', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note());
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: ENV.locA, roleIds: ['role-item'] }]), VIEWER)
      .run();
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['skipped']);
    expect(push.sent).toEqual([]);
  });

  test('preferensi dimatikan, tanpa langganan, atau pengirim tak dikonfigurasi -> skipped', async () => {
    await subscribe(VIEWER, 'a');
    await env.DB.prepare(
      "INSERT INTO notification_prefs (recipient, push_enabled, updated_at) VALUES (?, 0, '')",
    )
      .bind(VIEWER)
      .run();
    await insert(note());
    // QC tanpa langganan sama sekali.
    await insert(note({ recipient: QC, createdAt: new Date(NOW + 1).toISOString() }));
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['skipped', 'skipped']);
    expect(push.sent).toEqual([]);

    const noPush = await createTestEnv();
    await seedHandoverEnv(noPush);
    noPush.clock.set(NOW);
    await noPush.DB.batch(insertNotificationStmts(noPush.DB, [note()]));
    expect(await deliverPendingPushes(noPush)).toBe(0);
    const row = await noPush.DB.prepare('SELECT push_state FROM notifications').first<{
      push_state: string;
    }>();
    expect(row?.push_state).toBe('skipped');
  });

  test('notifikasi lebih tua dari 10 menit -> skipped', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note({ createdAt: new Date(NOW - PUSH_MAX_AGE_MS - 1000).toISOString() }));
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['skipped']);
  });

  test('dua akun berbagi satu endpoint: masing-masing menerima notifikasinya sendiri', async () => {
    const shared = await subscribe(VIEWER, 'sama');
    await subscribe(QC, 'sama');
    await insert(
      note({ recipient: VIEWER, number: 'ST-V' }),
      note({ recipient: QC, number: 'ST-Q', createdAt: new Date(NOW + 1).toISOString() }),
    );
    expect(await deliverPendingPushes(env)).toBe(2);
    expect(push.sent.map((s) => s.sub.endpoint)).toEqual([shared, shared]);
    const bodies = push.sent.map((s) => (JSON.parse(s.payload) as { body: string }).body);
    expect(bodies[0]).toContain('ST-V');
    expect(bodies[1]).toContain('ST-Q');
  });

  test('gone menghapus langganan semua pengguna yang berbagi endpoint', async () => {
    const shared = await subscribe(VIEWER, 'sama');
    await subscribe(QC, 'sama');
    push.setResult(shared, { ok: false, gone: true, error: 'http 404' });
    await insert(note());
    await deliverPendingPushes(env);
    expect(await subRows(VIEWER)).toEqual([]);
    expect(await subRows(QC)).toEqual([]);
  });
});

describe('putaran latar', () => {
  test('startNotificationLoop mengirim push untuk notifikasi pending', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note());
    const stop = startNotificationLoop(env, { intervalMs: 20 });
    try {
      const deadline = Date.now() + 15_000;
      while (push.sent.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(push.sent).toHaveLength(1);
    } finally {
      await stop();
    }
  });
});
