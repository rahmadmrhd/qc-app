import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Env } from '@server/core/env';
import type { MailMessage } from '@server/core/mail';
import { getSetting, putSetting } from '@server/core/settings';
import { seedLocation } from '@server-test/access-fixtures';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { checkLowStockDigest, SETTING_STICKER_DIGEST_LAST_DATE, stockDigestRows } from './digest';
import { SETTING_STICKER_ALERT } from './settings';

setDefaultTimeout(60_000);

// Email ringkasan harian stok stiker (habis dan menipis): jam, tanggal, penerima, satu surel, dan kegagalan kirim.

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
      intervalDays: 1,
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

describe('stockDigestRows', () => {
  test('menipis: aktif, minimum > 0, 0 < total <= minimum; habis: aktif dan total <= 0 apa pun minimumnya; deprecated/inactive tak ikut', async () => {
    await withMinimum('s-low', 10);
    await stock('s-low', 4);
    await withMinimum('s-edge', 5);
    await stock('s-edge', 5);
    await withMinimum('s-ok', 5);
    await stock('s-ok', 6);
    await withMinimum('s-zero', 3); // tanpa baris stok = 0 -> habis
    await withMinimum('s-nomin', 0); // minimum 0 dan stok 0 -> habis (tidak lagi dikecualikan)
    await withMinimum('s-neg', 0);
    await stock('s-neg', -2); // negatif akibat pemotongan Serial Number -> habis
    await withMinimum('s-negmin', 5);
    await stock('s-negmin', -1); // habis, TIDAK diulang di menipis
    await withMinimum('s-nomin-ok', 0);
    await stock('s-nomin-ok', 7); // minimum 0 dan stok ada: bukan keduanya
    await withMinimum('s-dep', 10, 'deprecated');
    await withMinimum('s-off', 10, 'inactive');
    const rows = await stockDigestRows(env);
    expect(rows.low.map((row) => row.name)).toEqual(['s-edge', 's-low']);
    expect(rows.out.map((row) => row.name)).toEqual(['s-neg', 's-negmin', 's-nomin', 's-zero']);
    expect(rows.low.find((row) => row.name === 's-low')).toEqual({
      name: 's-low',
      typeName: 'QC',
      total: 4,
      minQty: 10,
    });
    expect(rows.out.find((row) => row.name === 's-neg')).toEqual({
      name: 's-neg',
      typeName: 'QC',
      total: -2,
      minQty: 0,
    });
  });

  test('total dijumlah dari semua lokasi', async () => {
    await seedLocation(env, { id: 'loc2', code: 'L2' });
    await withMinimum('s-sum', 0);
    await stock('s-sum', 3);
    await env.DB.prepare(
      'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind('s-sum', 'loc2', -3, 't')
      .run();
    const rows = await stockDigestRows(env);
    expect(rows.out.map((row) => row.name)).toEqual(['s-sum']);
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

  test('satu surel meski banyak stiker: subjek memuat jumlah per bagian, teks dua bagian terpisah dan tautan ke halaman stok', async () => {
    for (const id of ['s1', 's2']) {
      await withMinimum(id, 10);
      await stock(id, 4);
    }
    await withMinimum('s3', 0); // habis walau minimum 0
    await withMinimum('s4', 5);
    await stock('s4', -2); // habis (negatif), tidak diulang di menipis
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Stok stiker: 2 habis, 2 menipis');
    expect(sent[0]?.to).toEqual(['a@contoh.com', 'b@contoh.com']);
    const text = sent[0]?.text ?? '';
    const habis = text.slice(text.indexOf('Habis'), text.indexOf('Menipis'));
    const menipis = text.slice(text.indexOf('Menipis'));
    expect(habis).toContain('s3');
    expect(habis).toContain('s4 (QC): stok Kurang 2');
    expect(habis).not.toContain('s1');
    expect(menipis).toContain('s1 (QC): stok 4, minimum 10');
    expect(menipis).toContain('s2');
    expect(menipis).not.toContain('s4');
    expect(menipis).not.toContain('s3');
    expect(text).toContain('https://qc.test/sticker');
  });

  test('hanya bagian habis (minimum 0): terkirim dengan subjek habis saja; hanya menipis: subjek menipis saja', async () => {
    await withMinimum('s-out', 0);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent[0]?.subject).toBe('Stok stiker: 1 habis');
    expect(sent[0]?.text).not.toContain('Menipis');
    env.clock.advance(24 * 60 * 60 * 1000);
    await env.DB.prepare('DELETE FROM stickers WHERE id = ?').bind('s-out').run();
    await withMinimum('s-low', 10);
    await stock('s-low', 3);
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(sent[1]?.subject).toBe('Stok stiker: 1 menipis');
    expect(sent[1]?.text).not.toContain('Habis');
  });

  test('stiker nonaktif/deprecated yang habis tidak memicu surel', async () => {
    await withMinimum('s-off', 0, 'inactive');
    await withMinimum('s-dep', 0, 'deprecated');
    expect(await checkLowStockDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(0);
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

  test('selang 3 hari: hari ke-1 dan ke-2 dilewati, hari ke-3 terkirim; tanpa stok menipis tanggal tidak maju', async () => {
    await configure({ intervalDays: 3 });
    await withMinimum('s1', 10);
    const day = 24 * 60 * 60 * 1000;
    expect(await checkLowStockDigest(env)).toBe('sent'); // 10 Nov
    env.clock.advance(day);
    expect(await checkLowStockDigest(env)).toBe('skipped'); // 11 Nov
    env.clock.advance(day);
    expect(await checkLowStockDigest(env)).toBe('skipped'); // 12 Nov
    env.clock.advance(day);
    expect(await checkLowStockDigest(env)).toBe('sent'); // 13 Nov
    expect(sent).toHaveLength(2);
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261113');
  });

  test('selang tercapai tetapi tidak ada stok menipis: tidak terkirim dan tanggal terakhir tidak berubah', async () => {
    await configure({ intervalDays: 2 });
    await putSetting(env, SETTING_STICKER_DIGEST_LAST_DATE, '20261107');
    expect(await checkLowStockDigest(env)).toBe('skipped');
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261107');
  });

  test('pengaturan tersimpan tanpa intervalDays (data lama) dibaca tiap hari', async () => {
    await putSetting(
      env,
      SETTING_STICKER_ALERT,
      JSON.stringify({
        enabled: true,
        recipients: ['a@contoh.com'],
        digestHour: 8,
        updatedAt: 't',
      }),
    );
    await withMinimum('s1', 10);
    await putSetting(env, SETTING_STICKER_DIGEST_LAST_DATE, '20261109');
    expect(await checkLowStockDigest(env)).toBe('sent');
  });

  test('dua pemanggil serentak (dua proses atas DB yang sama): tepat satu surel', async () => {
    await withMinimum('s1', 10);
    sendBehavior = () => new Promise((resolve) => setTimeout(resolve, 200));
    const outcomes = await Promise.all([checkLowStockDigest(env), checkLowStockDigest(env)]);
    expect([...outcomes].sort()).toEqual(['sent', 'skipped']);
    expect(sent).toHaveLength(1);
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261110');
  });

  test('klaim yang dikembalikan saat kirim gagal: pemanggil lain boleh mengirim pada detak berikutnya', async () => {
    await withMinimum('s1', 10);
    await putSetting(env, SETTING_STICKER_DIGEST_LAST_DATE, '20261109');
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
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261109');
    sendBehavior = async () => undefined;
    expect(await checkLowStockDigest(env)).toBe('sent');
    expect(await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)).toBe('20261110');
  });

  test('klaim gagal dikembalikan: hasil failed dan operator diberi tahu lewat console.error', async () => {
    await withMinimum('s1', 10);
    let sendFailed = false;
    sendBehavior = async () => {
      sendFailed = true;
      throw new Error('SMTP mati');
    };
    const flaky: Env = {
      ...env,
      DB: {
        ...env.DB,
        prepare: (sql: string) => {
          if (sendFailed && sql.startsWith('UPDATE settings SET value')) {
            throw new Error('DB putus');
          }
          return env.DB.prepare(sql);
        },
      },
    };
    const messages: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(' '));
    };
    try {
      expect(await checkLowStockDigest(flaky)).toBe('failed');
    } finally {
      console.error = realError;
    }
    expect(messages.some((message) => message.includes('gagal dikembalikan'))).toBe(true);
    expect(messages.some((message) => message.includes('DB putus'))).toBe(true);
    expect(messages.join(' | ')).not.toContain('a@contoh.com');
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
