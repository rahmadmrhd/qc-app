import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

const list = (input: Record<string, unknown>) => call('pencatat@gmail.com', 'serials.list', input);
const names = (out: CallOut) => (out.data.items as Json[]).map((s) => s.serial).sort();

describe('filter whRecorded dan needsProof pada serials.list', () => {
  test('whRecorded: hanya pengeluaran selesai yang dihitung; pending dan serial terhapus tidak', async () => {
    for (const n of [1, 2, 3, 4]) await seedSerial(env, { id: `r${n}`, serial: `REC-${n}` });
    await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-1',
      existing: [{ id: 'r1', serial: 'REC-1' }],
    });
    // Pengeluaran pending memuat REC-2 (potongan 1 dari 2).
    await call(WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-2',
        buId: 'bu-a',
        customerName: 'PT',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 2,
        chunkSize: 1,
      },
      rows: [{ kind: 'existing', serialId: 'r2', serial: 'REC-2' }],
    });
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-12T01:00:00.000Z' WHERE id = 'r4'",
    ).run();
    expect(names(await list({ whRecorded: 'yes' }))).toEqual(['REC-1']);
    expect(names(await list({ whRecorded: 'no' }))).toEqual(['REC-2', 'REC-3']);
    const all = await list({});
    const r1 = (all.data.items as Json[]).find((s) => s.serial === 'REC-1');
    expect(r1).toMatchObject({ whRecorded: true, whCreated: false, needsProof: false });
  });

  test('needsProof: serial WH untuk item wajib foto sampai foto mencapai minimum', async () => {
    await seedBrand(env, 'Merk Foto');
    await seedItem(env, {
      id: 'i-foto',
      brand: 'Merk Foto',
      model: 'Wajib',
      businessUnitIds: ['bu-a'],
      proofRequired: true,
      proofMin: 2,
    });
    const made = await submitDispatch(env, WH_USERS.edit, { itemId: 'i-foto', fresh: ['PF-1'] });
    expect(made.ok).toBe(true);
    expect(names(await list({ needsProof: true }))).toEqual(['PF-1']);
    const row = await env.DB.prepare("SELECT id FROM serials WHERE serial = 'PF-1'").first<{
      id: string;
    }>();
    const photo = (id: string, state: string) =>
      env.DB.prepare(
        "INSERT INTO serial_proof_photos (id, serial_id, state, created_by, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x', 'x')",
      )
        .bind(id, row?.id, state)
        .run();
    await photo('p1', 'done');
    await photo('p2', 'failed');
    expect(names(await list({ needsProof: true }))).toEqual(['PF-1']);
    await photo('p3', 'queued');
    expect(names(await list({ needsProof: true }))).toEqual([]);
  });
});
