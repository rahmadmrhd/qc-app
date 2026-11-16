import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { notificationTick, startNotificationLoop } from '@server/jobs/runner';
import { createFakePush, type FakePush } from '@server-test/fake-push';
import { callRest, ENV, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  deliverPendingPushes,
  PUSH_MAX_AGE_MS,
  PUSH_PRUNE_AFTER_MS,
  PUSH_PRUNE_FAIL_COUNT,
  type PushSender,
} from './push';
import { endpointHash } from './push-service';
import { insertNotificationStmts, type NewNotification } from './repo';
import { wakeNotifications } from './wake';

setDefaultTimeout(60_000);

let env: TestEnv;
let push: FakePush;
const realError = console.error;

const VIEWER = 'viewer@gmail.com';
const QC = 'qc@gmail.com';
const NOW = Date.parse('2026-10-15T03:00:00.000Z');
const EP = (name: string) => `https://fcm.googleapis.com/${name}`;

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
    preview: 'ISI-KOMENTAR',
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

async function insert(...rows: NewNotification[]): Promise<void> {
  await env.DB.batch(insertNotificationStmts(env.DB, rows));
}

async function subscribe(
  recipient: string,
  name: string,
  extra: { failCount?: number; createdAt?: string; lastOkAt?: string } = {},
) {
  const endpoint = EP(name);
  await env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at, last_ok_at, fail_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      endpointHash(endpoint),
      recipient,
      endpoint,
      `p-${name}`,
      `a-${name}`,
      extra.createdAt ?? new Date(NOW).toISOString(),
      extra.lastOkAt ?? '',
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

  test('muatan: judul, body (nomor - customer + cuplikan isi), url, tag; tanpa kolom lain', async () => {
    await subscribe(VIEWER, 'a');
    await insert(
      note(),
      note({ kind: 'updated', handoverId: 'h2', createdAt: new Date(NOW + 1).toISOString() }),
    );
    await deliverPendingPushes(env);
    expect(push.sent).toHaveLength(2);
    for (const { payload } of push.sent) {
      expect(payload).toContain('ISI-KOMENTAR');
      const parsed = JSON.parse(payload) as Record<string, string>;
      expect(Object.keys(parsed).sort()).toEqual(['body', 'tag', 'title', 'url']);
    }
    // Urutan kirim antar notifikasi tidak dijamin (diproses paralel): ambil menurut tag.
    const first = push.sent
      .map(({ payload }) => JSON.parse(payload) as Record<string, string>)
      .find((parsed) => parsed.tag === 'commented:h1') as Record<string, string>;
    expect(first.title).toBe('Qi mengomentari task ST-20261015-001');
    expect(first.body).toBe('ST-20261015-001 - PT Maju\nISI-KOMENTAR');
    expect(first.url).toBe(`/handover/h1?loc=${ENV.locA}`);
    expect(first.tag).toBe('commented:h1');
  });

  test('langganan gone (410) dihapus; semua gagal -> failed dan fail_count naik', async () => {
    const gone = await subscribe(VIEWER, 'gone');
    const bad = await subscribe(VIEWER, 'bad');
    push.setResult(gone, { ok: false, gone: true, error: 'http 410', prunable: true });
    push.setResult(bad, { ok: false, gone: false, error: 'http 500', prunable: true });
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(await states()).toEqual(['failed']);
    const subs = await subRows(VIEWER);
    expect(subs.map((s) => s.endpoint)).toEqual([bad]);
    expect(subs[0]).toMatchObject({ fail_count: 1, last_error: 'http 500' });
  });

  describe('pemangkasan langganan gagal-terus (keputusan pemilik 2026-11-13)', () => {
    const OLD = new Date(NOW - PUSH_PRUNE_AFTER_MS - 60_000).toISOString();
    const RECENT = new Date(NOW - PUSH_PRUNE_AFTER_MS + 3_600_000).toISOString();
    const FAIL = { ok: false, gone: false, error: 'http 500', prunable: true } as const;
    const names = async () => (await subRows(VIEWER)).map((s) => s.endpoint);

    test('fail_count mencapai ambang dan tak pernah sukses sejak dibuat > 7 hari -> dihapus', async () => {
      const dead = await subscribe(VIEWER, 'dead', {
        failCount: PUSH_PRUNE_FAIL_COUNT - 1,
        createdAt: OLD,
      });
      push.setResult(dead, FAIL);
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([]);
      expect(await states()).toEqual(['failed']);
    });

    test('sukses terakhir (last_ok_at) > 7 hari lalu juga dipangkas walau dibuat jauh lebih lama', async () => {
      const dead = await subscribe(VIEWER, 'dead', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastOkAt: OLD,
      });
      push.setResult(dead, FAIL);
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([]);
    });

    test('galat sisi server (timeout, jaringan, internal) tidak memicu pemangkasan walau ambang dan umur terpenuhi', async () => {
      for (const error of ['timeout', 'jaringan', 'internal', 'waktu habis', 'galat pengirim']) {
        const sub = await subscribe(VIEWER, `srv-${error.replace(' ', '-')}`, {
          failCount: PUSH_PRUNE_FAIL_COUNT + 3,
          createdAt: OLD,
        });
        push.setResult(sub, { ok: false, gone: false, error, prunable: false });
      }
      await insert(note());
      await deliverPendingPushes(env);
      const rows = await subRows(VIEWER);
      expect(rows).toHaveLength(5);
      // fail_count tetap naik (status admin "pengiriman gagal"), hanya penghapusannya yang tak terjadi.
      expect(rows.every((s) => s.fail_count === PUSH_PRUNE_FAIL_COUNT + 4)).toBe(true);
    });

    test('yang menentukan adalah field prunable, bukan teks galat', async () => {
      const keep = await subscribe(VIEWER, 'keep', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      const drop = await subscribe(VIEWER, 'drop', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      push.setResult(keep, { ok: false, gone: false, error: 'http 500', prunable: false });
      push.setResult(drop, { ok: false, gone: false, error: 'teks apa saja', prunable: true });
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([keep]);
    });

    test('pengirim yang melempar atau menggantung (batas waktu) tidak memangkas', async () => {
      const thrower = await subscribe(VIEWER, 'thrower', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      push.setResult(thrower, { ok: false, gone: false, error: 'x', prunable: true });
      // Ganti pengirim dengan yang melempar: hasil dinormalkan menjadi galat sisi server (prunable false).
      (env as { PUSH?: PushSender }).PUSH = {
        send: async () => {
          throw new Error('putus');
        },
      };
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([thrower]);
      expect((await subRows(VIEWER))[0]?.fail_count).toBe(PUSH_PRUNE_FAIL_COUNT + 1);
    });

    test('endpoint tersimpan yang ditolak kebijakan (allowlist menyempit) ikut dipangkas', async () => {
      const stale = await subscribe(VIEWER, 'stale', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      push.setResult(stale, { ok: false, gone: false, error: 'endpoint ditolak', prunable: true });
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([]);
    });

    test('belum mencapai ambang kegagalan -> tetap, walau sudah lama', async () => {
      const slow = await subscribe(VIEWER, 'slow', {
        failCount: PUSH_PRUNE_FAIL_COUNT - 2,
        createdAt: OLD,
      });
      push.setResult(slow, FAIL);
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([slow]);
      expect((await subRows(VIEWER))[0]?.fail_count).toBe(PUSH_PRUNE_FAIL_COUNT - 1);
    });

    test('kegagalan banyak tetapi sukses terakhir masih dalam 7 hari (gangguan sesaat) -> tetap', async () => {
      const flaky = await subscribe(VIEWER, 'flaky', {
        failCount: PUSH_PRUNE_FAIL_COUNT + 5,
        createdAt: OLD,
        lastOkAt: RECENT,
      });
      push.setResult(flaky, FAIL);
      await insert(note());
      await deliverPendingPushes(env);
      expect(await names()).toEqual([flaky]);
    });

    test('hanya baris penerima yang gagal yang dipangkas; langganan sehat dan milik pengguna lain tetap', async () => {
      const dead = await subscribe(VIEWER, 'dead', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      const healthy = await subscribe(VIEWER, 'healthy', {
        failCount: PUSH_PRUNE_FAIL_COUNT,
        createdAt: OLD,
      });
      await subscribe(QC, 'dead', { failCount: PUSH_PRUNE_FAIL_COUNT, createdAt: OLD });
      push.setResult(dead, FAIL);
      await insert(note());
      expect(await deliverPendingPushes(env)).toBe(1);
      expect(await names()).toEqual([healthy]);
      // Baris pengguna lain pada endpoint yang sama tak disentuh (tak ada notifikasinya di putaran ini).
      expect((await subRows(QC)).map((s) => s.endpoint)).toEqual([dead]);
    });
  });

  test('minimal satu sukses -> sent walau langganan lain gagal', async () => {
    await subscribe(VIEWER, 'ok');
    const bad = await subscribe(VIEWER, 'bad');
    push.setResult(bad, { ok: false, gone: false, error: 'timeout', prunable: false });
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
    expect(bodies.some((body) => body.includes('ST-V'))).toBe(true);
    expect(bodies.some((body) => body.includes('ST-Q'))).toBe(true);
  });

  test('perangkat yang dimatikan (muted) dilewati; perangkat lain akun yang sama tetap menerima', async () => {
    const quiet = await subscribe(VIEWER, 'senyap');
    await subscribe(VIEWER, 'aktif');
    await env.DB.prepare('UPDATE push_subscriptions SET muted = 1 WHERE endpoint_hash = ?')
      .bind(endpointHash(quiet))
      .run();
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(1);
    expect(push.sent.map((s) => s.sub.endpoint)).toEqual([EP('aktif')]);
    // Baris yang dimatikan tak disentuh (bukan gagal, bukan dihapus).
    const rows = await subRows(VIEWER);
    expect(rows.find((r) => r.endpoint === quiet)).toMatchObject({ fail_count: 0, last_ok_at: '' });
  });

  test('semua perangkat dimatikan -> skipped, nol pengiriman', async () => {
    await subscribe(VIEWER, 'a');
    await env.DB.prepare('UPDATE push_subscriptions SET muted = 1').run();
    await insert(note());
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(push.sent).toHaveLength(0);
    expect(await states()).toEqual(['skipped']);
  });

  test('gone menghapus langganan semua pengguna yang berbagi endpoint', async () => {
    const shared = await subscribe(VIEWER, 'sama');
    await subscribe(QC, 'sama');
    push.setResult(shared, { ok: false, gone: true, error: 'http 404', prunable: true });
    await insert(note());
    await deliverPendingPushes(env);
    expect(await subRows(VIEWER)).toEqual([]);
    expect(await subRows(QC)).toEqual([]);
  });
});

describe('pengiriman paralel dan anggaran waktu (F2)', () => {
  const useSender = (sender: PushSender) => {
    (env as { PUSH?: PushSender }).PUSH = sender;
  };

  test('pengiriman paralel dibatasi konkurensi dan semuanya tetap terkirim', async () => {
    for (let i = 0; i < 12; i++) await subscribe(VIEWER, `p${i}`);
    await insert(note());
    let active = 0;
    let peak = 0;
    let total = 0;
    useSender({
      async send() {
        active++;
        peak = Math.max(peak, active);
        total++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return { ok: true };
      },
    });
    expect(await deliverPendingPushes(env, { concurrency: 3 })).toBe(1);
    expect(total).toBe(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  test('endpoint yang menggantung kena batas waktu: pengguna lain tetap terkirim, langganan tidak dihapus', async () => {
    await subscribe(VIEWER, 'macet');
    await subscribe(QC, 'normal');
    await insert(
      note({ recipient: VIEWER, number: 'ST-V' }),
      note({ recipient: QC, number: 'ST-Q', createdAt: new Date(NOW + 1).toISOString() }),
    );
    useSender({
      send: (sub) =>
        sub.endpoint === EP('macet')
          ? new Promise<never>(() => undefined)
          : Promise.resolve({ ok: true }),
    });
    const started = Date.now();
    expect(await deliverPendingPushes(env, { sendTimeoutMs: 100 })).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await states()).toEqual(['failed', 'sent']);
    // Tidak ada penghapusan otomatis: baris tetap ada, hanya fail_count naik.
    const subs = await subRows(VIEWER);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.fail_count).toBe(1);
    expect(subs[0]?.last_error).toBe('waktu habis');
  });

  test('anggaran putaran habis: notifikasi yang belum disentuh tetap pending untuk putaran berikutnya', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note(), note({ number: 'ST-2', createdAt: new Date(NOW + 1).toISOString() }));
    expect(await deliverPendingPushes(env, { budgetMs: -1 })).toBe(0);
    expect(push.sent).toHaveLength(0);
    expect(await states()).toEqual(['pending', 'pending']);
    // Putaran berikutnya (anggaran normal) menuntaskannya.
    expect(await deliverPendingPushes(env)).toBe(2);
    expect(await states()).toEqual(['sent', 'sent']);
  });

  test('anggaran habis di tengah satu notifikasi: semua langganannya tetap dikirim, notifikasi yang belum dimulai tetap pending', async () => {
    for (let i = 0; i < 4; i++) await subscribe(VIEWER, `m${i}`);
    await insert(
      note({ number: 'ST-1' }),
      note({ number: 'ST-2', createdAt: new Date(NOW + 1).toISOString() }),
    );
    let started = 0;
    useSender({
      async send() {
        started++;
        // Lebih lama dari anggaran, dan konkurensi 1 membuat langganan 2-4 baru mulai setelah anggaran habis.
        await new Promise((resolve) => setTimeout(resolve, 700));
        return { ok: true };
      },
    });
    const sent = await deliverPendingPushes(env, { concurrency: 1, budgetMs: 1_200 });
    expect(sent).toBe(1);
    expect(started).toBe(4);
    expect(await states()).toEqual(['sent', 'pending']);
    expect((await subRows(VIEWER)).every((sub) => sub.fail_count === 0)).toBe(true);
  });

  test('anggaran habis di tengah putaran: yang sedang berjalan selesai, sisanya pending, tanpa menaikkan fail_count', async () => {
    await subscribe(VIEWER, 'a');
    await insert(
      note({ number: 'ST-1' }),
      note({ number: 'ST-2', createdAt: new Date(NOW + 1).toISOString() }),
      note({ number: 'ST-3', createdAt: new Date(NOW + 2).toISOString() }),
    );
    useSender({
      async send() {
        // Lebih lama dari anggaran: setelah kirim pertama selesai, anggaran sudah habis.
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        return { ok: true };
      },
    });
    const sent = await deliverPendingPushes(env, { concurrency: 1, budgetMs: 1_500 });
    expect(sent).toBe(1);
    expect(await states()).toEqual(['sent', 'pending', 'pending']);
    expect((await subRows(VIEWER))[0]?.fail_count).toBe(0);
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

  async function waitFor(condition: () => boolean, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  test('wakeNotifications mengirim seketika, tanpa menunggu detak (detak 60 dtk)', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note());
    const stop = startNotificationLoop(env, { intervalMs: 60_000 });
    try {
      await waitFor(() => push.sent.length === 1);
      expect(push.sent).toHaveLength(1);
      await insert(note({ preview: 'KEDUA' }));
      const started = Date.now();
      wakeNotifications();
      await waitFor(() => push.sent.length === 2);
      expect(push.sent).toHaveLength(2);
      // Tanpa bangun-bangun, notifikasi kedua baru terkirim pada detak berikutnya (60 dtk).
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await stop();
    }
  });

  test('task yang disimpan langsung terkirim ke sisi QC lewat jalur tulis (tanpa menunggu detak)', async () => {
    const endpoint = await subscribe(QC, 'qc-hp');
    const stop = startNotificationLoop(env, { intervalMs: 60_000 });
    try {
      // Biarkan putaran pertama (kosong) selesai: yang diuji adalah bangun-bangun dari penulisan, bukan detak.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const out = (await callRest(env, 'wh@gmail.com', 'handovers.save', {
        locationId: ENV.locA,
        customerName: 'PT Baru',
        note: '- [ ] X',
      })) as { ok: boolean };
      expect(out.ok).toBe(true);
      await waitFor(() => push.sent.length >= 1);
      expect(push.sent).toHaveLength(1);
      expect(push.sent[0]?.sub.endpoint).toBe(endpoint);
      // Status ditulis setelah pengiriman selesai: tunggu sebentar sebelum dibaca.
      let current = await states();
      for (let i = 0; i < 100 && current.join() !== 'sent'; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        current = await states();
      }
      expect(current).toEqual(['sent']);
    } finally {
      await stop();
    }
  });

  test('bangun-bangun berulang saat pengiriman berjalan: tiap notifikasi terkirim tepat sekali, tanpa tumpang tindih', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note({ preview: 'SATU' }));
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const original = push.send.bind(push);
    push.send = async (sub, payload) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Pengiriman pertama ditahan sampai semua bangun-bangun diberikan: dijamin terjadi saat putaran berjalan.
      if (calls === 1) await gate;
      active -= 1;
      return original(sub, payload);
    };
    const stop = startNotificationLoop(env, { intervalMs: 60_000 });
    try {
      await waitFor(() => calls >= 1);
      await insert(note({ preview: 'DUA' }));
      for (let i = 0; i < 5; i += 1) wakeNotifications();
      open();
      await waitFor(() => push.sent.length === 2);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).toBe(2);
      expect(maxActive).toBe(1);
      expect(push.sent).toHaveLength(2);
      expect(await states()).toEqual(['sent', 'sent']);
    } finally {
      open();
      await stop();
    }
  });

  test('stop() satu putaran tidak mencabut penunjuk putaran lain (identitas dicek saat melepas)', async () => {
    await subscribe(VIEWER, 'a');
    const stopA = startNotificationLoop(env, { intervalMs: 60_000 });
    const stopB = startNotificationLoop(env, { intervalMs: 60_000 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await stopA();
      await insert(note());
      wakeNotifications();
      await waitFor(() => push.sent.length === 1);
      expect(push.sent).toHaveLength(1);
    } finally {
      await stopB();
    }
  });

  test('setelah stop(), wakeNotifications tidak berbuat apa-apa dan tidak melempar', async () => {
    await subscribe(VIEWER, 'a');
    const stop = startNotificationLoop(env, { intervalMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stop();
    await insert(note());
    expect(() => wakeNotifications()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(push.sent).toHaveLength(0);
  });

  /** Env dengan DB yang melempar untuk SQL berisi `failOn` dan mencatat semua SQL yang disiapkan. */
  function envFailing(failOn: string): { env: typeof env; sql: string[] } {
    const sql: string[] = [];
    const db = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (text: string) => {
          sql.push(text);
          if (text.includes(failOn)) throw new Error('galat-sengaja');
          return target.prepare(text);
        };
      },
    });
    return { env: { ...env, DB: db } as typeof env, sql };
  }

  test('galat pelepasan ringkasan tak membatalkan pengiriman push dalam satu putaran (F5)', async () => {
    await subscribe(VIEWER, 'a');
    await insert(note());
    const broken = envFailing('FROM notification_pending');
    await expect(notificationTick(broken.env)).rejects.toThrow('galat-sengaja');
    expect(push.sent).toHaveLength(1);
    expect(await states()).toEqual(['sent']);
  });

  test('galat pengiriman push tak membatalkan pelepasan ringkasan dalam satu putaran (F5)', async () => {
    const broken = envFailing('FROM notifications WHERE push_state');
    await expect(notificationTick(broken.env)).rejects.toThrow('galat-sengaja');
    // Langkah pelepasan tetap dijalankan walau urutannya mendahului push yang gagal.
    expect(broken.sql.some((text) => text.includes('FROM notification_pending'))).toBe(true);
  });

  test('putaran sehat tidak melempar', async () => {
    await expect(notificationTick(env)).resolves.toBeUndefined();
  });
});
