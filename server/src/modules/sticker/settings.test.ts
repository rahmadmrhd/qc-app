import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { getSetting } from '@server/core/settings';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SETTING_STICKER_ALERT } from './settings';

setDefaultTimeout(60_000);

// Konfigurasi Stiker (spek 4a §3 butir 12): pengaturan email ringkasan dan minimum bawaan per jenis.

let env: TestEnv;
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Out = { ok: boolean; data?: any; error?: any };
const call = async (email: string, id: string, input: unknown) =>
  (await restCall(env, email, id, input)) as Out;

const alert = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  recipients: ['a@contoh.com', 'b@contoh.com'],
  digestHour: 9,
  intervalDays: 1,
  ...over,
});

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T03:00:00.000Z'));
  await seedRole(env, { id: 'r-m', name: 'Kelola', permissions: { sticker: 'manage' } });
  await seedRole(env, { id: 'r-e', name: 'Edit', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-m', email: 'sm@gmail.com', roleIds: ['r-m'] });
  await seedUser(env, { id: 'u-e', email: 'se@gmail.com', roleIds: ['r-e'] });
  await seedStickerType(env, { id: 't1', name: 'QC', defaultMinQty: 3 });
  await seedStickerType(env, {
    id: 't-mb',
    name: 'Manual Book',
    rule: 'group',
    systemKind: 'manual_book',
  });
});

describe('stickerSettings.get', () => {
  test('bawaan: nonaktif, tanpa penerima, jam 8; memuat jenis beserta minimum bawaan; smtpConfigured false tanpa MAILER', async () => {
    const out = await call('sm@gmail.com', 'stickerSettings.get', null);
    expect(out.ok).toBe(true);
    expect(out.data.alert).toEqual({
      enabled: false,
      recipients: [],
      digestHour: 8,
      intervalDays: 1,
    });
    expect(out.data.updatedAt).toBe('');
    expect(out.data.smtpConfigured).toBe(false);
    expect(out.data.types).toEqual([
      { id: 't-mb', name: 'Manual Book', systemKind: 'manual_book', defaultMinQty: 0 },
      { id: 't1', name: 'QC', systemKind: '', defaultMinQty: 3 },
    ]);
  });

  test('smtpConfigured true bila MAILER ada', async () => {
    env.MAILER = { send: async () => undefined };
    expect((await call('sm@gmail.com', 'stickerSettings.get', null)).data.smtpConfigured).toBe(
      true,
    );
  });

  test('izin: kelola saja; edit dan tanpa modul 403', async () => {
    expect((await call('se@gmail.com', 'stickerSettings.get', null)).error.code).toBe('FORBIDDEN');
    await seedUser(env, { id: 'u-n', email: 'none@gmail.com' });
    expect((await call('none@gmail.com', 'stickerSettings.get', null)).error.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('stickerSettings.save', () => {
  const save = (over: Record<string, unknown> = {}, email = 'sm@gmail.com') =>
    call(email, 'stickerSettings.save', {
      expectedUpdatedAt: '',
      alert: alert(),
      defaults: [{ typeId: 't1', defaultMinQty: 10 }],
      ...over,
    });

  test('simpan pertama: tersimpan, minimum bawaan jenis berubah, audit; get menyajikan nilainya', async () => {
    const out = await save();
    expect(out.ok).toBe(true);
    expect(out.data.alert).toEqual(alert());
    expect(out.data.updatedAt).toBe('2026-11-10T03:00:00.000Z');
    expect(out.data.types.find((t: { id: string }) => t.id === 't1').defaultMinQty).toBe(10);
    const row = await env.DB.prepare('SELECT default_min_qty FROM sticker_types WHERE id = ?')
      .bind('t1')
      .first<{ default_min_qty: number }>();
    expect(Number(row?.default_min_qty)).toBe(10);
    expect(JSON.parse(await getSetting(env, SETTING_STICKER_ALERT))).toMatchObject({
      enabled: true,
      digestHour: 9,
      intervalDays: 1,
    });
    const audit = await env.DB.prepare('SELECT action FROM audit_log').all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(['sticker.settings']);
    const again = await call('sm@gmail.com', 'stickerSettings.get', null);
    expect(again.data.alert).toEqual(alert());
  });

  test('ubah: wajib membawa versi terkini; versi basi -> CONFLICT; tanpa versi padahal sudah ada -> basi', async () => {
    const first = await save();
    env.clock.advance(60_000);
    const stale = await save({ expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(stale.error.code).toBe('CONFLICT');
    expect((await save({ expectedUpdatedAt: '' })).error.code).toBe('CONFLICT');
    const next = await save({
      expectedUpdatedAt: first.data.updatedAt,
      alert: alert({ digestHour: 12 }),
      defaults: [],
    });
    expect(next.ok).toBe(true);
    expect(next.data.alert.digestHour).toBe(12);
    expect(next.data.updatedAt).not.toBe(first.data.updatedAt);
  });

  test('dua penyimpanan serentak dengan versi sama: tepat satu berhasil', async () => {
    const first = await save();
    env.clock.advance(60_000);
    const body = { expectedUpdatedAt: first.data.updatedAt, defaults: [] };
    const [a, b] = await Promise.all([
      save({ ...body, alert: alert({ digestHour: 10 }) }),
      save({ ...body, alert: alert({ digestHour: 11 }) }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  test('simpan pertama serentak: tepat satu berhasil', async () => {
    const [a, b] = await Promise.all([save({ defaults: [] }), save({ defaults: [] })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  test('email tak valid, ganda, atau lebih dari 20 -> 422; jam di luar 0-23 -> 422', async () => {
    const bad = await save({ alert: alert({ recipients: ['bukan-email'] }) });
    expect(bad.error.code).toBe('VALIDATION');
    expect(bad.error.fields.recipients).toBeDefined();
    expect((await save({ alert: alert({ recipients: ['a@x.com', 'A@x.com'] }) })).error.code).toBe(
      'VALIDATION',
    );
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@contoh.com`);
    expect((await save({ alert: alert({ recipients: many }) })).error.code).toBe('VALIDATION');
    expect((await save({ alert: alert({ recipients: many.slice(0, 20) }) })).ok).toBe(true);
    for (const hour of [-1, 24, 1.5]) {
      expect((await save({ alert: alert({ digestHour: hour }) })).error.code).toBe('VALIDATION');
    }
  });

  test('selang kirim: 1-365 hari tersimpan; di luar itu, pecahan, atau bukan angka -> 422; tanpa field = 1 (klien lama)', async () => {
    const first = await save({ alert: alert({ intervalDays: 7 }) });
    expect(first.data.alert.intervalDays).toBe(7);
    for (const bad of [0, 366, 1.5, '3', null]) {
      const out = await save({
        alert: alert({ intervalDays: bad }),
        expectedUpdatedAt: first.data.updatedAt,
      });
      expect(out.error.code).toBe('VALIDATION');
      expect(out.error.fields.intervalDays).toBeDefined();
    }
    const { intervalDays: _omit, ...legacy } = alert();
    const legacySave = await save({ alert: legacy, expectedUpdatedAt: first.data.updatedAt });
    expect(legacySave.data.alert.intervalDays).toBe(1);
  });

  test('minimum bawaan: jenis tak dikenal, negatif, atau pecahan -> 422; hanya jenis yang disebut berubah', async () => {
    expect((await save({ defaults: [{ typeId: 'tidak-ada', defaultMinQty: 1 }] })).error.code).toBe(
      'VALIDATION',
    );
    expect((await save({ defaults: [{ typeId: 't1', defaultMinQty: -1 }] })).error.code).toBe(
      'VALIDATION',
    );
    expect((await save({ defaults: [{ typeId: 't1', defaultMinQty: 1.5 }] })).error.code).toBe(
      'VALIDATION',
    );
    const out = await save({ defaults: [{ typeId: 't-mb', defaultMinQty: 7 }] });
    expect(out.ok).toBe(true);
    expect(out.data.types.find((t: { id: string }) => t.id === 't-mb').defaultMinQty).toBe(7);
    expect(out.data.types.find((t: { id: string }) => t.id === 't1').defaultMinQty).toBe(3);
  });

  test('izin: sticker edit 403', async () => {
    expect((await save({}, 'se@gmail.com')).error.code).toBe('FORBIDDEN');
  });
});
