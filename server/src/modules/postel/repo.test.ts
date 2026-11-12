import { beforeEach, describe, expect, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { postelIdsOf } from '@server/modules/item/repo';
import { seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  deletePostelNumberStmt,
  deletePostelNumbersOfStmt,
  deletePostelStmt,
  findPostelRecord,
  insertPostelNumberStmt,
  insertPostelStmt,
  listPostelNumbers,
  listPostelRecords,
  type PostelNumberRecord,
  type PostelRecord,
  parkPostelNumberKeyStmt,
  updatePostelNumberContentStmt,
  updatePostelNumberStmt,
  updatePostelStmt,
} from './repo';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

const T0 = '2026-11-11T00:00:00.000Z';
const T1 = '2026-11-11T01:00:00.000Z';

function postel(overrides: Partial<PostelRecord> = {}): PostelRecord {
  return {
    id: 'p1',
    note: 'catatan',
    attachments: [],
    createdAt: T0,
    updatedAt: T0,
    updatedBy: 'a@gmail.com',
    ...overrides,
  };
}

function numberRecord(overrides: Partial<PostelNumberRecord> = {}): PostelNumberRecord {
  return {
    id: 'n1',
    postelId: 'p1',
    number: 'ABC-001',
    numberKey: 'abc 001',
    expiresOn: '2027-01-31',
    link: '',
    seq: 1,
    alertSentThreshold: null,
    alertSentOn: '',
    createdAt: T0,
    updatedAt: T0,
    updatedBy: 'a@gmail.com',
    ...overrides,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<DbError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DbError);
    return error as DbError;
  }
  throw new Error('seharusnya gagal');
}

describe('postels', () => {
  test('round-trip catatan dan lampiran (larik id)', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel({ attachments: ['f2', 'f1', 'f3'], note: 'a\nb "c"' })),
    ]);
    const found = await findPostelRecord(env.DB, 'p1');
    expect(found).toEqual(postel({ attachments: ['f2', 'f1', 'f3'], note: 'a\nb "c"' }));
    expect(await findPostelRecord(env.DB, 'tidak-ada')).toBeNull();
    expect(await listPostelRecords(env.DB)).toHaveLength(1);
  });

  test('kolom lampiran rusak terbaca sebagai larik kosong', async () => {
    await env.DB.batch([insertPostelStmt(env.DB, postel())]);
    await env.DB.prepare("UPDATE postels SET attachments = 'bukan json' WHERE id = ?")
      .bind('p1')
      .run();
    expect((await findPostelRecord(env.DB, 'p1'))?.attachments).toEqual([]);
  });

  test('updatePostelStmt dengan expectedUpdatedAt salah mengubah 0 baris', async () => {
    await env.DB.batch([insertPostelStmt(env.DB, postel())]);
    const next = postel({ note: 'baru', updatedAt: T1, updatedBy: 'b@gmail.com' });
    const stale = await updatePostelStmt(env.DB, next, 'salah').run();
    expect(stale.meta.changes).toBe(0);
    expect((await findPostelRecord(env.DB, 'p1'))?.note).toBe('catatan');
    const ok = await updatePostelStmt(env.DB, next, T0).run();
    expect(ok.meta.changes).toBe(1);
    const found = await findPostelRecord(env.DB, 'p1');
    expect(found?.note).toBe('baru');
    expect(found?.updatedAt).toBe(T1);
    expect(found?.updatedBy).toBe('b@gmail.com');
    expect(found?.createdAt).toBe(T0);
  });

  test('deletePostelStmt menghapus catatan', async () => {
    await env.DB.batch([insertPostelStmt(env.DB, postel())]);
    await deletePostelStmt(env.DB, 'p1').run();
    expect(await findPostelRecord(env.DB, 'p1')).toBeNull();
  });
});

describe('postel_numbers', () => {
  test('number_key ganda gagal pada postel_numbers_key, juga lintas catatan', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelStmt(env.DB, postel({ id: 'p2' })),
      insertPostelNumberStmt(env.DB, numberRecord()),
    ]);
    const same = await failureOf(
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', seq: 2 })).run(),
    );
    expect(same.kind).toBe('duplicate');
    expect(same.key).toBe('postel_numbers_key');
    const cross = await failureOf(
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n3', postelId: 'p2', seq: 1 })).run(),
    );
    expect(cross.kind).toBe('duplicate');
    expect(cross.key).toBe('postel_numbers_key');
  });

  test('(postel_id, seq) ganda gagal pada postel_numbers_seq', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(env.DB, numberRecord()),
    ]);
    const error = await failureOf(
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', numberKey: 'lain' })).run(),
    );
    expect(error.kind).toBe('duplicate');
    expect(error.key).toBe('postel_numbers_seq');
  });

  test('listPostelNumbers terurut seq menaik per catatan dan dapat disaring', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelStmt(env.DB, postel({ id: 'p2' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n3', seq: 3, numberKey: 'k3' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n1', seq: 1, numberKey: 'k1' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', seq: 2, numberKey: 'k2' })),
      insertPostelNumberStmt(
        env.DB,
        numberRecord({ id: 'n4', postelId: 'p2', seq: 1, numberKey: 'k4' }),
      ),
    ]);
    const all = await listPostelNumbers(env.DB);
    expect(all.map((row) => row.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
    const only = await listPostelNumbers(env.DB, ['p1']);
    expect(only.map((row) => row.id)).toEqual(['n1', 'n2', 'n3']);
    expect(await listPostelNumbers(env.DB, [])).toEqual([]);
  });

  test('listPostelNumbers memotong daftar id per 500', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelStmt(env.DB, postel({ id: 'p0' })),
      insertPostelNumberStmt(env.DB, numberRecord()),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', postelId: 'p0', numberKey: 'k2' })),
    ]);
    const ids = ['p1', ...Array.from({ length: 700 }, (_, index) => `x${index}`), 'p0'];
    const rows = await listPostelNumbers(env.DB, ids);
    // p0 dibaca di potongan terakhir tetapi tetap berurutan lebih dulu (urut postel_id global)
    expect(rows.map((row) => row.id)).toEqual(['n2', 'n1']);
  });

  test('round-trip alertSentThreshold: null, 0, dan -1 dibedakan', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(
        env.DB,
        numberRecord({ id: 'n1', seq: 1, numberKey: 'k1', alertSentThreshold: null }),
      ),
      insertPostelNumberStmt(
        env.DB,
        numberRecord({
          id: 'n2',
          seq: 2,
          numberKey: 'k2',
          alertSentThreshold: 0,
          alertSentOn: '2027-01-31',
        }),
      ),
      insertPostelNumberStmt(
        env.DB,
        numberRecord({ id: 'n3', seq: 3, numberKey: 'k3', alertSentThreshold: -1 }),
      ),
    ]);
    const rows = await listPostelNumbers(env.DB, ['p1']);
    expect(rows.map((row) => row.alertSentThreshold)).toEqual([null, 0, -1]);
    expect(rows[1]?.alertSentOn).toBe('2027-01-31');
    expect(rows[0]?.alertSentOn).toBe('');
  });

  test('updatePostelNumberStmt menulis semua kolom bisnis termasuk state peringatan', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(env.DB, numberRecord({ link: 'https://a.co/x' })),
    ]);
    const next = numberRecord({
      number: 'XYZ-9',
      numberKey: 'xyz 9',
      expiresOn: '2028-02-29',
      link: '',
      seq: 4,
      alertSentThreshold: 30,
      alertSentOn: '2028-01-30',
      updatedAt: T1,
      updatedBy: 'b@gmail.com',
    });
    await updatePostelNumberStmt(env.DB, next).run();
    const [row] = await listPostelNumbers(env.DB, ['p1']);
    expect(row).toEqual(next);
  });

  test('updatePostelNumberStmt dapat menghapus state peringatan (null dan kosong terbaca balik)', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(
        env.DB,
        numberRecord({ alertSentThreshold: 30, alertSentOn: '2027-01-01' }),
      ),
    ]);
    const [before] = await listPostelNumbers(env.DB, ['p1']);
    expect(before?.alertSentThreshold).toBe(30);
    expect(before?.alertSentOn).toBe('2027-01-01');
    await updatePostelNumberStmt(
      env.DB,
      numberRecord({ alertSentThreshold: null, alertSentOn: '', updatedAt: T1 }),
    ).run();
    const [after] = await listPostelNumbers(env.DB, ['p1']);
    expect(after?.alertSentThreshold).toBeNull();
    expect(after?.alertSentOn).toBe('');
  });

  test('updatePostelNumberContentStmt tidak menimpa state peringatan kecuali resetAlert', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(env.DB, numberRecord({ link: 'https://a.co/x', seq: 3 })),
    ]);
    // Pihak lain (pengirim peringatan) menulis state SESUDAH penyimpan membaca baris (salinan penyimpan: NULL).
    await env.DB.prepare(
      "UPDATE postel_numbers SET alert_sent_threshold = 30, alert_sent_on = '2027-01-01' WHERE id = ?",
    )
      .bind(numberRecord().id)
      .run();
    const stale = numberRecord({
      link: 'https://baru.co',
      alertSentThreshold: null,
      alertSentOn: '',
      updatedAt: T1,
      updatedBy: 'b@gmail.com',
    });
    await updatePostelNumberContentStmt(env.DB, stale, false).run();
    const [kept] = await listPostelNumbers(env.DB, ['p1']);
    expect(kept).toMatchObject({
      link: 'https://baru.co',
      alertSentThreshold: 30,
      alertSentOn: '2027-01-01',
      updatedAt: T1,
      updatedBy: 'b@gmail.com',
      seq: 3,
    });
    await updatePostelNumberContentStmt(
      env.DB,
      numberRecord({ expiresOn: '2028-03-03', updatedAt: T1 }),
      true,
    ).run();
    const [reset] = await listPostelNumbers(env.DB, ['p1']);
    expect(reset).toMatchObject({
      expiresOn: '2028-03-03',
      alertSentThreshold: null,
      alertSentOn: '',
    });
    expect(reset?.seq).toBe(3);
  });

  test('parkPostelNumberKeyStmt memindahkan kunci ke placeholder unik yang tak bentrok dengan kunci nyata', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n1', numberKey: 'a 1' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', seq: 2, numberKey: 'a 2' })),
    ]);
    await parkPostelNumberKeyStmt(env.DB, 'n1', 'p1').run();
    await parkPostelNumberKeyStmt(env.DB, 'n2', 'p1').run();
    // kunci 'a 1' kini bebas dipakai baris lain
    await env.DB.batch([
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n3', seq: 3, numberKey: 'a 1' })),
    ]);
    const rows = await listPostelNumbers(env.DB, ['p1']);
    expect(rows.map((row) => row.numberKey)).toEqual(['#n1', '#n2', 'a 1']);
    // id sangat panjang tetap muat VARCHAR(100)
    const longId = 'x'.repeat(100);
    await env.DB.batch([
      insertPostelNumberStmt(env.DB, numberRecord({ id: longId, seq: 4, numberKey: 'b 1' })),
    ]);
    await parkPostelNumberKeyStmt(env.DB, longId, 'p1').run();
    const parked = (await listPostelNumbers(env.DB, ['p1'])).find((row) => row.id === longId);
    expect(parked?.numberKey).toBe('#' + 'x'.repeat(99));
  });

  test('deletePostelNumberStmt dan deletePostelNumbersOfStmt', async () => {
    await env.DB.batch([
      insertPostelStmt(env.DB, postel()),
      insertPostelStmt(env.DB, postel({ id: 'p2' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n1', numberKey: 'k1' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n2', seq: 2, numberKey: 'k2' })),
      insertPostelNumberStmt(env.DB, numberRecord({ id: 'n3', postelId: 'p2', numberKey: 'k3' })),
    ]);
    // nomor milik catatan lain tidak terhapus
    expect((await deletePostelNumberStmt(env.DB, 'n3', 'p1').run()).meta.changes).toBe(0);
    expect((await deletePostelNumberStmt(env.DB, 'n1', 'p1').run()).meta.changes).toBe(1);
    expect((await listPostelNumbers(env.DB, ['p1'])).map((row) => row.id)).toEqual(['n2']);
    await deletePostelNumbersOfStmt(env.DB, 'p1').run();
    expect(await listPostelNumbers(env.DB, ['p1'])).toEqual([]);
    expect((await listPostelNumbers(env.DB, ['p2'])).map((row) => row.id)).toEqual(['n3']);
  });
});

describe('items.postel_id', () => {
  test('bawaan kosong; postelIdsOf memetakan hanya item yang tertaut', async () => {
    await seedItem(env, { id: 'i1', brand: 'Ruijie', model: 'RG-1' });
    await seedItem(env, { id: 'i2', brand: 'Ruijie', model: 'RG-2', postelId: 'p1' });
    await seedItem(env, { id: 'i3', brand: 'Ruijie', model: 'RG-3', postelId: 'p1' });
    const row = await env.DB.prepare('SELECT postel_id FROM items WHERE id = ?')
      .bind('i1')
      .first<{ postel_id: string }>();
    expect(row?.postel_id).toBe('');
    const map = await postelIdsOf(env.DB, ['i1', 'i2', 'i3', 'tidak-ada']);
    expect([...map.entries()].sort()).toEqual([
      ['i2', 'p1'],
      ['i3', 'p1'],
    ]);
    expect((await postelIdsOf(env.DB, [])).size).toBe(0);
  });
});

describe('seedPostel', () => {
  test('mengisi catatan, nomor (seq bawaan 1..n), dan penunjuk item', async () => {
    await seedItem(env, { id: 'i1', brand: 'Ruijie', model: 'RG-1' });
    const id = await seedPostel(env, {
      id: 'p9',
      note: 'n',
      attachments: ['f1'],
      itemIds: ['i1'],
      numbers: [
        { number: 'AB 1', expiresOn: '2027-03-01' },
        { number: 'AB 2', expiresOn: '2027-04-01', link: 'https://a.co', alertSentThreshold: 0 },
      ],
    });
    expect(id).toBe('p9');
    expect((await findPostelRecord(env.DB, 'p9'))?.attachments).toEqual(['f1']);
    const numbers = await listPostelNumbers(env.DB, ['p9']);
    expect(numbers.map((row) => [row.seq, row.number, row.numberKey])).toEqual([
      [1, 'AB 1', 'ab 1'],
      [2, 'AB 2', 'ab 2'],
    ]);
    expect(numbers[1]?.alertSentThreshold).toBe(0);
    expect((await postelIdsOf(env.DB, ['i1'])).get('i1')).toBe('p9');
  });
});
