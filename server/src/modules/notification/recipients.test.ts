import { beforeEach, describe, expect, test } from 'bun:test';
import { loadUserContext } from '@server/modules/access/context';
import { seedUser } from '@server-test/access-fixtures';
import { ENV, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { hasReadAccess, resolveRecipients } from './recipients';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
  await seedHandoverEnv(env);
});

async function emails(
  side: 'qc' | 'wh' | 'all',
  locationId: string = ENV.locA,
  excludeEmail = '',
): Promise<string[]> {
  const list = await resolveRecipients(env, { locationId, side, excludeEmail });
  return list.map((r) => r.email).sort();
}

describe('resolveRecipients', () => {
  test('sisi qc di loc-a = qc@ saja', async () => {
    expect(await emails('qc')).toEqual(['qc@gmail.com']);
  });

  test('sisi wh di loc-a = semua yang punya handover view ke atas', async () => {
    expect(await emails('wh')).toEqual([
      'multi@gmail.com',
      'viewer@gmail.com',
      'wh@gmail.com',
      'whedit@gmail.com',
    ]);
  });

  test('all = gabungan kedua sisi tanpa duplikat; noaccess@ tidak pernah ikut', async () => {
    expect(await emails('all')).toEqual([
      'multi@gmail.com',
      'qc@gmail.com',
      'viewer@gmail.com',
      'wh@gmail.com',
      'whedit@gmail.com',
    ]);
  });

  test('menurut lokasi: loc-b hanya qc@ (qc) dan multi@ (wh)', async () => {
    expect(await emails('qc', ENV.locB)).toEqual(['qc@gmail.com']);
    expect(await emails('wh', ENV.locB)).toEqual(['multi@gmail.com']);
  });

  test('user di dua sisi sekaligus muncul sekali pada all, dan ikut di masing-masing sisi', async () => {
    await seedUser(env, {
      id: 'u-dual',
      email: 'dual@gmail.com',
      assignments: [{ locationId: ENV.locA, roleIds: ['role-wh', 'role-qc'] }],
    });
    const all = await emails('all');
    expect(all.filter((e) => e === 'dual@gmail.com')).toHaveLength(1);
    expect(await emails('qc')).toEqual(['dual@gmail.com', 'qc@gmail.com']);
    expect(await emails('wh')).toContain('dual@gmail.com');
  });

  test('excludeEmail dinormalisasi (huruf besar dan spasi tetap mengecualikan)', async () => {
    expect(await emails('wh', ENV.locA, '  WH@Gmail.com ')).toEqual([
      'multi@gmail.com',
      'viewer@gmail.com',
      'whedit@gmail.com',
    ]);
    expect(await emails('qc', ENV.locA, 'QC@gmail.com')).toEqual([]);
  });

  test('user inactive tidak ikut', async () => {
    await seedUser(env, {
      id: 'u-off',
      email: 'off@gmail.com',
      status: 'inactive',
      assignments: [{ locationId: ENV.locA, roleIds: ['role-qc', 'role-wh'] }],
    });
    expect(await emails('all')).not.toContain('off@gmail.com');
  });

  test('lokasi nonaktif menghasilkan daftar kosong, juga bagi user yang ditugaskan di sana', async () => {
    await seedUser(env, {
      id: 'u-x',
      email: 'x@gmail.com',
      assignments: [{ locationId: ENV.locOff, roleIds: ['role-qc', 'role-wh'] }],
    });
    expect(await emails('all', ENV.locOff)).toEqual([]);
    expect(await emails('qc', ENV.locOff)).toEqual([]);
  });

  test('penugasan Semua lokasi berlaku di setiap lokasi aktif', async () => {
    await seedUser(env, {
      id: 'u-global',
      email: 'global@gmail.com',
      assignments: [{ locationId: null, roleIds: ['role-qc'] }],
    });
    expect(await emails('qc', ENV.locB)).toEqual(['global@gmail.com', 'qc@gmail.com']);
  });

  test('membawa nama pengguna', async () => {
    await seedUser(env, {
      id: 'u-named',
      email: 'named@gmail.com',
      name: 'Dewi',
      assignments: [{ locationId: ENV.locA, roleIds: ['role-qc'] }],
    });
    const list = await resolveRecipients(env, {
      locationId: ENV.locA,
      side: 'qc',
      excludeEmail: '',
    });
    expect(list.find((r) => r.email === 'named@gmail.com')?.name).toBe('Dewi');
  });
});

describe('hasReadAccess', () => {
  async function access(email: string, locationId: string): Promise<boolean> {
    const user = await loadUserContext(env, email);
    if (user === null) throw new Error(`user ${email} tidak ada`);
    return hasReadAccess(user, locationId);
  }

  test('benar untuk handover view dan qc edit di lokasinya', async () => {
    expect(await access('viewer@gmail.com', ENV.locA)).toBe(true);
    expect(await access('wh@gmail.com', ENV.locA)).toBe(true);
    expect(await access('qc@gmail.com', ENV.locA)).toBe(true);
    expect(await access('qc@gmail.com', ENV.locB)).toBe(true);
  });

  test('salah tanpa izin di lokasi itu atau di lokasi lain', async () => {
    expect(await access('noaccess@gmail.com', ENV.locA)).toBe(false);
    expect(await access('viewer@gmail.com', ENV.locB)).toBe(false);
    expect(await access('viewer@gmail.com', ENV.locOff)).toBe(false);
    expect(await access('viewer@gmail.com', 'loc-tidak-ada')).toBe(false);
  });
});
