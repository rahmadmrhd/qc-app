import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV } from '@server-test/handover-env';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedTask, seedWarehouseWorld, WH_USERS } from './handover-test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
  await seedTask(env, { id: 't1' });
});

const fresh = (serial: string) => ({
  kind: 'new' as const,
  clientId: crypto.randomUUID(),
  serial,
  locationId: ENV.locA,
  testDate: '2026-11-12',
});

function header(total: number, over: Record<string, unknown> = {}) {
  return {
    mode: 'note',
    boxStart: 5,
    boxSize: 2,
    dispatchedOn: '2026-11-12',
    orderNumber: '',
    buId: 'bu-a',
    customerName: '',
    itemId: 'i-ax300',
    note: '',
    handoverIds: [] as string[],
    total,
    chunkSize: 200,
    ...over,
  };
}

const submit = (
  rows: unknown[],
  over: { header?: Record<string, unknown>; email?: string; clientId?: string } = {},
) =>
  restCall(env, over.email ?? WH_USERS.wh, 'serialWarehouse.submit', {
    clientId: over.clientId ?? crypto.randomUUID(),
    chunkIndex: 0,
    header: header(rows.length, over.header),
    rows,
  }) as Promise<Json>;

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n ?? 0);

describe('Catat Serial WH mode catatan', () => {
  test('menyimpan catatan Markdown bernomor #YYMM-0001, tanpa SO/customer/stok kardus', async () => {
    const note = '## Catatan\n\n- [ ] satu\n- dua';
    const out = await submit([fresh('N-1'), fresh('N-2'), fresh('N-3')], { header: { note } });
    expect(out.ok).toBe(true);
    expect(out.data.status).toBe('done');
    expect(out.data.orderId).toBeUndefined();
    expect(out.data.serials).toEqual(['N-1', 'N-2', 'N-3']);
    const row = await env.DB.prepare(
      'SELECT number, kind, bu_id, order_id, note, box_start, box_size FROM warehouse_dispatches WHERE id = ?',
    )
      .bind(out.data.dispatchId)
      .first<Json>();
    expect(row.number).toBe('WH/A/2611-0001');
    expect(row.kind).toBe('note');
    expect(row.bu_id).toBe('bu-a');
    expect(row.order_id).toBe(out.data.dispatchId);
    expect(row.note).toBe(note);
    expect(Number(row.box_start)).toBe(5);
    expect(Number(row.box_size)).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_ready_boxes')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_ready_serials')).toBe(0);
    const second = await submit([fresh('N-9')]);
    const next = await env.DB.prepare('SELECT number FROM warehouse_dispatches WHERE id = ?')
      .bind(second.data.dispatchId)
      .first<{ number: string }>();
    expect(next?.number).toBe('WH/A/2611-0002');
  });

  test('isian SO, customer, atau orderId ditolak; kardus wajib; kontrol selain baris baru ditolak', async () => {
    for (const over of [
      { orderNumber: 'SO-1' },
      { customerName: 'PT Maju' },
      { orderId: 'o1' },
      { boxStart: undefined },
      { boxSize: undefined },
      { note: 'a\u0000b' },
      { note: 'x'.repeat(5001) },
    ]) {
      const out = await submit([fresh('NV-1')], { header: over });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
    }
  });

  test('serial yang sama boleh dicatat ulang di catatan lain; serial lama tak berubah; ganda dalam satu catatan dilewati', async () => {
    const first = await submit([fresh('RE-1'), fresh('RE-2')]);
    expect(first.ok).toBe(true);
    const existing = await env.DB.prepare(
      "SELECT id, status, custody, bu_id FROM serials WHERE serial = 'RE-1'",
    ).first<Json>();
    const again = await submit([
      { kind: 'existing', serialId: existing.id.trim(), serial: 'RE-1' },
      fresh('RE-2'),
    ]);
    expect(again.ok).toBe(true);
    expect(again.data.serials).toEqual(['RE-1', 'RE-2']);
    expect(again.data.created).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM serials WHERE serial = 'RE-1'")).toBe(1);
    const after = await env.DB.prepare(
      "SELECT status, custody, bu_id FROM serials WHERE serial = 'RE-1'",
    ).first<Json>();
    expect(after).toMatchObject({ status: existing.status, custody: existing.custody });
    expect(after.bu_id).toBe(existing.bu_id);
    expect(
      await count("SELECT COUNT(*) AS n FROM warehouse_dispatch_serials WHERE serial = 'RE-1'"),
    ).toBe(2);
    // Satu catatan bertahap: serial yang sudah masuk di potongan sebelumnya dilewati.
    const clientId = crypto.randomUUID();
    const part1 = (await restCall(env, WH_USERS.wh, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header: header(2, { chunkSize: 1 }),
      rows: [fresh('DUP-1')],
    })) as Json;
    expect(part1.ok).toBe(true);
    const part2 = (await restCall(env, WH_USERS.wh, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header: header(2, { chunkSize: 1 }),
      rows: [fresh('DUP-1')],
    })) as Json;
    expect(part2.ok).toBe(true);
    expect(part2.data.skipped).toEqual([{ serial: 'DUP-1', reason: 'Sudah ada di catatan ini' }]);
  });

  test('menaut task Serah Terima dan menurunkan kardus per serial pada detail', async () => {
    const out = await submit([fresh('BX-1'), fresh('BX-2'), fresh('BX-3')], {
      header: { handoverIds: ['t1'] },
    });
    expect(out.ok).toBe(true);
    const detail = (await restCall(env, WH_USERS.wh, 'serialWarehouse.dispatchGet', {
      id: out.data.dispatchId,
    })) as Json;
    expect(detail.data.kind).toBe('note');
    expect(detail.data.number).toBe('WH/A/2611-0001');
    expect(detail.data.handovers.map((h: Json) => h.id)).toEqual(['t1']);
    const serials = (await restCall(env, WH_USERS.wh, 'serialWarehouse.dispatchSerials', {
      id: out.data.dispatchId,
    })) as Json;
    expect(
      serials.data.items.map((i: Json) => [i.serial, i.boxNumber, i.capacity, i.boxCount]),
    ).toEqual([
      ['BX-1', 5, 2, 2],
      ['BX-2', 5, 2, 2],
      ['BX-3', 6, 2, 1],
    ]);
  });

  test('kiriman ulang idempoten dan hak per BU berlaku', async () => {
    const clientId = crypto.randomUUID();
    const rows = [fresh('ID-1')];
    const a = await submit(rows, { clientId });
    const b = await submit(rows, { clientId });
    expect(b.ok).toBe(true);
    expect(b.data.dispatchId).toBe(a.data.dispatchId);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(1);
    const other = await submit([fresh('ID-2')], { email: WH_USERS.otherBu });
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
  });
});
