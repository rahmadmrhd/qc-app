import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { NOTIFICATION_PREVIEW_MAX } from '@shared/notifications';
import {
  countUnread,
  insertNotificationStmts,
  listNotifications,
  markAllRead,
  markRead,
  type NewNotification,
  purgeOldNotifications,
} from './repo';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

const ME = 'me@gmail.com';
const OTHER = 'other@gmail.com';
const BASE = Date.parse('2026-06-01T00:00:00.000Z');

function row(overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    recipient: ME,
    kind: 'created',
    handoverId: 'h1',
    locationId: 'loc-a',
    number: 'ST-20260601-001',
    customerName: 'PT Maju',
    actorEmail: 'wh@gmail.com',
    actorName: 'Budi',
    count: 0,
    preview: '',
    createdAt: new Date(BASE).toISOString(),
    ...overrides,
  };
}

/** Baris pada menit ke-`minute` sejak BASE. */
function at(minute: number, overrides: Partial<NewNotification> = {}): NewNotification {
  return row({ createdAt: new Date(BASE + minute * 60_000).toISOString(), ...overrides });
}

async function insert(...rows: NewNotification[]): Promise<void> {
  await env.DB.batch(insertNotificationStmts(env.DB, rows));
}

describe('listNotifications', () => {
  test('terbaru dulu, dipetakan ke DTO (actor = nama pelaku, readAt kosong)', async () => {
    await insert(
      at(1, { number: 'ST-1', customerName: 'A' }),
      at(3, { kind: 'checked', count: 4, number: 'ST-3', actorName: 'Sari' }),
      at(2, { number: 'ST-2' }),
    );
    const page = await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 10 });
    expect(page.items.map((n) => n.number)).toEqual(['ST-3', 'ST-2', 'ST-1']);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      kind: 'checked',
      handoverId: 'h1',
      locationId: 'loc-a',
      customerName: 'PT Maju',
      actor: 'Sari',
      count: 4,
      preview: '',
      readAt: '',
    });
    expect(typeof page.items[0]?.id).toBe('string');
  });

  test('kursor menghasilkan halaman berikutnya tanpa tumpang tindih, termasuk waktu yang sama', async () => {
    await insert(
      at(1, { number: 'ST-1' }),
      at(2, { number: 'ST-2' }),
      at(3, { number: 'ST-3a' }),
      at(3, { number: 'ST-3b' }),
      at(4, { number: 'ST-4' }),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listNotifications(env, ME, {
        locationIds: ['loc-a'],
        limit: 2,
        before: cursor,
      });
      seen.push(...page.items.map((n) => n.number));
      if (page.nextCursor === null) break;
      expect(page.items).toHaveLength(2);
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe('ST-4');
    expect(seen.slice(-2)).toEqual(['ST-2', 'ST-1']);
  });

  test('halaman terakhir tepat penuh tidak memberi kursor', async () => {
    await insert(at(1), at(2));
    const page = await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('kursor rusak menghasilkan halaman kosong', async () => {
    await insert(at(1));
    const page = await listNotifications(env, ME, {
      locationIds: ['loc-a'],
      limit: 10,
      before: 'tanpa-pemisah',
    });
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  test('hanya milik penerima dan hanya lokasi yang diberikan; locationIds kosong = kosong', async () => {
    await insert(
      at(1, { number: 'A' }),
      at(2, { number: 'B', locationId: 'loc-b' }),
      at(3, { number: 'C', recipient: OTHER }),
    );
    const onlyA = await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 10 });
    expect(onlyA.items.map((n) => n.number)).toEqual(['A']);
    const both = await listNotifications(env, ME, { locationIds: ['loc-a', 'loc-b'], limit: 10 });
    expect(both.items.map((n) => n.number)).toEqual(['B', 'A']);
    const none = await listNotifications(env, ME, { locationIds: [], limit: 10 });
    expect(none).toEqual({ items: [], nextCursor: null });
  });
});

describe('countUnread', () => {
  test('memakai filter lokasi dan penerima yang sama; yang dibaca tidak dihitung', async () => {
    await insert(at(1), at(2), at(3, { locationId: 'loc-b' }), at(4, { recipient: OTHER }));
    expect(await countUnread(env, ME, ['loc-a'])).toBe(2);
    expect(await countUnread(env, ME, ['loc-a', 'loc-b'])).toBe(3);
    expect(await countUnread(env, ME, [])).toBe(0);
    expect(await countUnread(env, ME, ['loc-x'])).toBe(0);
    const first = (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 1 })).items[0];
    await markRead(env, ME, first?.id ?? '', new Date(BASE).toISOString());
    expect(await countUnread(env, ME, ['loc-a'])).toBe(1);
  });
});

describe('markRead', () => {
  test('menandai milik sendiri; id milik orang lain false dan tidak mengubah apa pun', async () => {
    await insert(at(1, { recipient: OTHER }), at(2));
    const mine = (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 5 })).items[0];
    const theirs = (await listNotifications(env, OTHER, { locationIds: ['loc-a'], limit: 5 }))
      .items[0];
    const now = '2026-06-02T00:00:00.000Z';
    expect(await markRead(env, ME, theirs?.id ?? '', now)).toBe(false);
    expect(
      (await listNotifications(env, OTHER, { locationIds: ['loc-a'], limit: 5 })).items[0]?.readAt,
    ).toBe('');
    expect(await markRead(env, ME, mine?.id ?? '', now)).toBe(true);
    expect(
      (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 5 })).items[0]?.readAt,
    ).toBe(now);
    expect(await markRead(env, ME, 'tidak-ada', now)).toBe(false);
  });

  test('menandai ulang tetap true dan mempertahankan waktu baca pertama', async () => {
    await insert(at(1));
    const item = (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 5 })).items[0];
    await markRead(env, ME, item?.id ?? '', '2026-06-02T00:00:00.000Z');
    expect(await markRead(env, ME, item?.id ?? '', '2026-06-03T00:00:00.000Z')).toBe(true);
    const after = (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 5 })).items[0];
    expect(after?.readAt).toBe('2026-06-02T00:00:00.000Z');
  });
});

describe('markAllRead', () => {
  test('hanya milik pemanggil', async () => {
    await insert(at(1), at(2), at(3, { recipient: OTHER }));
    const now = '2026-06-02T00:00:00.000Z';
    expect(await markAllRead(env, ME, now)).toBe(2);
    expect(await countUnread(env, ME, ['loc-a'])).toBe(0);
    expect(await countUnread(env, OTHER, ['loc-a'])).toBe(1);
    expect(await markAllRead(env, ME, now)).toBe(0);
  });
});

describe('insertNotificationStmts', () => {
  test('daftar kosong tanpa pernyataan; banyak baris dipotong per pernyataan', async () => {
    expect(insertNotificationStmts(env.DB, [])).toEqual([]);
    const rows = Array.from({ length: 250 }, (_, i) => at(i, { number: `ST-${i}` }));
    const statements = insertNotificationStmts(env.DB, rows);
    expect(statements).toHaveLength(3);
    await env.DB.batch(statements);
    expect(await countUnread(env, ME, ['loc-a'])).toBe(250);
  });

  test('preview dipotong ke batas dan push_state bawaan pending', async () => {
    await insert(row({ kind: 'commented', preview: 'x'.repeat(500) }));
    const item = (await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 1 })).items[0];
    expect(item?.preview).toHaveLength(NOTIFICATION_PREVIEW_MAX);
    const state = await env.DB.prepare('SELECT push_state FROM notifications').first<{
      push_state: string;
    }>();
    expect(state?.push_state).toBe('pending');
  });
});

describe('purgeOldNotifications', () => {
  test('membuang baris berumur 91 hari dan menyisakan 89 hari (jam env.NOW)', async () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    env.clock.set(now);
    const day = 86_400_000;
    await insert(
      row({ number: 'OLD', createdAt: new Date(now - 91 * day).toISOString() }),
      row({ number: 'NEW', createdAt: new Date(now - 89 * day).toISOString() }),
    );
    expect(await purgeOldNotifications(env)).toBe(1);
    const left = await listNotifications(env, ME, { locationIds: ['loc-a'], limit: 10 });
    expect(left.items.map((n) => n.number)).toEqual(['NEW']);
  });

  test('ada indeks yang dimulai dari created_at untuk pembersihan (migrasi 0014)', async () => {
    const rows = await env.DB.prepare(
      "SHOW INDEX FROM notifications WHERE Key_name = 'notifications_created'",
    ).all<{ Column_name: string; Seq_in_index: number | string }>();
    expect(rows.results.map((r) => r.Column_name)).toEqual(['created_at']);
  });
});
