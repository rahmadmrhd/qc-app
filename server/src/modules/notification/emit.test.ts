import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { seedCustomer } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Puluhan permintaan berurutan ke MariaDB lewat terowongan SSH.
setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

const ref = { id: 't1', locationId: ENV.locA };
const WH = 'wh@gmail.com';
const QC = 'qc@gmail.com';
const WH_SIDE = ['multi@gmail.com', 'viewer@gmail.com', 'wh@gmail.com', 'whedit@gmail.com'];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
  await seedHandoverEnv(env);
});

async function seed(note = '- [ ] A = 1\n- [ ] B = 2', status: 'open' | 'cancelled' = 'open') {
  await seedCustomer(env, { id: 'cust-pt-maju', name: 'PT Maju', key: 'pt maju' });
  await seedHandover(env, {
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerId: 'cust-pt-maju',
    customerName: 'PT Maju',
    note,
    status,
  });
}

interface Row {
  recipient: string;
  kind: string;
  count: number;
  handover_id: string;
  number: string;
  actor_email: string;
  actor_name: string;
  customer_name: string;
  preview: string;
}

async function rows(): Promise<Row[]> {
  const result = await env.DB.prepare(
    'SELECT recipient, kind, `count`, handover_id, number, actor_email, actor_name, customer_name, preview FROM notifications ORDER BY recipient, kind',
  ).all<Row>();
  return result.results.map((row) => ({ ...row, count: Number(row.count) }));
}

const recipientsOf = (list: Row[], kind: string) =>
  list
    .filter((row) => row.kind === kind)
    .map((row) => row.recipient)
    .sort();

describe('kejadian menurut tabel spek 3', () => {
  test('task baru oleh wh@ -> created ke sisi QC, tidak ke pembuatnya', async () => {
    const out = await call(WH, 'handovers.save', {
      locationId: ENV.locA,
      customerName: 'PT Baru',
      note: '- [ ] X',
    });
    expect(out.ok).toBe(true);
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      recipient: QC,
      kind: 'created',
      count: 0,
      handover_id: out.data.id,
      number: out.data.number,
      actor_email: WH,
      preview: '',
    });
  });

  test('save dengan catatan berubah -> updated ke QC', async () => {
    await seed();
    const out = await call(WH, 'handovers.save', {
      ...ref,
      customerName: 'PT Maju',
      note: '- [ ] A = 1\n- [ ] B = 2\n- [ ] C = 3',
    });
    expect(out.ok).toBe(true);
    const list = await rows();
    expect(list.map((r) => [r.recipient, r.kind])).toEqual([[QC, 'updated']]);
    expect(list[0]?.number).toBe('ST-20261015-001');
    expect(list[0]?.actor_email).toBe(WH);
  });

  test('save identik -> nol baris notifikasi', async () => {
    await seed();
    const out = await call(WH, 'handovers.save', {
      ...ref,
      customerName: 'PT Maju',
      note: '- [ ] A = 1\n- [ ] B = 2',
    });
    expect(out.ok).toBe(true);
    expect(await rows()).toEqual([]);
  });

  test('cancel -> cancelled ke QC; reopen -> reopened ke QC', async () => {
    await seed();
    expect((await call(WH, 'handovers.cancel', ref)).ok).toBe(true);
    expect((await rows()).map((r) => [r.recipient, r.kind])).toEqual([[QC, 'cancelled']]);
    env.clock.advance(1000);
    expect((await call(WH, 'handovers.reopen', ref)).ok).toBe(true);
    const list = await rows();
    expect(recipientsOf(list, 'reopened')).toEqual([QC]);
    expect(list).toHaveLength(2);
  });

  test('setDone oleh qc@ -> done ke seluruh sisi WH, tidak ke qc@', async () => {
    await seed();
    expect((await call(QC, 'handovers.setDone', ref)).ok).toBe(true);
    const list = await rows();
    expect(recipientsOf(list, 'done')).toEqual(WH_SIDE);
    expect(list).toHaveLength(WH_SIDE.length);
    expect(list[0]?.actor_email).toBe(QC);
  });

  test('komentar oleh qc@ -> semua yang berhak baca kecuali qc@; cuplikan = teks komentar', async () => {
    await seed();
    const out = await call(QC, 'handovers.comment', {
      ...ref,
      quote: '',
      before: '',
      after: '',
      body: 'Tolong cek lagi',
    });
    expect(out.ok).toBe(true);
    const list = await rows();
    expect(recipientsOf(list, 'commented')).toEqual(WH_SIDE);
    expect(list.every((r) => r.preview === 'Tolong cek lagi')).toBe(true);
  });

  test('komentar oleh wh@ -> sampai ke qc@ dan sisi WH lain, bukan ke wh@', async () => {
    await seed();
    await call(WH, 'handovers.comment', { ...ref, quote: '', before: '', after: '', body: 'Halo' });
    expect(recipientsOf(await rows(), 'commented')).toEqual([
      'multi@gmail.com',
      QC,
      'viewer@gmail.com',
      'whedit@gmail.com',
    ]);
  });
});

describe('centang', () => {
  test('setCheck bernilai sama dua kali: tanpa baris notifikasi dan task tak berubah (Review Focus 1)', async () => {
    await seed();
    const payload = { ...ref, index: 0, text: 'A = 1', checked: true };
    expect((await call(QC, 'handovers.setCheck', payload)).ok).toBe(true);
    const versionOf = async () =>
      (
        await env.DB.prepare('SELECT version, updated_at FROM handovers WHERE id = ?')
          .bind('t1')
          .first<{ version: number; updated_at: string }>()
      )?.version;
    const afterFirst = await versionOf();
    env.clock.advance(1000);
    expect((await call(QC, 'handovers.setCheck', payload)).ok).toBe(true);
    expect(await versionOf()).toBe(afterFirst);
    expect(await rows()).toEqual([]);
  });

  test('centang butir terakhir yang menyelesaikan task -> done ke WH saja, tanpa kejadian checked', async () => {
    await seed('- [ ] A = 1');
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref, index: 0, text: 'A = 1', checked: true })).ok,
    ).toBe(true);
    const list = await rows();
    expect(list.map((r) => r.kind)).toEqual(['done', 'done', 'done', 'done']);
    expect(recipientsOf(list, 'done')).toEqual(WH_SIDE);
  });

  test('melepas centang task Selesai tidak menghasilkan reopened', async () => {
    await seed('- [ ] A = 1');
    await call(QC, 'handovers.setCheck', { ...ref, index: 0, text: 'A = 1', checked: true });
    env.clock.advance(1000);
    await call(QC, 'handovers.setCheck', { ...ref, index: 0, text: 'A = 1', checked: false });
    const list = await rows();
    expect(list.filter((r) => r.kind === 'reopened')).toEqual([]);
    expect(list).toHaveLength(WH_SIDE.length);
  });
});

describe('saveBatch', () => {
  const tasks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      customerName: `PT ${i + 1}`,
      note: `- [ ] butir ${i + 1}`,
    }));

  test('30 task -> tepat satu createdBatch per penerima QC dengan count 30 (Review Focus 5)', async () => {
    const out = await call(WH, 'handovers.saveBatch', { locationId: ENV.locA, tasks: tasks(30) });
    expect(out.ok).toBe(true);
    expect(out.data).toHaveLength(30);
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      recipient: QC,
      kind: 'createdBatch',
      count: 30,
      handover_id: '',
      number: '',
      actor_email: WH,
      customer_name: 'Lokasi A',
    });
  });

  test('1 task -> created biasa', async () => {
    const out = await call(WH, 'handovers.saveBatch', { locationId: ENV.locA, tasks: tasks(1) });
    expect(out.ok).toBe(true);
    const list = await rows();
    expect(list.map((r) => [r.recipient, r.kind])).toEqual([[QC, 'created']]);
    expect(list[0]?.number).toBe(out.data[0].number);
  });

  test('batch ditolak validasi -> nol baris', async () => {
    const bad = [...tasks(2), { customerName: 'X', note: '' }];
    const out = await call(WH, 'handovers.saveBatch', { locationId: ENV.locA, tasks: bad });
    expect(out.ok).toBe(false);
    expect(await rows()).toEqual([]);
  });
});

describe('atomik', () => {
  test('cancel pada task Selesai (CONFLICT) -> nol baris notifikasi', async () => {
    await seed('- [ ] A = 1');
    await call(QC, 'handovers.setDone', ref);
    await env.DB.prepare('DELETE FROM notifications').run();
    const out = await call(WH, 'handovers.cancel', ref);
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('CONFLICT');
    expect(await rows()).toEqual([]);
  });

  test('save basi (412) -> nol baris notifikasi', async () => {
    await seed();
    const out = await call(WH, 'handovers.save', {
      ...ref,
      customerName: 'PT Maju',
      note: '- [ ] A = 1\n- [ ] baru',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('CONFLICT');
    expect(await rows()).toEqual([]);
  });

  test('suntingan yang membuang butir terakhir yang belum dicentang membuat task Selesai -> updated (QC) dan done (WH)', async () => {
    await seed('- [ ] A = 1\n- [ ] B = 2');
    await call(QC, 'handovers.setCheck', { ...ref, index: 0, text: 'A = 1', checked: true });
    expect(await rows()).toEqual([]);
    env.clock.advance(1000);
    const out = await call(WH, 'handovers.save', {
      ...ref,
      customerName: 'PT Maju',
      note: '- [ ] A = 1',
    });
    expect(out.ok).toBe(true);
    expect(out.data.status).toBe('done');
    const list = await rows();
    expect(recipientsOf(list, 'updated')).toEqual([QC]);
    // wh@ pelaku: tidak menerima done atas aksinya sendiri.
    expect(recipientsOf(list, 'done')).toEqual([
      'multi@gmail.com',
      'viewer@gmail.com',
      'whedit@gmail.com',
    ]);
  });
});

describe('nama pelaku', () => {
  test('memakai users.name bila ada, selain itu email', async () => {
    await env.DB.prepare('UPDATE users SET name = ? WHERE email = ?').bind('Wati WH', WH).run();
    await seed();
    await call(WH, 'handovers.cancel', ref);
    expect((await rows())[0]?.actor_name).toBe('Wati WH');
    await env.DB.prepare('DELETE FROM notifications').run();
    env.clock.advance(1000);
    await call(WH, 'handovers.reopen', ref);
    await env.DB.prepare('UPDATE users SET name = ? WHERE email = ?').bind('', WH).run();
    env.clock.advance(1000);
    await call(WH, 'handovers.cancel', ref);
    const last = (await rows()).find((r) => r.kind === 'cancelled');
    expect(last?.actor_name).toBe(WH);
  });
});
