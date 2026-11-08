import { beforeEach, describe, expect, test } from 'bun:test';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { backfillBuAssignments } from './bu-backfill';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'l-a', code: 'A' });
  await seedLocation(env, { id: 'l-b', code: 'B' });
  await seedRole(env, { id: 'r-item-view', name: 'Katalog', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-item-edit', name: 'Editor', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-ho', name: 'Serah Terima', permissions: { handover: 'edit' } });
});

/** Meniru pengguna sebelum rilis BU: kolom `bu_assignments` belum pernah diisi. */
async function resetBu(userId: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET bu_assignments = '' WHERE id = ?").bind(userId).run();
}

async function buOf(userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT bu_assignments AS b FROM users WHERE id = ?')
    .bind(userId)
    .first<{ b: string }>();
  return row?.b ?? '<tidak ada>';
}

describe('backfillBuAssignments', () => {
  test('role item di dua penugasan lokasi menjadi satu penugasan Semua BU berisi gabungan role', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'u1@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-item-view', 'r-ho'] },
        { locationId: 'l-b', roleIds: ['r-item-edit', 'r-ho'] },
      ],
    });
    await resetBu('u1');
    expect(await backfillBuAssignments(env.DB)).toBe(1);
    expect(JSON.parse(await buOf('u1'))).toEqual([
      { buId: null, roleIds: ['r-item-view', 'r-ho', 'r-item-edit'] },
    ]);
  });

  test('penugasan Semua lokasi juga dihitung; data lama hanya role_ids dibaca sebagai Semua lokasi', async () => {
    await seedUser(env, { id: 'u1', email: 'u1@gmail.com' });
    await env.DB.prepare(
      "UPDATE users SET assignments = '', role_ids = ?, bu_assignments = '' WHERE id = ?",
    )
      .bind(JSON.stringify(['r-item-edit']), 'u1')
      .run();
    await seedUser(env, {
      id: 'u2',
      email: 'u2@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-item-view'] }],
    });
    await resetBu('u2');
    expect(await backfillBuAssignments(env.DB)).toBe(2);
    expect(JSON.parse(await buOf('u1'))).toEqual([{ buId: null, roleIds: ['r-item-edit'] }]);
    expect(JSON.parse(await buOf('u2'))).toEqual([{ buId: null, roleIds: ['r-item-view'] }]);
  });

  test('user tanpa role item (hanya handover, tanpa penugasan, atau role tak dikenal) mendapat []', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'u1@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-ho'] }],
    });
    await seedUser(env, { id: 'u2', email: 'u2@gmail.com' });
    await seedUser(env, {
      id: 'u3',
      email: 'u3@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-hilang'] }],
    });
    for (const id of ['u1', 'u2', 'u3']) await resetBu(id);
    expect(await backfillBuAssignments(env.DB)).toBe(3);
    for (const id of ['u1', 'u2', 'u3']) expect(await buOf(id)).toBe('[]');
  });

  test('user yang bu_assignments-nya sudah terisi (termasuk []) tidak disentuh', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'u1@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-item-edit'] }],
      buAssignments: [],
    });
    await seedUser(env, {
      id: 'u2',
      email: 'u2@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-item-edit'] }],
      buAssignments: [{ buId: 'bu-x', roleIds: ['r-item-view'] }],
    });
    expect(await backfillBuAssignments(env.DB)).toBe(0);
    expect(await buOf('u1')).toBe('[]');
    expect(JSON.parse(await buOf('u2'))).toEqual([{ buId: 'bu-x', roleIds: ['r-item-view'] }]);
  });

  test('dijalankan dua kali: kedua kali tidak mengubah baris apa pun', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'u1@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-item-view'] }],
    });
    await resetBu('u1');
    expect(await backfillBuAssignments(env.DB)).toBe(1);
    const first = await buOf('u1');
    expect(await backfillBuAssignments(env.DB)).toBe(0);
    expect(await buOf('u1')).toBe(first);
  });

  test('dijalankan serentak: hasil akhir sama dan tidak ada yang rusak', async () => {
    await seedUser(env, {
      id: 'u1',
      email: 'u1@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-item-view'] }],
    });
    await resetBu('u1');
    const counts = await Promise.all([
      backfillBuAssignments(env.DB),
      backfillBuAssignments(env.DB),
    ]);
    expect(counts[0] + counts[1]).toBe(1);
    expect(JSON.parse(await buOf('u1'))).toEqual([{ buId: null, roleIds: ['r-item-view'] }]);
  });
});
