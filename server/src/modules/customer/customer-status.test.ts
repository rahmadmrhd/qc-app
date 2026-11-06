import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { seedCustomer } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { renameCustomer, setCustomerStatus } from './service';

// I2: perubahan status dan ganti nama customer tidak saling menimpa (lost update).

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const row = (id: string) =>
  env.DB.prepare('SELECT name, `key`, status FROM customers WHERE id = ?')
    .bind(id)
    .first<{ name: string; key: string; status: string }>();

/** DB yang menahan penulisan pertama pada tabel customers sampai `release()`. */
function gatedEnv() {
  let reached!: () => void;
  const atWrite = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fired = false;
  const delayed = {
    ...env,
    DB: {
      ...env.DB,
      batch: async (statements: Parameters<typeof env.DB.batch>[0]) => {
        const hit = statements.some((s) =>
          /^\s*UPDATE customers/.test((s as unknown as { sql: string }).sql),
        );
        if (!fired && hit) {
          fired = true;
          reached();
          await gate;
        }
        return env.DB.batch(statements);
      },
    },
  } as TestEnv;
  return { delayed, atWrite, release };
}

describe('customer: status dan ganti nama tidak saling menimpa (I2)', () => {
  test('ganti nama selesai di antara baca dan tulis status: nama/kunci baru bertahan, status berubah', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Lama' });
    const { delayed, atWrite, release } = gatedEnv();
    const pending = setCustomerStatus(delayed, { id: 'c1', status: 'inactive' }, admin);
    await atWrite;
    await renameCustomer(env, { id: 'c1', name: 'PT Baru' }, admin);
    release();
    const dto = await pending;
    expect(dto).toMatchObject({ name: 'PT Baru', status: 'inactive' });
    expect(await row('c1')).toEqual({ name: 'PT Baru', key: 'pt baru', status: 'inactive' });
  }, 60_000);

  test('status berubah selesai di antara baca dan tulis ganti nama: status baru bertahan, nama berubah', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Lama' });
    const { delayed, atWrite, release } = gatedEnv();
    const pending = renameCustomer(delayed, { id: 'c1', name: 'PT Baru' }, admin);
    await atWrite;
    await setCustomerStatus(env, { id: 'c1', status: 'inactive' }, admin);
    release();
    await pending;
    expect(await row('c1')).toEqual({ name: 'PT Baru', key: 'pt baru', status: 'inactive' });
  }, 60_000);

  test('serentak (5 putaran): nama baru dan status baru selalu keduanya berlaku', async () => {
    for (let round = 0; round < 5; round++) {
      const id = `c${round}`;
      await seedCustomer(env, { id, name: `PT Lama ${round}` });
      await Promise.all([
        setCustomerStatus(env, { id, status: 'inactive' }, admin),
        renameCustomer(env, { id, name: `PT Baru ${round}` }, admin),
      ]);
      expect(await row(id)).toEqual({
        name: `PT Baru ${round}`,
        key: `pt baru ${round}`,
        status: 'inactive',
      });
    }
  }, 60_000);
});

describe('(m3) audit status customer memakai nama dari keadaan terjaga', () => {
  test('ganti nama menyela status: audit customer.deactivate bernama baru', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Lama' });
    const { delayed, atWrite, release } = gatedEnv();
    const pending = setCustomerStatus(delayed, { id: 'c1', status: 'inactive' }, admin);
    await atWrite;
    await renameCustomer(env, { id: 'c1', name: 'PT Baru' }, admin);
    release();
    await pending;
    const audit = await env.DB.prepare(
      "SELECT target, `before`, `after` FROM audit_log WHERE action = 'customer.deactivate'",
    ).first<{ target: string; before: string; after: string }>();
    expect(audit?.target).toBe('PT Baru');
    expect(JSON.parse(audit?.before as string).name).toBe('PT Baru');
    expect(JSON.parse(audit?.after as string).name).toBe('PT Baru');
  }, 60_000);
});
