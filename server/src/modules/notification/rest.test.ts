import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV, seedHandoverEnv } from '@server-test/handover-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { NotificationDto } from '@shared/notifications';
import { insertNotificationStmts, type NewNotification } from './repo';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const VIEWER = 'viewer@gmail.com';
const QC = 'qc@gmail.com';
const BASE = Date.parse('2026-10-15T03:00:00.000Z');

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(BASE + 3_600_000);
  rest = restClient(env);
  await seedHandoverEnv(env);
});

function row(minute: number, overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    recipient: VIEWER,
    kind: 'commented',
    handoverId: 'h1',
    locationId: ENV.locA,
    number: `ST-${minute}`,
    customerName: 'PT Maju',
    actorEmail: QC,
    actorName: 'Qi',
    count: 0,
    preview: 'isi komentar',
    createdAt: new Date(BASE + minute * 60_000).toISOString(),
    ...overrides,
  };
}

async function insert(...rows: NewNotification[]): Promise<void> {
  await env.DB.batch(insertNotificationStmts(env.DB, rows));
}

interface ListBody {
  items: NotificationDto[];
  unread: number;
  nextCursor: string | null;
}
async function list(email: string, query = ''): Promise<ListBody> {
  const response = await rest.get(`/notifications${query}`, { email });
  expect(response.status).toBe(200);
  return (await jsonOf(response)) as unknown as ListBody;
}

describe('notifications.list', () => {
  test('pengguna hanya melihat miliknya; terbaru dulu; cuplikan ikut', async () => {
    await insert(row(1), row(2), row(3, { recipient: QC, locationId: ENV.locA }));
    const mine = await list(VIEWER);
    expect(mine.items.map((n) => n.number)).toEqual(['ST-2', 'ST-1']);
    expect(mine.unread).toBe(2);
    expect(mine.nextCursor).toBeNull();
    expect(mine.items[0]).toMatchObject({
      kind: 'commented',
      handoverId: 'h1',
      locationId: ENV.locA,
      actor: 'Qi',
      preview: 'isi komentar',
      readAt: '',
    });
    const other = await list(QC);
    expect(other.items.map((n) => n.number)).toEqual(['ST-3']);
  });

  test('tanpa sesi -> 401', async () => {
    const response = await rest.get('/notifications', { email: null });
    expect(response.status).toBe(401);
    const post = await rest.post('/notifications/read-all', { email: null });
    expect(post.status).toBe(401);
  });

  test('lokasi tanpa hak baca tidak ikut (tidak membocorkan lokasi lain)', async () => {
    // viewer@ hanya berhak di loc-a; notifikasi loc-b (mis. sisa akses lama) tersembunyi.
    await insert(row(1), row(2, { locationId: ENV.locB, number: 'ST-B' }));
    const body = await list(VIEWER);
    expect(body.items.map((n) => n.number)).toEqual(['ST-1']);
    expect(body.unread).toBe(1);
  });

  test('izin lokasi dicabut setelah notifikasi dibuat -> tersembunyi dan unread turun (Review Focus 3)', async () => {
    await insert(row(1), row(2));
    expect((await list(VIEWER)).unread).toBe(2);
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: ENV.locA, roleIds: ['role-item'] }]), VIEWER)
      .run();
    const after = await list(VIEWER);
    expect(after.items).toEqual([]);
    expect(after.unread).toBe(0);
    // Akses dipulihkan: notifikasi lama kembali terlihat (data tidak dihapus).
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: ENV.locA, roleIds: ['role-view'] }]), VIEWER)
      .run();
    expect((await list(VIEWER)).items).toHaveLength(2);
  });

  test('lokasi dinonaktifkan -> tersembunyi', async () => {
    await insert(row(1));
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = ?")
      .bind(ENV.locA)
      .run();
    const body = await list(VIEWER);
    expect(body.items).toEqual([]);
    expect(body.unread).toBe(0);
  });

  test('akun dinonaktifkan -> sesi ditolak', async () => {
    await insert(row(1));
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(VIEWER).run();
    const response = await rest.get('/notifications', { email: VIEWER });
    expect(response.status).toBeGreaterThanOrEqual(401);
  });

  test('limit di atas 100 dibatasi 100 dan kursor melanjutkan tanpa tumpang tindih', async () => {
    await insert(...Array.from({ length: 105 }, (_, i) => row(i + 1)));
    const first = await list(VIEWER, '?limit=500');
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    expect(first.unread).toBe(105);
    const second = await list(
      VIEWER,
      `?limit=100&before=${encodeURIComponent(first.nextCursor as string)}`,
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((n) => n.id));
    expect(ids.size).toBe(105);
  });

  test('bawaan 30 per halaman; limit tidak valid -> 422', async () => {
    await insert(...Array.from({ length: 35 }, (_, i) => row(i + 1)));
    expect((await list(VIEWER)).items).toHaveLength(30);
    const bad = await rest.get('/notifications?limit=0', { email: VIEWER });
    expect(bad.status).toBe(422);
  });
});

describe('notifications.markRead / markAllRead', () => {
  test('markRead milik sendiri -> ok dan unread turun', async () => {
    await insert(row(1), row(2));
    const [first] = (await list(VIEWER)).items;
    const response = await rest.post(`/notifications/${first?.id}/read`, { email: VIEWER });
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ ok: true });
    const after = await list(VIEWER);
    expect(after.unread).toBe(1);
    expect(after.items.find((n) => n.id === first?.id)?.readAt).not.toBe('');
  });

  test('markRead id milik orang lain atau tak ada -> 404 NOT_FOUND, tanpa mengubah apa pun', async () => {
    await insert(row(1, { recipient: QC }));
    const [theirs] = (await list(QC)).items;
    const other = await rest.post(`/notifications/${theirs?.id}/read`, { email: VIEWER });
    expect(other.status).toBe(404);
    expect(await jsonOf(other)).toMatchObject({ code: 'NOT_FOUND' });
    const missing = await rest.post('/notifications/tidak-ada/read', { email: VIEWER });
    expect(missing.status).toBe(404);
    expect((await list(QC)).unread).toBe(1);
  });

  test('markAllRead hanya baris pemanggil', async () => {
    await insert(row(1), row(2), row(3, { recipient: QC }));
    const response = await rest.post('/notifications/read-all', { email: VIEWER });
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ count: 2 });
    expect((await list(VIEWER)).unread).toBe(0);
    expect((await list(QC)).unread).toBe(1);
  });
});
