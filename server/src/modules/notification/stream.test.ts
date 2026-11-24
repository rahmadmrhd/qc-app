import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import {
  DESKTOP_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  signDesktopToken,
  signSessionToken,
} from '@server/core/session';
import { notificationTick } from '@server/jobs/runner';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { seedCustomer } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { CHECK_WINDOW_MS, type NotificationDto } from '@shared/notifications';
import { insertNotificationStmts, type NewNotification } from './repo';
import {
  activeStreamCount,
  closeAllNotificationStreams,
  parseLastEventId,
  pumpNotificationStreams,
  STREAM_MAX_PER_USER,
  STREAM_MAX_WEB_PER_USER,
  type StreamEvent,
  streamEventText,
} from './stream-hub';

setDefaultTimeout(60_000);

const VIEWER = 'viewer@gmail.com';
const QC = 'qc@gmail.com';
const BASE = Date.parse('2026-10-15T03:00:00.000Z');
const URL_STREAM = 'https://qc.test/api/v1/notifications/stream';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(BASE);
  rest = restClient(env);
  await seedHandoverEnv(env);
});

afterEach(() => {
  closeAllNotificationStreams();
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
    createdAt: new Date(BASE + minute * 1000).toISOString(),
    ...overrides,
  };
}

async function insert(...rows: NewNotification[]): Promise<void> {
  await env.DB.batch(insertNotificationStmts(env.DB, rows));
}

async function open(email: string, headers: Record<string, string> = {}): Promise<Response> {
  const token = await signDesktopToken(env, email, env.clock.now());
  return app.request(
    URL_STREAM,
    { headers: { authorization: `Bearer ${token}`, ...headers } },
    env,
  );
}

interface SseFrame {
  event: string;
  id: string;
  data: string;
}

/** Pembaca bingkai SSE sederhana (komentar detak jantung dilewati). */
function frames(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // `read()` yang kehabisan waktu tetap menggantung dan akan menelan potongan berikutnya; simpan agar dipakai ulang
  // oleh pemanggilan `next` berikutnya (tes yang memeriksa "tak ada bingkai" lalu menunggu bingkai lain).
  let pending: ReturnType<typeof reader.read> | undefined;
  return {
    async next(timeoutMs = 3000): Promise<SseFrame | null> {
      for (;;) {
        const cut = buffer.indexOf('\n\n');
        if (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const frame: SseFrame = { event: 'message', id: '', data: '' };
          let any = false;
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue;
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const key = line.slice(0, colon);
            const value = line.slice(colon + 1).trim();
            if (key === 'event') frame.event = value;
            else if (key === 'id') frame.id = value;
            else if (key === 'data') frame.data += value;
            else continue;
            any = true;
          }
          if (any) return frame;
          continue;
        }
        pending ??= reader.read();
        const chunk = await Promise.race([
          pending,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (chunk === null) return null;
        pending = undefined;
        if (chunk.done) return null;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

async function notificationsOf(email: string): Promise<NotificationDto[]> {
  const response = await rest.get('/notifications', { email });
  return ((await jsonOf(response)) as unknown as { items: NotificationDto[] }).items;
}

describe('aliran notifikasi desktop (SSE)', () => {
  test('tanpa sesi atau token rusak -> 401', async () => {
    const none = await app.request(URL_STREAM, {}, env);
    expect(none.status).toBe(401);
    const garbage = await app.request(
      URL_STREAM,
      { headers: { authorization: 'Bearer x.y' } },
      env,
    );
    expect(garbage.status).toBe(401);
    const badCookie = await app.request(URL_STREAM, { headers: { cookie: 'qc_session=x.y' } }, env);
    expect(badCookie.status).toBe(401);
    expect(activeStreamCount()).toBe(0);
  });

  test('jenis token tak boleh tertukar: token desktop sebagai cookie dan token sesi web sebagai Bearer -> 401', async () => {
    const desktop = await signDesktopToken(env, VIEWER, env.clock.now());
    const asCookie = await app.request(
      URL_STREAM,
      { headers: { cookie: `qc_session=${desktop}` } },
      env,
    );
    expect(asCookie.status).toBe(401);
    const web = await signSessionToken(env, VIEWER, env.clock.now());
    const asBearer = await app.request(
      URL_STREAM,
      { headers: { authorization: `Bearer ${web}` } },
      env,
    );
    expect(asBearer.status).toBe(401);
    expect(activeStreamCount()).toBe(0);
  });

  test('header Authorization yang salah tidak jatuh ke cookie sah (seperti kernel REST)', async () => {
    const web = await signSessionToken(env, VIEWER, env.clock.now());
    const response = await app.request(
      URL_STREAM,
      { headers: { authorization: 'Basic abc', cookie: `qc_session=${web}` } },
      env,
    );
    expect(response.status).toBe(401);
    expect(activeStreamCount()).toBe(0);
  });

  test('akun yang tidak terdaftar -> 401', async () => {
    const response = await open('orang-asing@gmail.com');
    expect(response.status).toBe(401);
  });

  test('membuka aliran: header SSE dan bingkai ready; baris baru didorong setelah pump', async () => {
    const response = await open(VIEWER);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    expect(activeStreamCount()).toBe(1);

    await insert(row(0, { number: 'ST-BARU' }));
    await pumpNotificationStreams(env);
    const frame = await sse.next();
    expect(frame?.event).toBe('notification');
    const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
    const [mine] = await notificationsOf(VIEWER);
    expect(data.id).toBe(mine?.id ?? '');
    expect(data.url).toMatch(/^\//);
    expect(`${data.title} ${data.body}`).toContain('ST-BARU');
    expect(frame?.id).toBe(`${data.createdAt}|${data.id}`);

    // Pump ulang tidak mengirim baris yang sama dua kali.
    await pumpNotificationStreams(env);
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('hanya milik penerima dan hanya lokasi yang berhak dibaca; baris sebelum koneksi tidak dikirim', async () => {
    await insert(row(-30, { number: 'ST-LAMA' }));
    const response = await open(VIEWER);
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    await insert(
      row(1, { recipient: QC, number: 'ST-QC' }),
      row(2, { locationId: ENV.locB, number: 'ST-LOKASI-B' }),
      row(3, { number: 'ST-VIEWER' }),
    );
    await pumpNotificationStreams(env);
    const frame = await sse.next();
    const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
    expect(`${data.title} ${data.body}`).toContain('ST-VIEWER');
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('sambung ulang dengan Last-Event-ID: tunggakan terkirim sekali, yang sudah diterima tidak', async () => {
    await insert(
      row(1, { number: 'ST-A' }),
      row(2, { number: 'ST-B' }),
      row(3, { number: 'ST-C' }),
    );
    const items = (await notificationsOf(VIEWER)).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const first = items[0];
    if (!first) throw new Error('seed kosong');
    // Jam maju: tunggakan masih dalam batas basi (10 menit).
    env.clock.set(BASE + 60_000);
    const response = await open(VIEWER, { 'last-event-id': `${first.createdAt}|${first.id}` });
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const frame = await sse.next();
      const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
      seen.push(data.id);
    }
    expect(seen).toEqual([items[1]?.id ?? '', items[2]?.id ?? '']);
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('tunggakan yang sudah basi (> 10 menit) tidak dikirim', async () => {
    await insert(row(1, { number: 'ST-BASI' }));
    const [item] = await notificationsOf(VIEWER);
    if (!item) throw new Error('seed kosong');
    env.clock.set(BASE + 11 * 60_000);
    const response = await open(VIEWER, { 'last-event-id': `${BASE - 60_000}|nol` });
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('batas koneksi per pengguna: yang tertua ditutup', async () => {
    const opened: Response[] = [];
    for (let i = 0; i < STREAM_MAX_PER_USER + 1; i++) opened.push(await open(VIEWER));
    expect(activeStreamCount()).toBe(STREAM_MAX_PER_USER);
    const oldest = frames(opened[0] as Response);
    expect((await oldest.next())?.event).toBe('ready');
    expect(await oldest.next(500)).toBeNull(); // aliran ditutup server
  });

  test('token kedaluwarsa: aliran ditutup pada putaran berikutnya', async () => {
    const response = await open(VIEWER);
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    env.clock.set(BASE + DESKTOP_TOKEN_TTL_MS + 1000);
    await pumpNotificationStreams(env);
    expect(activeStreamCount()).toBe(0);
    expect(await sse.next(500)).toBeNull();
  });

  test('closeAllNotificationStreams menutup semua koneksi', async () => {
    await open(VIEWER);
    await open(QC);
    expect(activeStreamCount()).toBe(2);
    closeAllNotificationStreams();
    expect(activeStreamCount()).toBe(0);
  });
});

describe('aliran notifikasi untuk lonceng web (cookie sesi, hub yang sama)', () => {
  /** Membuka aliran seperti `EventSource` peramban: cookie sesi, tanpa header Authorization. */
  async function openWeb(email: string, headers: Record<string, string> = {}): Promise<Response> {
    return rest.get('/notifications/stream', { email, headers });
  }

  test('cookie sesi sah diterima: header SSE dan bingkai ready', async () => {
    const response = await openWeb(VIEWER);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    expect(activeStreamCount()).toBe(1);
    await sse.cancel();
  });

  test('akun yang tidak terdaftar atau dinonaktifkan -> 401', async () => {
    expect((await openWeb('orang-asing@gmail.com')).status).toBe(401);
    expect(activeStreamCount()).toBe(0);
  });

  test('baris baru milik pengguna didorong sebagai bingkai notification setelah pump; milik orang lain dan lokasi tak berhak tidak', async () => {
    const response = await openWeb(VIEWER);
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    await insert(
      row(1, { recipient: QC, number: 'ST-QC' }),
      row(2, { locationId: ENV.locB, number: 'ST-LOKASI-B' }),
      row(3, { number: 'ST-VIEWER' }),
    );
    await pumpNotificationStreams(env);
    const frame = await sse.next();
    expect(frame?.event).toBe('notification');
    const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
    expect(`${data.title} ${data.body}`).toContain('ST-VIEWER');
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('sambung ulang otomatis peramban (Last-Event-ID) mengirim tunggakan yang terlewat saat putus', async () => {
    await insert(row(1, { number: 'ST-A' }), row(2, { number: 'ST-B' }));
    const items = (await notificationsOf(VIEWER)).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const first = items[0];
    if (!first) throw new Error('seed kosong');
    env.clock.set(BASE + 60_000);
    const response = await openWeb(VIEWER, { 'last-event-id': `${first.createdAt}|${first.id}` });
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    const frame = await sse.next();
    expect((JSON.parse(frame?.data ?? '{}') as StreamEvent).id).toBe(items[1]?.id ?? '');
    expect(await sse.next(300)).toBeNull();
    await sse.cancel();
  });

  test('banyak tab satu pengguna: satu kueri notifikasi per putaran (bukan per koneksi), semua tab tetap menerima', async () => {
    const desktop = frames(await open(VIEWER));
    const tabA = frames(await openWeb(VIEWER));
    const tabB = frames(await openWeb(VIEWER));
    for (const sse of [desktop, tabA, tabB]) expect((await sse.next())?.event).toBe('ready');
    await insert(row(1, { number: 'ST-SATU' }));

    const queries: string[] = [];
    const original = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      if (sql.includes('FROM notifications WHERE recipient')) queries.push(sql);
      return original(sql);
    }) as typeof env.DB.prepare;
    try {
      await pumpNotificationStreams(env);
    } finally {
      env.DB.prepare = original;
    }
    expect(queries).toHaveLength(1);
    for (const sse of [desktop, tabA, tabB]) {
      expect((await sse.next())?.event).toBe('notification');
    }
  });

  test('bucket terpisah: tab web melebihi STREAM_MAX_PER_USER tidak saling menutup dan tidak menggusur desktop', async () => {
    const desktop = await open(VIEWER);
    const desktopFrames = frames(desktop);
    expect((await desktopFrames.next())?.event).toBe('ready');
    const tabs: Response[] = [];
    for (let i = 0; i < STREAM_MAX_PER_USER + 2; i++) tabs.push(await openWeb(VIEWER));
    // Lebih banyak dari batas desktop, tetapi di bawah batas web: semuanya hidup.
    expect(activeStreamCount()).toBe(STREAM_MAX_PER_USER + 3);
    const firstTab = frames(tabs[0] as Response);
    expect((await firstTab.next())?.event).toBe('ready');
    // (Hidup, bukan ditutup, dibuktikan oleh bingkai yang diterimanya di bawah; membaca dengan batas waktu di tengah
    // akan menelan bingkai itu karena `read()` yang kehabisan waktu tetap menggantung.)
    await insert(row(1, { number: 'ST-SEMUA' }));
    await pumpNotificationStreams(env);
    expect((await firstTab.next())?.event).toBe('notification');
    expect((await desktopFrames.next())?.event).toBe('notification');
  });

  test('batas web per pengguna: tab tertua ditutup, desktop tak tersentuh, pengguna lain tak terpengaruh', async () => {
    const desktop = await open(VIEWER);
    const other = await openWeb(QC);
    const tabs: Response[] = [];
    for (let i = 0; i < STREAM_MAX_WEB_PER_USER + 1; i++) tabs.push(await openWeb(VIEWER));
    // 1 desktop + 8 web (tertua dari 9 ditutup) + 1 web milik QC.
    expect(activeStreamCount()).toBe(1 + STREAM_MAX_WEB_PER_USER + 1);
    const oldest = frames(tabs[0] as Response);
    expect((await oldest.next())?.event).toBe('ready');
    expect(await oldest.next(500)).toBeNull();
    const desktopFrames = frames(desktop);
    expect((await desktopFrames.next())?.event).toBe('ready');
    expect(other.status).toBe(200);
  });

  describe('jalur tulis nyata -> putaran notifikasi -> bingkai (permintaan: lonceng langsung berubah)', () => {
    const WH = 'wh@gmail.com';
    const ref = { id: 't1', locationId: ENV.locA };

    async function seedTask(note: string): Promise<void> {
      await seedCustomer(env, { id: 'cust-pt-maju', name: 'PT Maju', key: 'pt maju' });
      await seedHandover(env, {
        id: 't1',
        number: 'ST-20261015-001',
        locationId: ENV.locA,
        customerId: 'cust-pt-maju',
        customerName: 'PT Maju',
        note,
        status: 'open',
      });
    }

    test('Mark done oleh QC lalu putaran notifikasi: WH menerima bingkai notification berisi nomor task', async () => {
      await seedTask('- [ ] A = 1\n- [ ] B = 2');
      const sse = frames(await openWeb(WH));
      expect((await sse.next())?.event).toBe('ready');
      const out = (await callRest(env, QC, 'handovers.setDone', ref)) as { ok: boolean };
      expect(out.ok).toBe(true);
      await notificationTick(env);
      const frame = await sse.next();
      expect(frame?.event).toBe('notification');
      const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
      expect(`${data.title} ${data.body}`).toContain('ST-20261015-001');
      await sse.cancel();
    });

    test('notifikasi task terhapus tidak didorong ke aliran; task hidup lain tetap terkirim', async () => {
      await seedTask('- [ ] A = 1');
      await seedHandover(env, {
        id: 't2',
        number: 'ST-20261015-002',
        locationId: ENV.locA,
        customerId: 'cust-pt-maju',
        customerName: 'PT Maju',
      });
      const sse = frames(await open(VIEWER));
      expect((await sse.next())?.event).toBe('ready');
      expect(((await callRest(env, WH, 'handovers.remove', ref)) as { ok: boolean }).ok).toBe(true);
      await insert(
        row(0, { handoverId: 't1', number: 'ST-20261015-001' }),
        row(1, { handoverId: 't2', number: 'ST-20261015-002' }),
      );
      await pumpNotificationStreams(env);
      const frame = await sse.next();
      expect(frame?.event).toBe('notification');
      const data = JSON.parse(frame?.data ?? '{}') as StreamEvent;
      expect(`${data.title} ${data.body}`).toContain('ST-20261015-002');
      expect(`${data.title} ${data.body}`).not.toContain('ST-20261015-001');
      // Tak ada bingkai kedua: notifikasi task terhapus dilewati (bukan ditunda).
      expect(await sse.next(400)).toBeNull();
      await sse.cancel();
    });

    test('centang biasa: tidak ada bingkai sampai jendela 1 menit habis; setelahnya satu ringkasan', async () => {
      await seedTask('- [ ] A = 1\n- [ ] B = 2');
      const sse = frames(await openWeb(WH));
      expect((await sse.next())?.event).toBe('ready');
      const out = (await callRest(env, QC, 'handovers.setCheck', {
        ...ref,
        index: 0,
        text: 'A = 1',
        checked: true,
      })) as { ok: boolean };
      expect(out.ok).toBe(true);
      await notificationTick(env);
      expect(await sse.next(300)).toBeNull(); // belum ada notifikasi: masih menunggu penggabungan
      env.clock.advance(CHECK_WINDOW_MS);
      await notificationTick(env);
      expect((await sse.next())?.event).toBe('notification');
      await sse.cancel();
    });
  });

  test('sesi web kedaluwarsa: aliran web ditutup pada putaran berikutnya', async () => {
    const response = await openWeb(VIEWER);
    const sse = frames(response);
    expect((await sse.next())?.event).toBe('ready');
    env.clock.set(BASE + SESSION_TTL_MS + 1000);
    await pumpNotificationStreams(env);
    expect(activeStreamCount()).toBe(0);
    expect(await sse.next(500)).toBeNull();
  });
});

describe('format aliran', () => {
  test('parseLastEventId: hanya "<waktu ISO>|<id>" yang sah', () => {
    expect(parseLastEventId('2026-10-15T03:00:00.000Z|abc')).toEqual({
      at: '2026-10-15T03:00:00.000Z',
      id: 'abc',
    });
    for (const bad of [
      null,
      undefined,
      '',
      'abc',
      '|abc',
      'bukan-waktu|abc',
      '2026-10-15T03:00:00.000Z|',
    ]) {
      expect(parseLastEventId(bad), String(bad)).toBeNull();
    }
  });

  test('streamEventText: satu bingkai dengan id, event, dan data JSON satu baris', () => {
    const text = streamEventText({
      id: 'n1',
      kind: 'commented',
      handoverId: 'h1',
      locationId: 'l1',
      number: 'ST-1',
      customerName: 'PT Maju',
      actor: 'Qi',
      count: 0,
      preview: 'baris 1\nbaris 2',
      createdAt: '2026-10-15T03:00:00.000Z',
      readAt: '',
    } as NotificationDto);
    expect(text.endsWith('\n\n')).toBe(true);
    expect(text.split('\n\n')).toHaveLength(2);
    expect(text).toContain('id: 2026-10-15T03:00:00.000Z|n1\n');
    expect(text).toContain('event: notification\n');
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    expect(() => JSON.parse((dataLine ?? '').slice(6))).not.toThrow();
  });
});
