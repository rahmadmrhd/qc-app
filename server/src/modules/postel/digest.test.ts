import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { MailMessage } from '@server/core/mail';
import { putSetting } from '@server/core/settings';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SETTING_POSTEL_ALERT } from './alert';
import { checkPostelExpiryDigest } from './digest';

setDefaultTimeout(60_000);

// Email ringkasan masa berlaku Postel (spek 4b §3 butir 8): klaim per nomor sebelum kirim, ambang berbasis nilai,
// pengingat ulang di ujung, pemulihan bila kirim gagal, dan isi surel tanpa nama/jumlah item.

let env: TestEnv;
let sent: MailMessage[];
let sendBehavior: (message: MailMessage) => Promise<void>;
const realError = console.error;

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-11T02:00:00.000Z'); // 09:00 WIB, 2026-11-11
const TODAY = '2026-11-11';

/** Tanggal WIB hari ini ditambah `days` hari (`YYYY-MM-DD`). */
function onDay(days: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
}

async function configure(over: Record<string, unknown> = {}) {
  await putSetting(
    env,
    SETTING_POSTEL_ALERT,
    JSON.stringify({
      enabled: true,
      recipients: ['a@x.test'],
      sendHour: 8,
      thresholds: [90, 60, 30],
      repeatEveryDays: 7,
      updatedAt: '',
      ...over,
    }),
  );
}

interface NumberState {
  alert_sent_threshold: number | string | null;
  alert_sent_on: string;
}

async function stateOf(id: string): Promise<{ threshold: number | null; on: string }> {
  const row = await env.DB.prepare(
    'SELECT alert_sent_threshold, alert_sent_on FROM postel_numbers WHERE id = ?',
  )
    .bind(id)
    .first<NumberState>();
  const threshold = row?.alert_sent_threshold;
  return {
    threshold: threshold === null || threshold === undefined ? null : Number(threshold),
    on: (row?.alert_sent_on ?? '').trim(),
  };
}

let counter = 0;
/** Postel dengan satu item dan satu nomor Aktif; mengembalikan id catatan dan id nomor. */
async function postel(
  expiresOn: string,
  over: { model?: string; sentThreshold?: number | null; sentOn?: string; noItem?: boolean } = {},
) {
  counter += 1;
  const id = `pt${counter}`;
  const itemId = `it${counter}`;
  if (!over.noItem)
    await seedItem(env, { id: itemId, brand: 'PBE', model: over.model ?? `M${counter}` });
  await seedPostel(env, {
    id,
    ...(over.noItem ? {} : { itemIds: [itemId] }),
    numbers: [
      {
        id: `${id}-n`,
        number: `SN-${id}`,
        expiresOn,
        alertSentThreshold: over.sentThreshold ?? null,
        alertSentOn: over.sentOn ?? '',
      },
    ],
  });
  return { id, itemId, numberId: `${id}-n`, number: `SN-${id}` };
}

beforeEach(async () => {
  sent = [];
  sendBehavior = async () => undefined;
  env = await createTestEnv({
    APP_ORIGIN: 'https://qc.test',
    MAILER: {
      async send(message) {
        await sendBehavior(message);
        sent.push(message);
      },
    },
  });
  env.clock.set(T0);
  await seedBrand(env, 'PBE');
  await configure();
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

describe('checkPostelExpiryDigest: ambang dan pengulangan', () => {
  test('(a) nomor Aktif 30 hari: kirim sekali; putaran kedua hari yang sama dilewati', async () => {
    const p = await postel(onDay(30));
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['a@x.test']);
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: TODAY });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(1);
  });

  test('(b) pertama kali pada 75 hari kirim (ambang 90); ambang 60 kirim saat sisa 59 hari; 100 hari tidak kirim', async () => {
    const p = await postel(onDay(75));
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(await stateOf(p.numberId)).toEqual({ threshold: 90, on: TODAY });
    env.clock.advance(1 * DAY); // sisa 74: sasaran masih 90, bukan ujung
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    env.clock.advance(15 * DAY); // sisa 59: sasaran 60 < 90
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect((await stateOf(p.numberId)).threshold).toBe(60);
    expect(sent).toHaveLength(2);

    const far = await postel(onDay(100 + 16));
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(await stateOf(far.numberId)).toEqual({ threshold: null, on: '' });
  });

  test('(c) di ujung (30): kirim ulang setelah 7 hari, tidak setelah 3 hari, dan tidak bila repeatEveryDays 0', async () => {
    const seven = await postel(onDay(30), { sentThreshold: 30, sentOn: onDay(-7) });
    const three = await postel(onDay(30), { sentThreshold: 30, sentOn: onDay(-3) });
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(seven.number);
    expect(sent[0]?.text).not.toContain(three.number);
    expect(await stateOf(seven.numberId)).toEqual({ threshold: 30, on: TODAY });
    expect(await stateOf(three.numberId)).toEqual({ threshold: 30, on: onDay(-3) });

    await configure({ repeatEveryDays: 0 });
    const never = await postel(onDay(30), { sentThreshold: 30, sentOn: onDay(-100) });
    sent.length = 0;
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(await stateOf(never.numberId)).toEqual({ threshold: 30, on: onDay(-100) });
  });

  test('(d) kedaluwarsa: kirim sekali lalu mengulang tiap 7 hari', async () => {
    const p = await postel(onDay(-1));
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(await stateOf(p.numberId)).toEqual({ threshold: -1, on: TODAY });
    expect(sent[0]?.text).toContain('sudah kedaluwarsa');
    env.clock.advance(6 * DAY);
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    env.clock.advance(1 * DAY);
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(2);
    expect((await stateOf(p.numberId)).on).toBe(onDay(7));
  });

  test('(e) nomor Lama (bukan seq terbesar) tak pernah masuk dan state-nya tak berubah', async () => {
    await seedItem(env, { id: 'itold', brand: 'PBE', model: 'MOLD' });
    await seedPostel(env, {
      id: 'ptold',
      itemIds: ['itold'],
      numbers: [
        { id: 'old-n1', number: 'SN-LAMA', expiresOn: onDay(10), seq: 1 },
        { id: 'old-n2', number: 'SN-AKTIF', expiresOn: onDay(300), seq: 2 },
      ],
    });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect(await stateOf('old-n1')).toEqual({ threshold: null, on: '' });
  });

  test('(f) mengubah expiresOn lewat postels.save mereset state sehingga putaran berikut mengirim lagi', async () => {
    const p = await postel(onDay(30));
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    const got = (await restCall(env, 'admin@gmail.com', 'postels.get', { id: p.id })) as {
      ok: boolean;
      // biome-ignore lint/suspicious/noExplicitAny: DTO JSON tes
      data?: any;
    };
    expect(got.ok).toBe(true);
    env.clock.advance(1000);
    const saved = (await restCall(env, 'admin@gmail.com', 'postels.save', {
      id: p.id,
      expectedUpdatedAt: got.data.updatedAt,
      note: '',
      itemIds: [p.itemId],
      numbers: [{ id: p.numberId, number: p.number, expiresOn: onDay(29), link: '' }],
      attachmentIds: [],
    })) as { ok: boolean };
    expect(saved.ok).toBe(true);
    expect(await stateOf(p.numberId)).toEqual({ threshold: null, on: '' });
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  test('(g) ambang diubah menjadi [30] setelah state 60 pada 59 hari: tidak mengirim, dan tak menahan peringatan di 30 hari', async () => {
    const p = await postel(onDay(59), { sentThreshold: 60, sentOn: TODAY });
    await configure({ thresholds: [30] });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(await stateOf(p.numberId)).toEqual({ threshold: 60, on: TODAY });
    env.clock.advance(29 * DAY); // sisa 30: sasaran 30 < 60
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: onDay(29) });
  });
});

describe('checkPostelExpiryDigest: konkurensi dan kegagalan', () => {
  test('(h) dua putaran serentak: tepat satu surel, tepat satu klaim per nomor', async () => {
    const p = await postel(onDay(30));
    const outcomes = await Promise.all([
      checkPostelExpiryDigest(env),
      checkPostelExpiryDigest(env),
    ]);
    expect([...outcomes].sort()).toEqual(['sent', 'skipped']);
    expect(sent).toHaveLength(1);
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: TODAY });
  });

  test('(h2) banyak nomor serentak: tiap nomor muncul tepat sekali di seluruh surel', async () => {
    const many = await Promise.all([30, 20, 10, 5].map((days) => postel(onDay(days))));
    await Promise.all([
      checkPostelExpiryDigest(env),
      checkPostelExpiryDigest(env),
      checkPostelExpiryDigest(env),
    ]);
    const all = sent.map((message) => message.text).join('\n');
    for (const entry of many) {
      expect(all.split(entry.number).length - 1).toBe(1);
      expect(await stateOf(entry.numberId)).toEqual({ threshold: 30, on: TODAY });
    }
  });

  test('(i) send melempar: hasil failed, state pulih, putaran berikut mengirim', async () => {
    const p = await postel(onDay(30));
    sendBehavior = async () => {
      throw new Error('SMTP mati');
    };
    expect(await checkPostelExpiryDigest(env)).toBe('failed');
    expect(sent).toHaveLength(0);
    expect(await stateOf(p.numberId)).toEqual({ threshold: null, on: '' });
    sendBehavior = async () => undefined;
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: TODAY });
  });

  test('(i2) pemulihan hanya atas nilai klaim sendiri: state yang sudah diganti pihak lain tidak ditimpa', async () => {
    const p = await postel(onDay(30));
    sendBehavior = async () => {
      // selagi kirim berjalan, pihak lain mengganti nilai klaim (mis. penjadwal lain)
      await env.DB.prepare('UPDATE postel_numbers SET alert_sent_threshold = 60 WHERE id = ?')
        .bind(p.numberId)
        .run();
      throw new Error('SMTP mati');
    };
    expect(await checkPostelExpiryDigest(env)).toBe('failed');
    expect(await stateOf(p.numberId)).toEqual({ threshold: 60, on: TODAY });
  });
});

describe('checkPostelExpiryDigest: klaim mem-pin tanggal habis', () => {
  /** Menyisipkan `mutate` tepat sebelum pernyataan klaim pertama dijalankan (setelah pembacaan nomor, sebelum klaim). */
  function beforeFirstClaim(mutate: () => Promise<void>) {
    const real = env.DB;
    let fired = false;
    const wrapStatement = <T extends object>(statement: T): T =>
      new Proxy(statement, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop === 'run') {
            return async () => {
              if (!fired) {
                fired = true;
                await mutate();
              }
              return (value as () => Promise<unknown>).call(target);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    env.DB = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop !== 'prepare') return typeof value === 'function' ? value.bind(target) : value;
        return (sql: string) => {
          const prepared = target.prepare(sql);
          if (!sql.startsWith('UPDATE postel_numbers SET alert_sent_threshold')) return prepared;
          return new Proxy(prepared, {
            get(inner, key) {
              const member = Reflect.get(inner, key, inner);
              if (key === 'bind') {
                return (...args: unknown[]) =>
                  wrapStatement((member as (...a: unknown[]) => object).apply(inner, args));
              }
              return typeof member === 'function' ? member.bind(inner) : member;
            },
          });
        };
      },
    });
    return () => {
      env.DB = real;
    };
  }

  test('tanggal diperpanjang antara pembacaan dan klaim: klaim tidak berhasil, tak ada surel, state tetap; putaran berikut menilai ulang', async () => {
    const p = await postel(onDay(30));
    const restore = beforeFirstClaim(async () => {
      // seperti postels.save yang mengubah tanggal: state direset (sama dengan nilai yang dibaca) dan tanggal berganti
      await env.DB.prepare(
        "UPDATE postel_numbers SET expires_on = ?, alert_sent_threshold = NULL, alert_sent_on = '' WHERE id = ?",
      )
        .bind(onDay(200), p.numberId)
        .run();
    });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    restore();
    expect(sent).toHaveLength(0);
    expect(await stateOf(p.numberId)).toEqual({ threshold: null, on: '' });
    // tanggal baru 200 hari: belum ada ambang tercapai
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    // diperpanjang lagi ke 29 hari: dinilai ulang dengan tanggal baru dan terkirim
    await env.DB.prepare('UPDATE postel_numbers SET expires_on = ? WHERE id = ?')
      .bind(onDay(29), p.numberId)
      .run();
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(onDay(29));
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: TODAY });
  });

  test('pemulihan tidak menimpa klaim pihak lain atas tanggal yang sudah diperpanjang (nilai klaim sama)', async () => {
    const p = await postel(onDay(30));
    sendBehavior = async () => {
      // selagi kirim berjalan: tanggal diperpanjang (state direset) lalu nomor diklaim pihak lain dengan nilai yang SAMA
      await env.DB.prepare(
        "UPDATE postel_numbers SET expires_on = ?, alert_sent_threshold = NULL, alert_sent_on = '' WHERE id = ?",
      )
        .bind(onDay(29), p.numberId)
        .run();
      await env.DB.prepare(
        'UPDATE postel_numbers SET alert_sent_threshold = 30, alert_sent_on = ? WHERE id = ?',
      )
        .bind(TODAY, p.numberId)
        .run();
      throw new Error('SMTP mati');
    };
    expect(await checkPostelExpiryDigest(env)).toBe('failed');
    expect(await stateOf(p.numberId)).toEqual({ threshold: 30, on: TODAY });
  });

});

describe('checkPostelExpiryDigest: sanitasi dan penerima', () => {
  test('nomor tersimpan memuat baris baru/bidi tidak memecah baris surel', async () => {
    const p = await postel(onDay(10));
    await env.DB.prepare('UPDATE postel_numbers SET number = ? WHERE id = ?')
      .bind('SN-1\nBcc: x@y.co\u202E', p.numberId)
      .run();
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    const text = sent[0]?.text ?? '';
    expect(text).toContain('Nomor sertifikat: SN-1 Bcc: x@y.co');
    expect(text.split('\n').some((line) => line.startsWith('Bcc'))).toBe(false);
    expect(text).not.toContain('\u202E');
  });

  test('penerima tersimpan lama yang bukan satu alamat polos dibuang; semuanya tak sah = dilewati tanpa klaim', async () => {
    const p = await postel(onDay(30));
    await configure({ recipients: ['a@x.test', 'x,a@b.co', 'Nama <c@d.co>', 'e@f.test;g@h.test'] });
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent[0]?.to).toEqual(['a@x.test']);
    const q = await postel(onDay(30));
    await configure({ recipients: ['x,a@b.co', 'Nama <c@d.co>'] });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(1);
    expect(await stateOf(q.numberId)).toEqual({ threshold: null, on: '' });
    expect(p.numberId).not.toBe(q.numberId);
  });
});

describe('checkPostelExpiryDigest: isi surel', () => {
  test('(j) banyak Postel: satu surel urut sisa hari menaik; tanpa merk dan kata item; memuat nama, nomor, tanggal, tautan', async () => {
    const far = await postel(onDay(25), { model: 'M5-400' });
    const expired = await postel(onDay(-3), { model: 'Z9' });
    const near = await postel(onDay(5), { model: 'A1' });
    const noItem = await postel(onDay(12), { noItem: true });
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent).toHaveLength(1);
    const message = sent[0] as MailMessage;
    expect(message.subject).toBe('Peringatan masa berlaku Postel: 4 sertifikat');
    const text = message.text;
    const order = [expired, near, noItem, far].map((entry) => text.indexOf(entry.number));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('A1');
    expect(text).toContain('M5-400');
    expect(text).toContain(onDay(-3));
    expect(text).toContain('sudah kedaluwarsa');
    expect(text).toContain('sisa 5 hari');
    expect(text).toContain(`https://qc.test/postel/${far.id}`);
    expect(text).toContain(`https://qc.test/postel/${noItem.id}`);
    expect(text).not.toContain('PBE');
    expect(text).not.toMatch(/item/i);
    // Postel tanpa item memakai nomor sebagai nama.
    expect(text).toContain(`${noItem.number}`);
  });
});

describe('checkPostelExpiryDigest: dilewati tanpa mengubah state', () => {
  test('(k) enabled false, penerima kosong, MAILER kosong, dan sebelum jam kirim', async () => {
    const p = await postel(onDay(30));
    const untouched = async () => {
      expect(await stateOf(p.numberId)).toEqual({ threshold: null, on: '' });
      expect(sent).toHaveLength(0);
    };
    await configure({ enabled: false });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    await untouched();
    await configure({ recipients: [] });
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    await untouched();
    await configure();
    env.clock.set(Date.parse('2026-11-11T00:00:00.000Z')); // 07:00 WIB < jam 8
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    await untouched();
    env.clock.set(T0);
    const mailer = env.MAILER;
    env.MAILER = undefined;
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    await untouched();
    env.MAILER = mailer;
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
  });

  test('tanpa pengaturan tersimpan = bawaan nonaktif: dilewati', async () => {
    await env.DB.prepare('DELETE FROM settings WHERE `key` = ?').bind(SETTING_POSTEL_ALERT).run();
    await postel(onDay(30));
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(0);
  });
});
