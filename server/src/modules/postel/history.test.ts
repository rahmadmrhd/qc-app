import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeAudit } from '@server/core/audit';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Riwayat perubahan Postel (`postels.history`): entri log audit bertarget `postel:<id>`, terbaru dahulu, berkursor.
// Pengguna: admin (super), stickerview@ (sticker view), nosticker@ (item view saja).

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const ADMIN = 'admin@gmail.com';
const VIEWER = 'stickerview@gmail.com';
const NOSTICKER = 'nosticker@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-umum', code: 'UMUM' });
  await seedRole(env, { id: 'r-sv', name: 'Sticker view', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-sv', email: VIEWER, roleIds: ['r-sv'] });
  await seedUser(env, { id: 'u-ns', email: NOSTICKER, roleIds: ['r-item'] });
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
  await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

async function call(email: string, id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, email, id, input)) as CallOut;
}

function body(extra: Record<string, unknown> = {}) {
  return {
    note: '',
    itemIds: ['i1'],
    numbers: [{ number: 'SN-001', expiresOn: '2027-03-01', link: '' }],
    attachmentIds: [],
    ...extra,
  };
}

async function create(extra: Record<string, unknown> = {}): Promise<Json> {
  const result = await call(ADMIN, 'postels.save', body(extra));
  expect(result.ok).toBe(true);
  env.clock.advance(1000);
  return result.data as Json;
}

/** Simpan ulang dengan nomor tertaut (id nomor dibawa) ditambah `numbers` tambahan/ubahan. */
async function update(postel: Json, numbers: Json[]): Promise<Json> {
  const result = await call(ADMIN, 'postels.save', {
    id: postel.id,
    expectedUpdatedAt: postel.updatedAt,
    ...body({ numbers }),
  });
  expect(result.ok).toBe(true);
  env.clock.advance(1000);
  return result.data as Json;
}

const keep = (n: Json) => ({ id: n.id, number: n.number, expiresOn: n.expiresOn, link: n.link });

describe('postels.history', () => {
  test('entri create lalu update terbaru dahulu; before/after memuat larik nomor dengan tanggal lama dan baru', async () => {
    const postel = await create();
    const [n1] = postel.numbers as Json[];
    const changed = await update(postel, [{ ...keep(n1), expiresOn: '2027-06-01' }]);
    const [c1] = changed.numbers as Json[];
    await update(changed, [keep(c1), { number: 'SN-002', expiresOn: '2028-01-01', link: '' }]);

    const result = await call(VIEWER, 'postels.history', { id: postel.id });
    expect(result.ok).toBe(true);
    const page = result.data as Json;
    expect(page.nextCursor).toBeNull();
    expect(page.entries.map((e: Json) => e.action)).toEqual([
      'postel.update',
      'postel.update',
      'postel.create',
    ]);
    for (const entry of page.entries) expect(entry.target).toBe(`postel:${postel.id as string}`);
    const [added, dated, created] = page.entries as Json[];
    expect(created.before).toBeNull();
    expect(created.after.numbers).toEqual(['SN-001 | 2027-03-01 | ']);
    expect(dated.before.numbers).toEqual(['SN-001 | 2027-03-01 | ']);
    expect(dated.after.numbers).toEqual(['SN-001 | 2027-06-01 | ']);
    expect(added.before.numbers).toEqual(['SN-001 | 2027-06-01 | ']);
    expect(added.after.numbers).toEqual(['SN-001 | 2027-06-01 | ', 'SN-002 | 2028-01-01 | ']);
    expect(created.actor).toBe(ADMIN);
  });

  test('entri catatan Postel lain tidak ikut', async () => {
    const first = await create();
    await create({
      itemIds: ['i2'],
      numbers: [{ number: 'SN-OTHER', expiresOn: '2027-03-01', link: '' }],
    });
    const page = (await call(ADMIN, 'postels.history', { id: first.id })).data as Json;
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].target).toBe(`postel:${first.id as string}`);
    expect(JSON.stringify(page)).not.toContain('SN-OTHER');
  });

  test('kursor halaman (limit 1) bersambung tanpa tumpang tindih; limit di luar 1-50 ditolak', async () => {
    const postel = await create();
    const [n1] = postel.numbers as Json[];
    const second = await update(postel, [{ ...keep(n1), expiresOn: '2027-06-01' }]);
    const [s1] = second.numbers as Json[];
    await update(second, [{ ...keep(s1), expiresOn: '2027-09-01' }]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 3; round++) {
      const result = await call(ADMIN, 'postels.history', {
        id: postel.id,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      const page = result.data as Json;
      expect(page.entries).toHaveLength(1);
      seen.push(page.entries[0].id);
      if (round < 2) expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(new Set(seen).size).toBe(3);
    const ids = seen.map(Number);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    for (const limit of [0, 51, 1.5]) {
      const bad = await call(ADMIN, 'postels.history', { id: postel.id, limit });
      expect(bad.ok).toBe(false);
      expect(bad.error?.code).toBe('VALIDATION');
    }
    const badCursor = await call(ADMIN, 'postels.history', { id: postel.id, cursor: 'rusak' });
    expect(badCursor.error?.code).toBe('VALIDATION');
  });

  test('kursor dengan dua baris ber-ts SAMA: id menurun, tanpa tumpang tindih atau terlewat', async () => {
    const postel = await create();
    const target = `postel:${postel.id as string}`;
    const ts = '2026-12-01T00:00:00.000Z';
    for (const note of ['a', 'b']) {
      await writeAudit(env.DB, {
        ts,
        actor: ADMIN,
        action: 'postel.update',
        target,
        before: { note: '' },
        after: { note },
      }).run();
    }
    const seen: Json[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 3; round++) {
      const page = (
        await call(VIEWER, 'postels.history', {
          id: postel.id,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        })
      ).data as Json;
      expect(page.entries).toHaveLength(1);
      seen.push(page.entries[0]);
      cursor = page.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(seen.map((e) => e.ts).slice(0, 2)).toEqual([ts, ts]);
    expect(seen.map((e) => [e.action, e.after.note])).toEqual([
      ['postel.update', 'b'],
      ['postel.update', 'a'],
      ['postel.create', ''],
    ]);
    expect(new Set(seen.map((e) => e.id)).size).toBe(3);
  });

  test('snapshot riwayat tanpa identitas item: hanya jumlah item dan lampiran', async () => {
    const postel = await create({ itemIds: ['i1', 'i2'] });
    const page = (await call(VIEWER, 'postels.history', { id: postel.id })).data as Json;
    expect(page.entries[0].after).toMatchObject({ items: 2, attachments: 0 });
    const text = JSON.stringify(page);
    for (const secret of ['"i1"', '"i2"', 'PBE', 'M5-400', 'M5-200']) {
      expect(text).not.toContain(secret);
    }
  });

  test('kabel REST: GET /postels/{id}/history dengan query limit dan cursor', async () => {
    const postel = await create();
    const [n1] = postel.numbers as Json[];
    await update(postel, [{ ...keep(n1), expiresOn: '2027-06-01' }]);
    const first = await rest.get(`/postels/${postel.id as string}/history?limit=1`, {
      email: VIEWER,
    });
    expect(first.status).toBe(200);
    const page1 = (await jsonOf(first)) as Json;
    expect(page1.entries).toHaveLength(1);
    const second = await rest.get(
      `/postels/${postel.id as string}/history?limit=1&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
      { email: VIEWER },
    );
    const page2 = (await jsonOf(second)) as Json;
    expect(page2.entries.map((e: Json) => e.action)).toEqual(['postel.create']);
    expect(page2.nextCursor).toBeNull();
  });

  test('izin: stickerview@ boleh; tanpa sticker view 403; tanpa sesi 401', async () => {
    const postel = await create();
    expect((await call(VIEWER, 'postels.history', { id: postel.id })).ok).toBe(true);
    const denied = await call(NOSTICKER, 'postels.history', { id: postel.id });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('FORBIDDEN');
    const path = `/postels/${postel.id as string}/history`;
    expect((await rest.get(path, { email: NOSTICKER })).status).toBe(403);
    expect((await rest.get(path, { email: null })).status).toBe(401);
  });

  test('catatan tak dikenal = NOT_FOUND; yang dihapus lunak hanya terbaca pemegang sticker edit; riwayatnya ada di access.audit.list', async () => {
    const missing = await call(ADMIN, 'postels.history', { id: 'tidak-ada' });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('NOT_FOUND');

    const postel = await create();
    expect((await call(ADMIN, 'postels.remove', { id: postel.id })).ok).toBe(true);
    const gone = await call(VIEWER, 'postels.history', { id: postel.id });
    expect(gone.ok).toBe(false);
    expect(gone.error?.code).toBe('NOT_FOUND');
    const visible = await call(ADMIN, 'postels.history', { id: postel.id });
    expect(visible.ok).toBe(true);
    expect((visible.data as Json).entries.map((e: Json) => e.action)).toEqual([
      'postel.delete',
      'postel.create',
    ]);
    const audit = await call(ADMIN, 'access.audit.list', {
      query: `postel:${postel.id as string}`,
    });
    expect((audit.data as Json).entries.map((e: Json) => e.action)).toEqual([
      'postel.delete',
      'postel.create',
    ]);
  });
});

describe('item terhapus pada catatan (soft delete, penampil rujukan)', () => {
  const softDelete = (id: string) =>
    env.DB.prepare(
      "UPDATE items SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed', status = 'inactive' WHERE id = ?",
    )
      .bind(id)
      .run();

  test('nama turunan, jumlah, dan model hanya dari item hidup; item terhapus tampil bertanda dan dipertahankan saat simpan', async () => {
    const postel = await create({ itemIds: ['i1', 'i2'] });
    expect(postel.itemCount).toBe(2);
    await softDelete('i2');
    const got = (await call(ADMIN, 'postels.get', { id: postel.id })).data as Json;
    expect(got.itemCount).toBe(1);
    expect(got.name).toContain('M5-400');
    expect(got.name).not.toContain('M5-200');
    expect(got.items.map((i: Json) => i.id)).toEqual(['i2', 'i1']);
    expect(got.items.find((i: Json) => i.id === 'i2')).toMatchObject({ deleted: true });
    const listed = (await call(ADMIN, 'postels.list', null)).data as Json;
    expect(listed.postels[0].itemCount).toBe(1);
    expect(listed.postels[0].models).toEqual(['M5-400']);
    // simpan dengan kedua id (rujukan tersimpan) berhasil; item terhapus tetap terpasang
    const saved = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: got.updatedAt,
      ...body({ itemIds: ['i1', 'i2'], note: 'ubah', numbers: got.numbers.map(keep) }),
    });
    expect(saved.ok).toBe(true);
    const owner = await env.DB.prepare('SELECT postel_id FROM items WHERE id = ?')
      .bind('i2')
      .first<{ postel_id: string }>();
    expect(owner?.postel_id).toBe(postel.id);
    // item terhapus yang belum terpasang tidak dapat dipilih baru
    await softDelete('i1');
    await seedItem(env, { id: 'i9', brand: 'PBE', model: 'X9' });
    await softDelete('i9');
    const picked = await call(ADMIN, 'postels.save', body({ itemIds: ['i9'] }));
    expect(picked.ok).toBe(false);
    expect(picked.error.code).toBe('VALIDATION');
  });
});
