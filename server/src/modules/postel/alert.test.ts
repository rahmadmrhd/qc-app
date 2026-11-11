import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getSetting, putSetting } from '@server/core/settings';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SETTING_POSTEL_ALERT } from './alert';
import { postelSoonDays } from './service';

setDefaultTimeout(60_000);

// Pengaturan peringatan Postel (spek 4b §3 butir 7): `postelSettings.get|save`, kunci `POSTEL_ALERT` dengan versi CAS
// sendiri (terpisah dari `STICKER_ALERT`). Pengguna: manager@ (sticker manage), stickeredit@ (sticker edit).

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Out = { ok: boolean; data?: any; error?: any };
const call = async (email: string, id: string, input: unknown) =>
  (await restCall(env, email, id, input)) as Out;

const MANAGER = 'manager@gmail.com';
const EDITOR = 'stickeredit@gmail.com';

const alert = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  recipients: ['a@contoh.com', 'b@contoh.com'],
  sendHour: 9,
  thresholds: [90, 60, 30],
  repeatEveryDays: 7,
  ...over,
});

const save = (over: Record<string, unknown> = {}, email = MANAGER) =>
  call(email, 'postelSettings.save', { expectedUpdatedAt: '', alert: alert(), ...over });

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-m', name: 'Kelola', permissions: { sticker: 'manage' } });
  await seedRole(env, { id: 'r-e', name: 'Edit', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-m', email: MANAGER, roleIds: ['r-m'] });
  await seedUser(env, { id: 'u-e', email: EDITOR, roleIds: ['r-e'] });
});

describe('postelSettings.get', () => {
  test('bawaan: nonaktif, tanpa penerima, jam 8, ambang [90,60,30], ulang 7 hari; smtpConfigured mengikuti MAILER', async () => {
    const out = await call(MANAGER, 'postelSettings.get', null);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({
      alert: {
        enabled: false,
        recipients: [],
        sendHour: 8,
        thresholds: [90, 60, 30],
        repeatEveryDays: 7,
      },
      updatedAt: '',
      smtpConfigured: false,
    });
    env.MAILER = { send: async () => undefined };
    expect((await call(MANAGER, 'postelSettings.get', null)).data.smtpConfigured).toBe(true);
  });

  test('izin: hanya sticker manage (stickeredit@ dan tanpa modul 403; tanpa sesi 401)', async () => {
    expect((await call(EDITOR, 'postelSettings.get', null)).error.code).toBe('FORBIDDEN');
    await seedUser(env, { id: 'u-n', email: 'none@gmail.com' });
    expect((await call('none@gmail.com', 'postelSettings.get', null)).error.code).toBe('FORBIDDEN');
    expect((await call(EDITOR, 'postelSettings.save', { alert: alert() })).error.code).toBe(
      'FORBIDDEN',
    );
    expect((await rest.get('/postel-settings', { email: EDITOR })).status).toBe(403);
    expect((await rest.get('/postel-settings', { email: null })).status).toBe(401);
    expect((await rest.get('/postel-settings', { email: MANAGER })).status).toBe(200);
  });
});

describe('postelSettings.save', () => {
  test('simpan pertama: tersimpan, ambang disimpan menurun, audit postel.settings; get menyajikan nilainya', async () => {
    const out = await save({ alert: alert({ thresholds: [30, 90, 60] }) });
    expect(out.ok).toBe(true);
    expect(out.data.alert).toEqual(alert({ thresholds: [90, 60, 30] }));
    expect(out.data.updatedAt).not.toBe('');
    const stored = JSON.parse(await getSetting(env, SETTING_POSTEL_ALERT));
    expect(stored.thresholds).toEqual([90, 60, 30]);
    expect(stored.updatedAt).toBe(out.data.updatedAt);
    expect((await call(MANAGER, 'postelSettings.get', null)).data).toEqual(out.data);
    const audit = (
      await env.DB.prepare('SELECT action, target, actor, `before`, `after` FROM audit_log').all<{
        action: string;
        target: string;
        actor: string;
        before: string;
        after: string;
      }>()
    ).results;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'postel.settings',
      target: 'Konfigurasi Postel',
      actor: MANAGER,
    });
    expect(JSON.parse(audit[0]?.after ?? '{}')).toMatchObject({ enabled: true, sendHour: 9 });
  });

  test('versi usang -> 412 lewat If-Match dan galat usang di RPC; versi tepat dan baru lolos', async () => {
    const first = await save();
    env.clock.advance(60_000);
    const stale = await save({ expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe('CONFLICT');
    const response = await rest.put('/postel-settings', {
      email: MANAGER,
      body: { alert: alert() },
      headers: { 'if-match': '"2000-01-01T00:00:00.000Z"' },
    });
    expect(response.status).toBe(412);
    expect((await jsonOf(response)).code).toBe('CONFLICT');
    const next = await save({
      expectedUpdatedAt: first.data.updatedAt,
      alert: alert({ sendHour: 12 }),
    });
    expect(next.ok).toBe(true);
    expect(next.data.alert.sendHour).toBe(12);
    expect(next.data.updatedAt).not.toBe(first.data.updatedAt);
  });

  test('dua simpan serentak dengan versi sama: satu ok, satu stale; simpan pertama serentak juga', async () => {
    const first = await save();
    env.clock.advance(60_000);
    const body = { expectedUpdatedAt: first.data.updatedAt };
    const [a, b] = await Promise.all([
      save({ ...body, alert: alert({ sendHour: 10 }) }),
      save({ ...body, alert: alert({ sendHour: 11 }) }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser.error.code).toBe('CONFLICT');
    await env.DB.prepare('DELETE FROM settings WHERE `key` = ?').bind(SETTING_POSTEL_ALERT).run();
    const [c, d] = await Promise.all([save(), save()]);
    expect([c.ok, d.ok].sort()).toEqual([false, true]);
  });

  test('validasi: ambang 0, 731, duplikat, 6 nilai, bukan bilangan bulat; jam 24; hari 366; email rusak/ganda; 21 penerima', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['thresholds', { thresholds: [0] }],
      ['thresholds', { thresholds: [731] }],
      ['thresholds', { thresholds: [30, 30] }],
      ['thresholds', { thresholds: [1, 2, 3, 4, 5, 6] }],
      ['thresholds', { thresholds: [] }],
      ['thresholds', { thresholds: [1.5] }],
      ['sendHour', { sendHour: 24 }],
      ['sendHour', { sendHour: -1 }],
      ['repeatEveryDays', { repeatEveryDays: 366 }],
      ['repeatEveryDays', { repeatEveryDays: 1.5 }],
      ['recipients', { recipients: ['bukan-email'] }],
      ['recipients', { recipients: ['a@x.com', 'A@x.com'] }],
      // satu entri harus tepat satu alamat polos (header surel tak boleh diselundupi banyak penerima)
      ['recipients', { recipients: ['x,a@b.co'] }],
      ['recipients', { recipients: ['a@b.co,c@d.co'] }],
      ['recipients', { recipients: ['a@b.co;c@d.co'] }],
      ['recipients', { recipients: ['Nama <a@b.co>'] }],
      ['recipients', { recipients: ['a@b.co c@d.co'] }],
      ['recipients', { recipients: [`${'a'.repeat(250)}@b.co`] }],
      [
        'recipients',
        { recipients: Array.from({ length: 21 }, (_, index) => `u${index}@contoh.com`) },
      ],
    ];
    for (const [field, over] of bad) {
      const out = await save({ alert: alert(over) });
      expect(out.ok, JSON.stringify(over)).toBe(false);
      expect(out.error.code, JSON.stringify(over)).toBe('VALIDATION');
      expect(out.error.fields?.[field], JSON.stringify(over)).toBeDefined();
    }
    expect((await call(MANAGER, 'postelSettings.get', null)).data.updatedAt).toBe('');
    // batas yang sah: 5 ambang, 730 hari, jam 0 dan 23, ulang 0 dan 365, 20 penerima
    const edge = await save({
      alert: alert({
        thresholds: [730, 365, 90, 30, 1],
        sendHour: 0,
        repeatEveryDays: 365,
        recipients: Array.from({ length: 20 }, (_, index) => `u${index}@contoh.com`),
      }),
    });
    expect(edge.ok).toBe(true);
  });

  test('baris POSTEL_ALERT yang ada tetapi kosong: simpan berhasil (UPDATE, bukan INSERT duplikat) dan tetap CAS', async () => {
    await env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)')
      .bind(SETTING_POSTEL_ALERT, '')
      .run();
    const first = await save();
    expect(first.ok).toBe(true);
    expect(first.data.updatedAt).not.toBe('');
    // simpan kedua dengan versi usang ('' lama) tetap ditolak
    env.clock.advance(60_000);
    expect((await save()).error.code).toBe('CONFLICT');
    expect((await save({ expectedUpdatedAt: first.data.updatedAt })).ok).toBe(true);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS c FROM settings WHERE `key` = ?')
      .bind(SETTING_POSTEL_ALERT)
      .first<{ c: number | string }>();
    expect(Number(rows?.c)).toBe(1);
  });

  test('versi pengaturan peringatan dan pengaturan stok terpisah: menyimpan satu tidak mengubah yang lain', async () => {
    const stockSave = await call(MANAGER, 'stickerSettings.save', {
      expectedUpdatedAt: '',
      alert: { enabled: true, recipients: ['s@contoh.com'], digestHour: 9 },
      defaults: [],
    });
    expect(stockSave.ok).toBe(true);
    const stockBefore = (await call(MANAGER, 'stickerSettings.get', null)).data;
    env.clock.advance(60_000);
    const postel = await save();
    expect(postel.ok).toBe(true);
    const stockAfter = (await call(MANAGER, 'stickerSettings.get', null)).data;
    expect(stockAfter.updatedAt).toBe(stockBefore.updatedAt);
    expect(stockAfter.alert).toEqual(stockBefore.alert);
    env.clock.advance(60_000);
    const stockNext = await call(MANAGER, 'stickerSettings.save', {
      expectedUpdatedAt: stockBefore.updatedAt,
      alert: { enabled: false, recipients: [], digestHour: 8 },
      defaults: [],
    });
    expect(stockNext.ok).toBe(true);
    const postelAfter = (await call(MANAGER, 'postelSettings.get', null)).data;
    expect(postelAfter.updatedAt).toBe(postel.data.updatedAt);
    expect(postelAfter.alert).toEqual(postel.data.alert);
  });
});

describe('postelSoonDays (pembacaan longgar lewat readPostelAlert)', () => {
  test('tanpa pengaturan, JSON rusak, atau ambang tak sah = 90; mengikuti ambang terbesar yang tersimpan', async () => {
    expect(await postelSoonDays(env)).toBe(90);
    await putSetting(env, SETTING_POSTEL_ALERT, '{rusak');
    expect(await postelSoonDays(env)).toBe(90);
    await putSetting(env, SETTING_POSTEL_ALERT, JSON.stringify({ thresholds: ['x', -1] }));
    expect(await postelSoonDays(env)).toBe(90);
    await save({ alert: alert({ thresholds: [45, 14] }) });
    expect(await postelSoonDays(env)).toBe(45);
  });
});
