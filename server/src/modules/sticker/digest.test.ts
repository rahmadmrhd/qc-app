import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Env } from '@server/core/env';
import type { MailMessage } from '@server/core/mail';
import { getSetting, putSetting } from '@server/core/settings';
import { seedLocation } from '@server-test/access-fixtures';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { checkLowStockDigest, lowStockRows, SETTING_STICKER_DIGEST_LAST_DATE } from './digest';
import { SETTING_STICKER_ALERT } from './settings';

setDefaultTimeout(60_000);

// Email ringkasan harian stok stiker menipis: jam, tanggal, penerima, satu surel, dan kegagalan kirim.

let env: TestEnv;
let sent: MailMessage[];
let sendBehavior: (message: MailMessage) => Promise<void>;

const DAY1_0900_WIB = Date.parse('2026-11-10T02:00:00.000Z'); // 09:00 WIB
const DAY1_0700_WIB = Date.parse('2026-11-10T00:00:00.000Z'); // 07:00 WIB

async function configure(alert: Record<string, unknown> = {}) {
  await putSetting(
    env,
    SETTING_STICKER_ALERT,
    JSON.stringify({
      enabled: true,
      recipients: ['a@contoh.com', 'b@contoh.com'],
      digestHour: 8,
      updatedAt: 't',
      ...alert,
    }),
  );
}

async function stock(stickerId: string, qty: number) {
  await env.DB.prepare(
    'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)',
  )
    .bind(stickerId, 'loc1', qty, 't')
    .run();
}

beforeEach(async () => {
  sent = [];
  sendBehavior = async () => undefined;
  env = await createTestEnv({
    MAILER: {
      async send(message) {
        await sendBehavior(message);
        sent.push(message);
      },
    },
  });
  env.clock.set(DAY1_0900_WIB);
  await seedLocation(env, { id: 'loc1', code: 'L1' });
  await seedStickerType(env, { id: 't1', name: 'QC' });
  await configure();
});

const withMinimum = (
  id: string,
  minQty: number,
  status: 'active' | 'inactive' | 'deprecated' = 'active',
) => seedSticker(env, { id, typeId: 't1', name: id, minQty, status });

describe('lowStockRows', () => {
  test('hanya aktif, minimum > 0, total semua lokasi <= minimum; deprecated/inactive tak ikut', async () => {
    await withMinimum('s-low', 10);
    await stock('s-low', 4);
    await withMinimum('s-edge', 5);
    await stock('s-edge', 5);
    await withMinimum('s-ok', 5);
    await stock('s-ok', 6);
    await withMinimum('s-zero', 3); // tanpa baris stok = 0
    await withMinimum('s-nomin', 0);
    await withMinimum('s-dep', 10, 'deprecated');
    await withMinimum('s-off', 10, 'inactive');
    const rows = await lowStockRows(env);
    expect(rows.map((row) => row.name)).toEqual(['s-edge', 's-low', 's-zero']);
    expect(rows.find((row) => row.name === 's-low')).toEqual({
      name: 's-low',
      typeName: 'QC',
      total: 4,
      minQty: 10,
    });
  });
});

describe('checkLowStockDigest', () => {
  test('jam belum tercapai -> skipped; jam tercapai -> terkirim', async () => {
    await withMinimum('s1', 10);
    await configure({ digestHour: 9 });
    env.clock.set(DAY1_0700_WIB);
    expect(await checkLowStockDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(0);
    env.clock.set(DAY1_0900_WIB);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('satu surel meski banyak stiker: subjek memuat jumlah, teks daftar dan tautan ke halaman stok', async () => {
    for (const id of ['s1', 's2', 's3']) await withMinimum(id, 10);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Stok stiker menipis (3)');
    expect(sent[0]?.to).toEqual(['a@contoh.com', 'b@contoh.com']);
    for (const id of ['s1', 's2', 's3']) expect(sent[0]?.text).toContain(id);
    expect(sent[0]?.text).toContain('https://qc.test/sticker/stock');
  });

  test('tanggal sama tidak terkirim dua kali; hari berikutnya terkirim lagi', async () => {
    await withMinimum('s1', 10);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(await checkLowStockDigest(env)).toBe('skipped');
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261110');
    env.clock.advance(24 * 60 * 60 * 1000);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  test('tak ada yang menipis -> skipped (tanggal tidak ditulis)', async () => {
    await withMinimum('s1', 5);
    await stock('s1', 50);
    expect(await checkLowStockDigest(env)).toBe('skipped');
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('');
  });

  test('kegagalan kirim -> failed, tanggal tak tertulis, detak berikutnya mencoba lagi', async () => {
    await withMinimum('s1', 10);
    sendBehavior = async () => {
      throw new Error('SMTP mati');
    };
    const realError = console.error;
    console.error = () => undefined;
    try {
      expect(await checkLowStockDigest(env)).toBe('failed');
    } finally {
      console.error = realError;
    }
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('');
    sendBehavior = async () => undefined;
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('dinonaktifkan, tanpa penerima, atau tanpa MAILER -> skipped', async () => {
    await withMinimum('s1', 10);
    await configure({ enabled: false });
    expect(await checkLowStockDigest(env)).toBe('skipped');
    await configure({ recipients: [] });
    expect(await checkLowStockDigest(env)).toBe('skipped');
    await configure();
    const noMailer: Env = { ...env, MAILER: undefined };
    expect(await checkLowStockDigest(noMailer)).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  test('pengaturan belum pernah disimpan -> skipped (bawaan nonaktif)', async () => {
    await env.DB.prepare('DELETE FROM settings WHERE `key` = ?').bind(SETTING_STICKER_ALERT).run();
    await withMinimum('s1', 10);
    expect(await checkLowStockDigest(env)).toBe('skipped');
  });
});
