import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { deliverPendingPushes } from '@server/modules/notification/push';
import { endpointHash } from '@server/modules/notification/push-service';
import { proofFailedNotificationStmt } from '@server/modules/notification/serial-proof';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createFakePush, type FakePush } from '@server-test/fake-push';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { notificationTitle, pushPayloadOf } from '@shared/notifications';
import { serialProofJobStmt } from './job';
import { claimDraftStmts, findProof, insertDraftStmt, setProofState, toProofDto } from './repo';
import { newStagedName } from './store';

// Foto bukti QC bermasalah: proofProblemCount di ringkasan serial dan notifikasi `serialProofFailed` (lonceng + push)
// untuk pelaku, dipasang atomik di `onFail` job `serial_proof`.

setDefaultTimeout(90_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
let push: FakePush;
const W = SERIAL_USERS.writer;
const VIEWER = SERIAL_USERS.viewer;
const NOBU = SERIAL_USERS.nobu;
const T0 = '2026-11-20T03:00:00.000Z';
const SNAPSHOT = {
  serial: 'AAA1',
  brand: 'Merk',
  model: 'Alfa',
  buCode: 'A',
  locationName: 'Surabaya',
  actorName: 'Pencatat',
  actorTeam: 'qc',
  savedAt: T0,
};
const realError = console.error;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  push = createFakePush();
  env = await createTestEnv({ PUSH: push, VAPID_PUBLIC_KEY: 'pub' });
  env.clock.set(Date.parse(T0));
  await seedSerialWorld(env);
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  await seedSerial(env, { id: 'sn-none', serial: 'KOSONG', buId: 'bu-a' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

/** Foto dengan isi sampah (cap gagal permanen, ukuran sah: dapat dicoba lagi) yang sudah antre di serial `sn-a`. */
async function queuedGarbage(id: string, owner: string = W, serialId = 'sn-a'): Promise<void> {
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, new TextEncoder().encode('bukan gambar'));
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now: T0,
    mime: 'image/png',
    width: 64,
    height: 48,
    size: 12,
    stagedName,
  }).run();
  await env.DB.batch([
    ...claimDraftStmts(env.DB, {
      ids: [id],
      email: owner,
      serialId,
      eventId: `ev-${id}`,
      snapshotJson: JSON.stringify(SNAPSHOT),
      now: T0,
    }),
    serialProofJobStmt(env, id),
  ]);
}

const notifications = () =>
  rows(
    "SELECT * FROM notifications WHERE kind = 'serialProofFailed' ORDER BY created_at, proof_id",
  );

describe('proofProblemCount', () => {
  test('0 tanpa foto bermasalah; n untuk foto failed saja (done/queued tak dihitung); pembaca dan pencatat sama', async () => {
    await queuedGarbage('p1');
    await queuedGarbage('p2');
    await queuedGarbage('p3');
    await queuedGarbage('p4');
    await setProofState(env.DB, 'p1', { state: 'failed', now: T0, lastError: 'x' }).run();
    await setProofState(env.DB, 'p2', { state: 'failed', now: T0, lastError: 'x' }).run();
    await setProofState(env.DB, 'p3', { state: 'done', now: T0 }).run();
    // p4 tetap queued
    for (const email of [W, VIEWER]) {
      const list = await call(email, 'serials.list', {});
      const byId = new Map(list.data.items.map((item: Json) => [item.id, item]));
      expect([email, (byId.get('sn-a') as Json).proofProblemCount]).toEqual([email, 2]);
      expect([email, (byId.get('sn-none') as Json).proofProblemCount]).toEqual([email, 0]);
      const detail = await call(email, 'serials.get', { id: 'sn-a' });
      expect(detail.data.serial.proofProblemCount).toBe(2);
    }
  });

  test('turun ke 0 setelah foto gagal dibuang', async () => {
    await queuedGarbage('p1');
    await setProofState(env.DB, 'p1', { state: 'failed', now: T0, lastError: 'x' }).run();
    expect((await call(W, 'serials.get', { id: 'sn-a' })).data.serial.proofProblemCount).toBe(1);
    expect((await call(W, 'serialProofs.remove', { id: 'p1' })).ok).toBe(true);
    expect((await call(W, 'serials.get', { id: 'sn-a' })).data.serial.proofProblemCount).toBe(0);
  });
});

describe('SerialProofPhotoDto: failedAt dan expiresAt', () => {
  test('hanya terisi untuk foto failed: failedAt = saat gagal, expiresAt = + 14 hari', async () => {
    await queuedGarbage('p1');
    const failedAt = '2026-11-21T10:00:00.000Z';
    await setProofState(env.DB, 'p1', { state: 'failed', now: failedAt, lastError: 'x' }).run();
    const failed = toProofDto((await findProof(env.DB, 'p1')) as never, true);
    expect(failed).toMatchObject({
      state: 'failed',
      failedAt,
      expiresAt: '2026-12-05T10:00:00.000Z',
    });
    await setProofState(env.DB, 'p1', { state: 'queued', now: T0 }).run();
    const queued = toProofDto((await findProof(env.DB, 'p1')) as never, true);
    expect(queued).toMatchObject({ state: 'queued', failedAt: null, expiresAt: null });
  });
});

describe('notifikasi serialProofFailed', () => {
  test('foto gagal di job: satu notifikasi untuk pelaku, isi hanya nomor SN, tanpa alasan/merk/tipe', async () => {
    await queuedGarbage('p1');
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('failed');
    const list = await notifications();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      recipient: W,
      kind: 'serialProofFailed',
      handover_id: '',
      location_id: 'loc-sby',
      number: 'AAA1',
      serial_id: 'sn-a',
      proof_id: 'p1',
      actor_name: '',
      actor_email: '',
      preview: '',
      customer_name: '',
      read_at: '',
      push_state: 'pending',
    });
    const text = JSON.stringify(list[0]);
    for (const secret of ['Merk', 'Alfa', 'bukan gambar', 'Berkas']) {
      expect(text).not.toContain(secret);
    }
  });

  test('foto yang selesai (done) tidak menghasilkan notifikasi', async () => {
    await queuedGarbage('p1');
    await setProofState(env.DB, 'p1', { state: 'done', now: T0 }).run();
    await env.DB.batch([proofFailedNotificationStmt(env.DB, 'p1', T0)]);
    expect(await notifications()).toHaveLength(0);
  });

  test('dua foto gagal pada satu entri = dua notifikasi (satu per foto)', async () => {
    await queuedGarbage('p1');
    await queuedGarbage('p2');
    expect(await runPendingJobs(env)).toBe(2);
    const list = await notifications();
    expect(list.map((row) => row.proof_id).sort()).toEqual(['p1', 'p2']);
  });

  test('penerima = pemilik baris foto (bukan semua pembaca)', async () => {
    await queuedGarbage('p1', SERIAL_USERS.both);
    await runPendingJobs(env);
    expect((await notifications()).map((row) => row.recipient)).toEqual([SERIAL_USERS.both]);
  });

  test('onFail yang berjalan dua kali (waktu sama maupun berbeda) tidak menggandakan', async () => {
    await queuedGarbage('p1');
    const statements = () => [
      setProofState(env.DB, 'p1', { state: 'failed', expectState: 'queued', now: T0 }),
      proofFailedNotificationStmt(env.DB, 'p1', T0),
    ];
    await env.DB.batch(statements());
    await env.DB.batch(statements());
    expect(await notifications()).toHaveLength(1);
    // waktu berbeda: baris foto tak berpindah lagi (sudah failed) sehingga updated_at tak cocok
    const later = '2026-11-20T03:00:05.000Z';
    await env.DB.batch([
      setProofState(env.DB, 'p1', { state: 'failed', expectState: 'queued', now: later }),
      proofFailedNotificationStmt(env.DB, 'p1', later),
    ]);
    expect(await notifications()).toHaveLength(1);
  });

  test('kegagalan baru sesudah Coba lagi = notifikasi baru; yang lama tetap', async () => {
    await queuedGarbage('p1');
    await runPendingJobs(env);
    expect(await notifications()).toHaveLength(1);
    env.clock.advance(60_000);
    const retried = await call(W, 'serialProofs.retry', { id: 'p1' });
    expect(retried.ok).toBe(true);
    env.clock.advance(60_000);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('failed');
    const list = await notifications();
    expect(list).toHaveLength(2);
    expect(new Set(list.map((row) => row.id)).size).toBe(2);
  });

  test('foto yang barisnya sudah dihapus tidak menghasilkan notifikasi', async () => {
    await queuedGarbage('p1');
    await env.DB.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind('p1').run();
    await env.DB.batch([proofFailedNotificationStmt(env.DB, 'p1', T0)]);
    expect(await notifications()).toHaveLength(0);
  });

  test('nomor serial terpanjang (64) dipotong ke kolom number (50) tanpa membatalkan komit', async () => {
    const long = 'S'.repeat(64);
    await seedSerial(env, { id: 'sn-long', serial: long, buId: 'bu-a' });
    await queuedGarbage('p1', W, 'sn-long');
    await runPendingJobs(env);
    expect((await notifications())[0]?.number).toBe('S'.repeat(50));
  });
});

describe('lonceng: akses sadar jenis', () => {
  async function listFor(email: string): Promise<Json> {
    const out = await call(email, 'notifications.list', {});
    expect(out.ok).toBe(true);
    return out.data;
  }

  async function seedHandoverViewer(): Promise<void> {
    await seedRole(env, { id: 'r-ho', name: 'HO view', permissions: { handover: 'view' } });
    await seedUser(env, {
      id: 'u-ho',
      email: 'ho@gmail.com',
      assignments: [{ locationId: 'loc-sby', roleIds: ['r-ho'] }],
    });
  }

  test('pelaku serial-only (tanpa izin Serah Terima) melihat notifikasi dan hitungan belum dibaca', async () => {
    await queuedGarbage('p1');
    await runPendingJobs(env);
    const data = await listFor(W);
    expect(data.unread).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      kind: 'serialProofFailed',
      number: 'AAA1',
      serialId: 'sn-a',
      photoId: 'p1',
      locationId: 'loc-sby',
      handoverId: '',
      readAt: '',
    });
    expect(notificationTitle(data.items[0])).toBe('Foto bukti QC bermasalah');
    expect((await call(W, 'notifications.markRead', { id: data.items[0].id })).ok).toBe(true);
    expect((await listFor(W)).unread).toBe(0);
  });

  test('pengguna yang kehilangan izin baca serial pada BU entri tidak melihatnya lagi', async () => {
    await queuedGarbage('p1');
    await runPendingJobs(env);
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ buId: 'bu-b', roleIds: ['r-edit'] }]), W)
      .run();
    const data = await listFor(W);
    expect(data.items).toHaveLength(0);
    expect(data.unread).toBe(0);
  });

  test('pemegang izin Serah Terima di lokasi entri tanpa izin serial tidak melihatnya', async () => {
    await seedHandoverViewer();
    await queuedGarbage('p1');
    await runPendingJobs(env);
    await env.DB.prepare("UPDATE notifications SET recipient = 'ho@gmail.com'").run();
    const data = await listFor('ho@gmail.com');
    expect(data.items).toHaveLength(0);
    expect(data.unread).toBe(0);
  });

  test('pembaca serial (view) pada BU entri melihatnya; pengguna tanpa BU tidak', async () => {
    await queuedGarbage('p1');
    await runPendingJobs(env);
    await env.DB.prepare('UPDATE notifications SET recipient = ?').bind(VIEWER).run();
    expect((await listFor(VIEWER)).items).toHaveLength(1);
    await env.DB.prepare('UPDATE notifications SET recipient = ?').bind(NOBU).run();
    expect((await listFor(NOBU)).items).toHaveLength(0);
  });

  test('regresi Serah Terima: pemegang serial-saja tidak melihat notifikasi Serah Terima lokasi yang sama; pemegang handover tetap melihatnya', async () => {
    await seedHandoverViewer();
    const insert = async (recipient: string) =>
      env.DB.prepare(
        "INSERT INTO notifications (id, recipient, kind, handover_id, location_id, number, created_at) VALUES (?, ?, 'commented', 'h1', 'loc-sby', 'ST-1', ?)",
      )
        .bind(crypto.randomUUID(), recipient, T0)
        .run();
    await insert(W);
    await insert('ho@gmail.com');
    expect((await listFor(W)).items).toHaveLength(0);
    expect((await listFor('ho@gmail.com')).items).toHaveLength(1);
  });
});

describe('push', () => {
  const EP = 'https://fcm.googleapis.com/a';
  async function subscribe(recipient: string): Promise<void> {
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(endpointHash(EP), recipient, EP, 'p', 'a', T0)
      .run();
  }

  test('terkirim ke pelaku serial-only: judul tetap, isi nomor SN saja, url detail Serial, tag per foto', async () => {
    await subscribe(W);
    await queuedGarbage('p1');
    await queuedGarbage('p2');
    await runPendingJobs(env);
    expect(await deliverPendingPushes(env)).toBe(2);
    const payloads = push.sent.map((sent) => JSON.parse(sent.payload) as Json);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(payload).toMatchObject({
        title: 'Foto bukti QC bermasalah',
        body: 'AAA1',
        url: '/serial/sn-a',
      });
    }
    expect(payloads.map((p) => p.tag).sort()).toEqual([
      'serialProofFailed:p1',
      'serialProofFailed:p2',
    ]);
    const text = push.sent.map((s) => s.payload).join('');
    for (const secret of ['Merk', 'Alfa', 'bukan gambar', 'Berkas', 'Pencatat']) {
      expect(text).not.toContain(secret);
    }
    expect(
      (await rows('SELECT push_state FROM notifications')).every((r) => r.push_state === 'sent'),
    ).toBe(true);
  });

  test('push dilewati (skipped) bila pengguna tak lagi berhak membaca entri', async () => {
    await subscribe(W);
    await queuedGarbage('p1');
    await runPendingJobs(env);
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ buId: 'bu-b', roleIds: ['r-edit'] }]), W)
      .run();
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(push.sent).toHaveLength(0);
    expect((await rows('SELECT push_state FROM notifications'))[0]?.push_state).toBe('skipped');
  });

  test('saklar push dimatikan: tetap masuk lonceng, push dilewati', async () => {
    await subscribe(W);
    await env.DB.prepare(
      "INSERT INTO notification_prefs (recipient, push_enabled, permission, updated_at) VALUES (?, 0, 'granted', ?)",
    )
      .bind(W, T0)
      .run();
    await queuedGarbage('p1');
    await runPendingJobs(env);
    expect(await deliverPendingPushes(env)).toBe(0);
    expect(push.sent).toHaveLength(0);
    const list = await call(W, 'notifications.list', {});
    expect(list.data.items).toHaveLength(1);
  });

  test('pushPayloadOf jenis Serial tak bergantung pada preview atau nama customer', () => {
    const payload = pushPayloadOf({
      id: 'n',
      kind: 'serialProofFailed',
      handoverId: '',
      locationId: 'loc-sby',
      number: 'AAA1',
      customerName: 'PT X',
      actor: 'Budi',
      count: 0,
      preview: 'RAHASIA',
      createdAt: T0,
      readAt: '',
      serialId: 'sn-a',
      photoId: 'p9',
    });
    expect(payload.body).toBe('AAA1');
  });
});
