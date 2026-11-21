import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import type { MailMessage } from '@server/core/mail';
import { signDesktopToken } from '@server/core/session';
import { putSetting } from '@server/core/settings';
import { runPendingJobs } from '@server/jobs/runner';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { deliverPendingPushes } from '@server/modules/notification/push';
import { endpointHash } from '@server/modules/notification/push-service';
import {
  closeAllNotificationStreams,
  pumpNotificationStreams,
} from '@server/modules/notification/stream-hub';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createFakePush, type FakePush } from '@server-test/fake-push';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { reportLinkExpiresAt } from '@shared/serials';
import { canManageSerial } from './access';
import { SETTING_SERIAL_ALERT } from './alert';
import { involvedBuIds } from './bu-history';
import { claimDraftStmts, insertDraftStmt, listExpiredFailed } from './proof/repo';
import { getProof } from './proof/service';
import { newStagedName } from './proof/store';
import { signReportToken } from './public-link';
import { loadSerialRow } from './repo';

setDefaultTimeout(60_000);

// Hapus lunak dan pulihkan Serial Number (fase 4d, Task 1; rancangan soft delete §4.3, keputusan pemilik 5 dan 12, T2,
// T7-T9): keadaan baris, hak (manage pada SEMUA BU riwayat), penyaringan di setiap pembaca, rute publik, penyapu,
// surel, notifikasi, penolakan rujukan terhapus, dan keunikan serial hidup.

let env: TestEnv;
let sent: MailMessage[];
let push: FakePush;
const realError = console.error;

const WRITER = SERIAL_USERS.writer;
const VIEWER = SERIAL_USERS.viewer;
const MGR_ALL = 'kelola-semua@gmail.com';
const MGR_A = 'kelola-a@gmail.com';
const MGR_B = 'kelola-b@gmail.com';
const MGR_AB = 'kelola-ab@gmail.com';
const NOW = '2026-11-12T03:00:00.000Z';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  sent = [];
  push = createFakePush();
  env = await createTestEnv({
    APP_ORIGIN: 'https://qc.test',
    PUSH: push,
    VAPID_PUBLIC_KEY: 'pub',
    MAILER: {
      async send(message) {
        sent.push(message);
      },
    },
  });
  env.clock.set(Date.parse(NOW));
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-mgr', name: 'Kelola Serial', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr-all',
    email: MGR_ALL,
    buAssignments: [{ buId: null, roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-mgr-a',
    email: MGR_A,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-mgr-b',
    email: MGR_B,
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-mgr-ab',
    email: MGR_AB,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-mgr'] },
      { buId: 'bu-b', roleIds: ['r-mgr'] },
    ],
  });
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
  closeAllNotificationStreams();
});

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

const auditCount = async (action: string): Promise<number> =>
  Number((await rows('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', action))[0]?.n);

const stateOf = async (id: string): Promise<{ deleted_at: string; deleted_by: string }> =>
  (await rows('SELECT deleted_at, deleted_by FROM serials WHERE id = ?', id))[0] as {
    deleted_at: string;
    deleted_by: string;
  };

const stock = async (stickerId: string): Promise<number> =>
  Number(
    (
      await rows(
        "SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = 'loc-sby'",
        stickerId,
      )
    )[0]?.qty,
  );

/**
 * Menjalankan `fn` tanpa indeks unik LAMA serial (`serials_serial` se-sistem dan `serials_bu_serial` per BU): sebelum
 * migrasi contract (Task 6) keduanya masih menjangkau baris terhapus, jadi serial yang dicatat ulang sesudah dihapus
 * hanya mungkin tanpa keduanya (`serials_serial_live` tetap berlaku dan membedakan lewat `deleted_at`).
 */
const withoutSerialUniques = (fn: () => Promise<void>) =>
  withoutOldIndex(env, 'serials', 'serials_serial', 'serial', () =>
    withoutOldIndex(env, 'serials', 'serials_bu_serial', 'bu_id, serial', fn),
  );

const remove = (id: string, email = MGR_ALL) => call(email, 'serials.remove', { id });
const restore = (id: string, email = MGR_ALL) => call(email, 'serials.restore', { id });
const removeBatch = (ids: string[], email = MGR_ALL) => call(email, 'serials.removeBatch', { ids });
const restoreBatch = (ids: string[], email = MGR_ALL) =>
  call(email, 'serials.restoreBatch', { ids });

describe('serials.remove (hapus lunak)', () => {
  test('menandai baris, mencatat audit, dan tidak menyentuh stok maupun kejadian', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [
        { stickerId: 's1', qty: 2 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    const eventsBefore = await rows('SELECT id FROM serial_events WHERE serial_id = ?', 'sn1');
    const result = await remove('sn1');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 'sn1' });
    expect(await stateOf('sn1')).toEqual({ deleted_at: NOW, deleted_by: MGR_ALL });
    expect(await stock('s1')).toBe(10);
    expect(await stock('s2')).toBe(10);
    expect(await rows('SELECT id FROM serial_events WHERE serial_id = ?', 'sn1')).toEqual(
      eventsBefore,
    );
    expect(await auditCount('serial.delete')).toBe(1);
    const [audit] = await rows(
      "SELECT target, target_id FROM audit_log WHERE action = 'serial.delete'",
    );
    expect(audit).toMatchObject({ target: 'AB12', target_id: 'sn1' });
  });

  test('hapus ulang sukses tanpa audit baru dan tanpa mengubah penanda asli', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    expect((await remove('sn1')).ok).toBe(true);
    env.clock.advance(60_000);
    const again = await remove('sn1', MGR_AB);
    expect(again.ok).toBe(true);
    expect(await auditCount('serial.delete')).toBe(1);
    expect(await stateOf('sn1')).toEqual({ deleted_at: NOW, deleted_by: MGR_ALL });
  });

  test('serial tak ada = NOT_FOUND; pencatat dan pelihat (tanpa manage) = FORBIDDEN', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    expect((await remove('tidak-ada')).error?.code).toBe('NOT_FOUND');
    expect((await remove('sn1', WRITER)).error?.code).toBe('FORBIDDEN');
    expect((await remove('sn1', VIEWER)).error?.code).toBe('FORBIDDEN');
    expect((await restore('sn1', WRITER)).error?.code).toBe('FORBIDDEN');
    expect((await stateOf('sn1')).deleted_at).toBe('');
  });

  test('batch lintas BU dengan manage hanya di satu BU: NOT_FOUND dan tidak ada yang terhapus', async () => {
    await seedSerial(env, { id: 'sn-a', serial: 'SN-A', buId: 'bu-a', itemId: 'i-a1' });
    await seedSerial(env, { id: 'sn-b', serial: 'SN-B', buId: 'bu-b', itemId: 'i-b' });
    const out = await removeBatch(['sn-a', 'sn-b'], MGR_A);
    expect(out.error?.code).toBe('NOT_FOUND');
    expect((await stateOf('sn-a')).deleted_at).toBe('');
    expect((await stateOf('sn-b')).deleted_at).toBe('');
    const ok = await removeBatch(['sn-a', 'sn-b'], MGR_AB);
    expect(ok.ok).toBe(true);
    expect(ok.data.ids).toEqual(['sn-a', 'sn-b']);
    expect((await stateOf('sn-a')).deleted_at).toBe(NOW);
    expect((await stateOf('sn-b')).deleted_at).toBe(NOW);
  });

  test('serial yang pernah pindah BU: manage hanya BU saat ini = NOT_FOUND; semua BU riwayat = berhasil', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12', buId: 'bu-b', itemId: 'i-b' });
    // BU A pernah memegang serial ini (riwayat), kini di BU B.
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn1', 'bu-a', '2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z')",
    ).run();
    expect((await remove('sn1', MGR_B)).error?.code).toBe('NOT_FOUND');
    expect((await remove('sn1', MGR_A)).error?.code).toBe('NOT_FOUND');
    expect((await stateOf('sn1')).deleted_at).toBe('');
    expect((await remove('sn1', MGR_AB)).ok).toBe(true);
    expect((await stateOf('sn1')).deleted_at).toBe(NOW);
  });

  test('serials.list membawa canManage: manage pada SEMUA BU riwayat, bukan hanya BU saat ini', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'SN-B', buId: 'bu-b', itemId: 'i-b' });
    await seedSerial(env, { id: 'sn-hist', serial: 'SN-H', buId: 'bu-b', itemId: 'i-b' });
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn-hist', 'bu-a', '2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z')",
    ).run();
    const flags = async (email: string): Promise<Record<string, boolean | undefined>> => {
      const out = await call(email, 'serials.list', {});
      expect(out.ok).toBe(true);
      return Object.fromEntries(
        (out.data.items as Json[]).map((item) => [item.id as string, item.canManage]),
      );
    };
    // Manage hanya di BU B: SN-B ya; SN-H pernah di BU A, jadi tidak (cocok dengan NOT_FOUND server pada Hapus).
    expect(await flags(MGR_B)).toEqual({ 'sn-b': true, 'sn-hist': false });
    expect(await flags(MGR_AB)).toEqual({ 'sn-b': true, 'sn-hist': true });
    // Pencatat tanpa manage: semuanya false (bukan hilang), jadi klien tak menebak.
    expect(Object.values(await flags(WRITER)).every((value) => value === false)).toBe(true);
  });
});

describe('penyaringan serial terhapus di pembaca', () => {
  beforeEach(async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      openCase: { id: 'case-1', number: 'LP/A/2611-0001' },
      status: 'reported',
    });
    await seedSerial(env, { id: 'sn2', serial: 'CD34' });
  });

  test('daftar, lookup, laporan, dan detail menyembunyikannya; pemulih tetap dapat membacanya', async () => {
    expect((await remove('sn1')).ok).toBe(true);
    const list = await call(WRITER, 'serials.list', {});
    expect(list.data.items.map((item: Json) => item.id)).toEqual(['sn2']);
    expect((await call(WRITER, 'serials.lookup', { serial: 'AB12' })).data).toMatchObject({
      matches: [],
      elsewhere: null,
    });
    const cases = await call(WRITER, 'serialCases.list', {});
    expect(cases.data.items).toEqual([]);
    expect((await call(WRITER, 'serials.get', { id: 'sn1' })).error?.code).toBe('NOT_FOUND');
    expect((await call(WRITER, 'serials.history', { id: 'sn1' })).error?.code).toBe('NOT_FOUND');
    const seen = await call(MGR_AB, 'serials.get', { id: 'sn1' });
    expect(seen.ok).toBe(true);
    expect(seen.data.deleted).toEqual({ deletedAt: NOW, deletedBy: MGR_ALL });
    const deletedList = await call(MGR_AB, 'serials.list', { deleted: true });
    expect(deletedList.data.items.map((item: Json) => item.id)).toEqual(['sn1']);
    expect(deletedList.data.items[0].deleted).toEqual({ deletedAt: NOW, deletedBy: MGR_ALL });
  });

  test('daftar Terhapus hanya bagi pemegang manage (selain itu FORBIDDEN)', async () => {
    expect((await call(WRITER, 'serials.list', { deleted: true })).error?.code).toBe('FORBIDDEN');
    expect((await call(VIEWER, 'serials.list', { deleted: true })).error?.code).toBe('FORBIDDEN');
    expect((await call(MGR_AB, 'serials.list', { deleted: true })).ok).toBe(true);
  });

  test('halaman publik laporan: 404 seragam sesudah serial dihapus, 200 lagi setelah dipulihkan', async () => {
    await env.DB.prepare(
      "UPDATE serial_cases SET closed_on = '2026-11-12', outcome = 'broken' WHERE id = 'case-1'",
    ).run();
    const token = await signReportToken(
      env.SESSION_SECRET,
      'case-1',
      reportLinkExpiresAt('2026-11-12'),
    );
    const fetchReport = () =>
      app.request(
        `https://qc.test/api/public/serial-reports/${token}`,
        {},
        { ...env, clientIp: '203.0.113.9' },
      );
    expect((await fetchReport()).status).toBe(200);
    expect((await remove('sn1')).ok).toBe(true);
    const gone = await fetchReport();
    expect(gone.status).toBe(404);
    const unknown = await app.request(
      'https://qc.test/api/public/serial-reports/v1.salah.0.salah',
      {},
      { ...env, clientIp: '203.0.113.10' },
    );
    expect(await gone.json()).toEqual(await unknown.json());
    expect((await restore('sn1')).ok).toBe(true);
    expect((await fetchReport()).status).toBe(200);
  });

  test('pembaca internal menolak serial terhapus (loadSerialRow) dan penyapu foto gagal melewatinya', async () => {
    expect((await remove('sn1')).ok).toBe(true);
    expect(await loadSerialRow(env.DB, 'sn1')).toBeNull();
    expect(await loadSerialRow(env.DB, 'sn2')).not.toBeNull();
    for (const [id, serialId] of [
      ['ph-del', 'sn1'],
      ['ph-live', 'sn2'],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO serial_proof_photos (id, serial_id, event_id, state, created_by, created_at, updated_at, last_error) VALUES (?, ?, 'ev', 'failed', ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'Berkas rusak')",
      )
        .bind(id, serialId, WRITER)
        .run();
    }
    const expired = await listExpiredFailed(env.DB, '2026-11-01T00:00:00.000Z');
    expect(expired.map((photo) => photo.id)).toEqual(['ph-live']);
    expect((await restore('sn1')).ok).toBe(true);
    const back = await listExpiredFailed(env.DB, '2026-11-01T00:00:00.000Z');
    expect(back.map((photo) => photo.id).sort()).toEqual(['ph-del', 'ph-live']);
  });

  test('foto bukti serial terhapus: hanya pemulih yang dapat membacanya', async () => {
    const stagedName = newStagedName();
    await env.PROOF_STORE?.write(stagedName, new Uint8Array([1, 2, 3]));
    await insertDraftStmt(env.DB, {
      id: 'ph-1',
      createdBy: WRITER,
      now: NOW,
      mime: 'image/png',
      width: 640,
      height: 480,
      size: 3,
      stagedName,
    }).run();
    await env.DB.batch(
      claimDraftStmts(env.DB, {
        ids: ['ph-1'],
        email: WRITER,
        serialId: 'sn1',
        eventId: 'ev-ph-1',
        snapshotJson: '{}',
        now: NOW,
      }),
    );
    const writer = (await loadUserContext(env, WRITER)) as UserContext;
    const manager = (await loadUserContext(env, MGR_AB)) as UserContext;
    const get = (user: UserContext) =>
      getProof(env, { id: 'ph-1' }, user).then(
        () => 'ok',
        (error: { code?: string }) => error.code ?? 'galat',
      );
    expect(await get(writer)).toBe('ok');
    expect((await remove('sn1')).ok).toBe(true);
    expect(await get(writer)).toBe('NOT_FOUND');
    expect(await get(manager)).toBe('ok');
    expect((await restore('sn1')).ok).toBe(true);
    expect(await get(writer)).toBe('ok');
  });

  test('job serial_alert untuk serial terhapus dilewati tanpa surel', async () => {
    await putSetting(
      env,
      SETTING_SERIAL_ALERT,
      JSON.stringify({ enabled: true, recipients: ['a@contoh.com'], updatedAt: '' }),
    );
    await env.DB.prepare(
      "UPDATE serials SET status = 'broken', open_case_id = '' WHERE id = 'sn1'",
    ).run();
    await env.DB.prepare(
      "UPDATE serial_cases SET closed_on = '2026-11-12', outcome = 'broken' WHERE id = 'case-1'",
    ).run();
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('ev-b', 'sn1', 'case-1', 2, 'declare_broken', '2026-11-12', ?, 'x', 'Budi', 'service', 'Mati', '[]', '{}')",
    )
      .bind(NOW)
      .run();
    expect((await remove('sn1')).ok).toBe(true);
    const { serialAlertJobStmt } = await import('./alert-job');
    await env.DB.batch([
      serialAlertJobStmt(env, { serialId: 'sn1', caseId: 'case-1', eventId: 'ev-b' }),
    ]);
    await runPendingJobs(env);
    expect(sent).toHaveLength(0);
    const [job] = await rows("SELECT status, result FROM jobs WHERE kind = 'serial_alert'");
    expect(job).toMatchObject({ status: 'done', result: 'skipped' });
  });

  test('notifikasi Serial untuk serial terhapus tersembunyi bagi semua; pulihkan memunculkannya lagi', async () => {
    await env.DB.prepare(
      "INSERT INTO notifications (id, recipient, kind, handover_id, location_id, number, customer_name, actor_email, actor_name, `count`, preview, created_at, serial_id, proof_id) VALUES ('n1', ?, 'serialProofFailed', '', 'loc-sby', 'AB12', '', '', '', 0, '', ?, 'sn1', 'ph-1')",
    )
      .bind(WRITER, NOW)
      .run();
    const ids = async () =>
      ((await call(WRITER, 'notifications.list', {})).data.items as Json[]).map((n) => n.id);
    expect(await ids()).toEqual(['n1']);
    expect((await remove('sn1')).ok).toBe(true);
    expect(await ids()).toEqual([]);
    expect((await restore('sn1')).ok).toBe(true);
    expect(await ids()).toEqual(['n1']);
  });
});

describe('push dan aliran SSE untuk serial terhapus', () => {
  const insertNotification = (id: string, serialId: string, photoId: string) =>
    env.DB.prepare(
      "INSERT INTO notifications (id, recipient, kind, handover_id, location_id, number, customer_name, actor_email, actor_name, `count`, preview, created_at, serial_id, proof_id) VALUES (?, ?, 'serialProofFailed', '', 'loc-sby', ?, '', '', '', 0, '', ?, ?, ?)",
    )
      .bind(id, WRITER, `NO-${id}`, NOW, serialId, photoId)
      .run();

  beforeEach(async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    await seedSerial(env, { id: 'sn2', serial: 'CD34' });
    await insertNotification('n1', 'sn1', 'ph-1');
    await insertNotification('n2', 'sn2', 'ph-2');
  });

  test('push: notifikasi serial terhapus dilewati (skipped), serial hidup lain tetap terkirim', async () => {
    const endpoint = 'https://fcm.googleapis.com/serial';
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at, last_ok_at, fail_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(endpointHash(endpoint), WRITER, endpoint, 'p', 'a', NOW, '', 0)
      .run();
    expect((await remove('sn1')).ok).toBe(true);
    expect(await deliverPendingPushes(env)).toBe(1);
    expect(push.sent).toHaveLength(1);
    expect((JSON.parse(push.sent[0]?.payload ?? '{}') as { tag: string }).tag).toBe(
      'serialProofFailed:ph-2',
    );
    const states = await rows('SELECT id, push_state FROM notifications ORDER BY id');
    expect(states.map((r) => [r.id, r.push_state])).toEqual([
      ['n1', 'skipped'],
      ['n2', 'sent'],
    ]);
  });

  test('aliran SSE: notifikasi serial terhapus tidak didorong; serial hidup lain tetap', async () => {
    const token = await signDesktopToken(env, WRITER, env.clock.now());
    const response = await app.request(
      'https://qc.test/api/v1/notifications/stream',
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readUntil = async (needle: string, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (!buffer.includes(needle)) {
        const left = deadline - Date.now();
        if (left <= 0) return false;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
        ]);
        if (chunk === null || chunk.done) return false;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      return true;
    };
    expect(await readUntil('event: ready', 3000)).toBe(true);
    expect((await remove('sn1')).ok).toBe(true);
    await pumpNotificationStreams(env);
    expect(await readUntil('serialProofFailed:ph-2', 3000)).toBe(true);
    expect(buffer).not.toContain('ph-1');
    await reader.cancel();
  });
});

/**
 * Menyisipkan `action` TEPAT sebelum `batch()` pertama yang memuat pernyataan berisi `marker` (mis. INSERT kejadian):
 * membuat balapan "dihapus di sela baca dan tulis" deterministik, tanpa bergantung pada waktu `Promise.all`.
 */
function beforeBatchWith(marker: string, action: () => Promise<unknown>): void {
  const original = env.DB.batch.bind(env.DB);
  env.DB.batch = (async (statements: unknown[]) => {
    const hit = statements.some((s) => (s as { sql?: string }).sql?.includes(marker));
    if (!hit) return original(statements as never);
    env.DB.batch = original as typeof env.DB.batch;
    await action();
    return original(statements as never);
  }) as typeof env.DB.batch;
}

describe('konkurensi hapus vs tulis (deterministik, tanpa Promise.all)', () => {
  test('serial dihapus tepat di sela baca dan tulis catatan: aksi ditolak (NOT_FOUND atau CONFLICT), tak ada kejadian tersimpan', async () => {
    await seedSerial(env, { id: 'sn-gap', serial: 'GAP-1' });
    const at = String(
      (await rows('SELECT updated_at FROM serials WHERE id = ?', 'sn-gap'))[0]?.updated_at,
    );
    let removed: CallOut | undefined;
    beforeBatchWith('INSERT INTO serial_events', async () => {
      removed = await remove('sn-gap');
    });
    const acted = await call(WRITER, 'serials.act', {
      id: 'sn-gap',
      expectedUpdatedAt: at,
      action: 'note',
      occurredOn: '2026-11-12',
      message: 'catatan sela',
    });
    expect(removed?.ok).toBe(true);
    expect(acted.ok).toBe(false);
    expect(['NOT_FOUND', 'CONFLICT']).toContain(acted.error?.code);
    expect(
      await rows(
        "SELECT id FROM serial_events WHERE serial_id = ? AND message = 'catatan sela'",
        'sn-gap',
      ),
    ).toHaveLength(0);
    expect(await auditCount('serial.delete')).toBe(1);
  });
});

describe('konkurensi hapus vs tulis (Promise.all; asersi pada invarian, bukan urutan)', () => {
  test('hapus serentak dengan aksi catatan: hapus selalu sukses, aksi sukses (sebelum hapus) atau ditolak; tak ada kejadian menyusul penghapusan', async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = `sn-race-${round}`;
      await seedSerial(env, { id, serial: `RACE-${round}` });
      const at = String(
        (await rows('SELECT updated_at FROM serials WHERE id = ?', id))[0]?.updated_at,
      );
      const [removed, acted] = await Promise.all([
        remove(id),
        call(WRITER, 'serials.act', {
          id,
          expectedUpdatedAt: at,
          action: 'note',
          occurredOn: '2026-11-12',
          message: 'catatan serentak',
        }),
      ]);
      expect(removed.ok).toBe(true);
      expect((await stateOf(id)).deleted_at).not.toBe('');
      if (!acted.ok) expect(['NOT_FOUND', 'CONFLICT']).toContain(acted.error?.code);
      const notes = await rows(
        "SELECT id FROM serial_events WHERE serial_id = ? AND message = 'catatan serentak'",
        id,
      );
      expect(notes).toHaveLength(acted.ok ? 1 : 0);
      // Sesudah penghapusan, tulis ulang apa pun ke serial itu = NOT_FOUND.
      const after = await call(WRITER, 'serials.act', {
        id,
        expectedUpdatedAt: at,
        action: 'note',
        occurredOn: '2026-11-12',
        message: 'sesudah hapus',
      });
      expect(after.error?.code).toBe('NOT_FOUND');
    }
  });

  test('dua penghapusan serentak: keduanya sukses dan audit hanya sekali', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    const [a, b] = await Promise.all([remove('sn1'), remove('sn1', MGR_AB)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await auditCount('serial.delete')).toBe(1);
  });
});

describe('serials.restore (pulihkan)', () => {
  test('memulihkan baris dengan status dan stok utuh, mencatat audit, dan menyamai bentuk DTO detail', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [{ stickerId: 's1', qty: 1 }],
    });
    expect((await remove('sn1')).ok).toBe(true);
    env.clock.advance(60_000);
    const out = await restore('sn1');
    expect(out.ok).toBe(true);
    expect(out.data.id).toBe('sn1');
    expect(out.data.deleted).toBeUndefined();
    expect(out.data.status).toBe('good');
    expect(await stateOf('sn1')).toEqual({ deleted_at: '', deleted_by: '' });
    expect(await stock('s1')).toBe(10);
    expect(await auditCount('serial.restore')).toBe(1);
    // Pulihkan ulang sukses tanpa audit baru.
    expect((await restore('sn1')).ok).toBe(true);
    expect(await auditCount('serial.restore')).toBe(1);
    expect((await call(WRITER, 'serials.get', { id: 'sn1' })).ok).toBe(true);
  });

  test('pulihkan saat serial yang sama sudah hidup di catatan lain = CONFLICT, dan tetap terhapus', async () => {
    await withoutSerialUniques(async () => {
      await seedSerial(env, { id: 'sn1', serial: 'AB12' });
      expect((await remove('sn1')).ok).toBe(true);
      env.clock.advance(1000);
      await seedSerial(env, { id: 'sn2', serial: 'AB12', clientId: 'client-lain' });
      const out = await restore('sn1');
      expect(out.error?.code).toBe('CONFLICT');
      expect(JSON.stringify(out.error)).toContain('Serial Number ini sudah dicatat ulang');
      expect((await stateOf('sn1')).deleted_at).toBe(NOW);
    });
  });

  test('dua serial bernomor sama terhapus pada waktu berbeda tidak bentrok; memulihkan keduanya sekaligus ditolak', async () => {
    await withoutSerialUniques(async () => {
      await seedSerial(env, { id: 'sn1', serial: 'AB12' });
      expect((await remove('sn1')).ok).toBe(true);
      env.clock.advance(5000);
      await seedSerial(env, { id: 'sn2', serial: 'AB12', clientId: 'client-lain' });
      expect((await remove('sn2')).ok).toBe(true);
      expect((await stateOf('sn1')).deleted_at).not.toBe((await stateOf('sn2')).deleted_at);
      const both = await restoreBatch(['sn1', 'sn2']);
      expect(both.error?.code).toBe('CONFLICT');
      expect((await stateOf('sn1')).deleted_at).not.toBe('');
      expect((await stateOf('sn2')).deleted_at).not.toBe('');
      expect((await restore('sn2')).ok).toBe(true);
      expect((await restore('sn1')).error?.code).toBe('CONFLICT');
    });
  });

  test('batch pulihkan: yang sudah hidup sukses tanpa audit; hak manage atas SEMUA BU riwayat diperlukan', async () => {
    await seedSerial(env, { id: 'sn-a', serial: 'SN-A', buId: 'bu-a', itemId: 'i-a1' });
    await seedSerial(env, { id: 'sn-b', serial: 'SN-B', buId: 'bu-b', itemId: 'i-b' });
    expect((await removeBatch(['sn-a', 'sn-b'])).ok).toBe(true);
    expect((await restoreBatch(['sn-a', 'sn-b'], MGR_A)).error?.code).toBe('NOT_FOUND');
    const ok = await restoreBatch(['sn-a', 'sn-b'], MGR_AB);
    expect(ok.ok).toBe(true);
    expect(ok.data.items.map((item: Json) => item.id)).toEqual(['sn-a', 'sn-b']);
    expect(await auditCount('serial.restore')).toBe(2);
    expect((await restoreBatch(['sn-a'], MGR_AB)).ok).toBe(true);
    expect(await auditCount('serial.restore')).toBe(2);
  });
});

describe('penolakan rujukan terhapus dan kiriman ulang', () => {
  let counter = 0;
  const cid = () => `cid${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const rowOf = (overrides: Record<string, unknown> = {}) => ({
    clientId: cid(),
    serial: 'SN-0001',
    itemId: 'i-a1',
    buId: 'bu-a',
    testDate: '2026-11-12',
    locationId: 'loc-sby',
    sample: false,
    note: '',
    status: 'good',
    stickers: [{ stickerId: 's1', qty: 1 }],
    ...overrides,
  });
  const save = (rowsIn: Record<string, unknown>[], email = WRITER) =>
    call(email, 'serials.saveBatch', { rows: rowsIn });
  const resultsOf = (out: CallOut): Json[] => (out.data as Json).results;

  test('Item, Lokasi, dan BU yang sudah dihapus ditolak per baris dengan nomor baris dan tanpa efek', async () => {
    await env.DB.prepare("UPDATE items SET deleted_at = ?, deleted_by = 'x' WHERE id = 'i-a1'")
      .bind(NOW)
      .run();
    const itemOut = resultsOf(await save([rowOf()]));
    expect(itemOut[0].result).toBe('invalid');
    expect(itemOut[0].message).toMatch(/^Baris 1: Item sudah dihapus$/);
    await env.DB.prepare(
      "UPDATE items SET deleted_at = '', deleted_by = '' WHERE id = 'i-a1'",
    ).run();

    await env.DB.prepare(
      "UPDATE locations SET deleted_at = ?, deleted_by = 'x' WHERE id = 'loc-sby'",
    )
      .bind(NOW)
      .run();
    const locOut = resultsOf(
      await save([rowOf({ serial: 'SN-0002' }), rowOf({ serial: 'SN-0003' })]),
    );
    expect(locOut.map((result) => result.message)).toEqual([
      'Baris 1: Lokasi sudah dihapus',
      'Baris 2: Lokasi sudah dihapus',
    ]);
    await env.DB.prepare(
      "UPDATE locations SET deleted_at = '', deleted_by = '' WHERE id = 'loc-sby'",
    ).run();

    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = ?, deleted_by = 'x' WHERE id = 'bu-a'",
    )
      .bind(NOW)
      .run();
    const buOut = resultsOf(await save([rowOf({ serial: 'SN-0004' })]));
    expect(buOut[0].result).toBe('invalid');
    expect(buOut[0].message).toMatch(/^Baris 1: BU sudah dihapus$/);
    expect(await rows('SELECT id FROM serials')).toEqual([]);
    expect(await stock('s1')).toBe(10);
  });

  test('kiriman ulang clientId ke serial yang sudah dihapus = baris invalid "tidak ditemukan", tanpa efek', async () => {
    const row = rowOf();
    const first = resultsOf(await save([row]));
    expect(first[0].result).toBe('created');
    expect(await stock('s1')).toBe(9);
    expect((await remove(first[0].id)).ok).toBe(true);
    const again = resultsOf(await save([row]));
    expect(again[0].result).toBe('invalid');
    expect(again[0].message).toBe('Serial Number tidak ditemukan');
    expect(await stock('s1')).toBe(9);
    expect(await rows('SELECT id FROM serials')).toHaveLength(1);
  });

  test('mencatat ulang serial yang sudah dihapus: baris baru (bukan cek ulang) sesudah indeks lama tak menghalangi', async () => {
    await withoutSerialUniques(async () => {
      const first = resultsOf(await save([rowOf({ serial: 'SN-0009' })]));
      expect(first[0].result).toBe('created');
      expect((await remove(first[0].id)).ok).toBe(true);
      env.clock.advance(1000);
      const second = resultsOf(await save([rowOf({ serial: 'SN-0009' })]));
      expect(second[0].result).toBe('created');
      expect(second[0].id).not.toBe(first[0].id);
    });
  });

  test('cek ulang menolak stiker yang sudah dihapus (dibaca nonaktif), dan serial terhapus tak dapat ditindak', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [
        { stickerId: 's1', qty: 1 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    await env.DB.prepare("UPDATE stickers SET deleted_at = ?, deleted_by = 'x' WHERE id = 's1'")
      .bind(NOW)
      .run();
    const act = (extra: Record<string, unknown>) =>
      call(WRITER, 'serials.act', {
        id: 'sn1',
        expectedUpdatedAt: NOW.replace('03:00:00', '00:00:00'),
        action: 'recheck',
        occurredOn: '2026-11-12',
        message: '',
        ...extra,
      });
    const rejected = await act({ stickerIds: ['s1'] });
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(JSON.stringify(rejected.error)).toContain('Stiker nonaktif tidak bisa ditempel');
    expect(await stock('s1')).toBe(10);
    await env.DB.prepare(
      "UPDATE stickers SET deleted_at = '', deleted_by = '' WHERE id = 's1'",
    ).run();
    expect((await remove('sn1')).ok).toBe(true);
    expect((await act({ action: 'note', message: 'catatan' })).error?.code).toBe('NOT_FOUND');
  });
});

describe('kesepakatan hak pulih: restorableSerialsSql vs canManageSerial', () => {
  test('daftar Terhapus tiap pengguna manage = serial yang BU riwayatnya seluruhnya dipegang manage-nya', async () => {
    await seedSerial(env, { id: 'sn-a', serial: 'SN-A', buId: 'bu-a', itemId: 'i-a1' });
    await seedSerial(env, { id: 'sn-b', serial: 'SN-B', buId: 'bu-b', itemId: 'i-b' });
    await seedSerial(env, { id: 'sn-ab', serial: 'SN-AB', buId: 'bu-b', itemId: 'i-a2' });
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn-ab', 'bu-a', '2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z')",
    ).run();
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = ?, deleted_by = 'seed@gmail.com' WHERE id IN ('sn-a', 'sn-b', 'sn-ab')",
    )
      .bind(NOW)
      .run();
    for (const email of [MGR_ALL, MGR_A, MGR_B, MGR_AB]) {
      const user = await loadUserContext(env, email);
      if (!user) throw new Error(`pengguna ${email} tidak ada`);
      const expected: string[] = [];
      for (const id of ['sn-a', 'sn-ab', 'sn-b']) {
        if (canManageSerial(user, await involvedBuIds(env.DB, id))) expected.push(id);
      }
      const out = await call(email, 'serials.list', { deleted: true });
      expect(out.ok).toBe(true);
      expect(out.data.items.map((item: Json) => item.id).sort()).toEqual(expected);
      // Setiap id yang disetujui daftar juga dapat dibuka detailnya, dan sebaliknya.
      for (const id of ['sn-a', 'sn-ab', 'sn-b']) {
        const detail = await call(email, 'serials.get', { id });
        expect(detail.ok).toBe(expected.includes(id));
      }
    }
  });
});
