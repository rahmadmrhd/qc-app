import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { uploadFile } from '@server/modules/files/service';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveItemInput } from '@shared/contract';
import { saveItem, setItemStatus } from './service';

// Jalur TULIS item menurut BU (spek 5.3, keputusan 13): hak per BU, himpunan BU item, NOT_FOUND bagi item di luar
// BU terlihat, dan konkurensi pada himpunan BU. Setiap user dimuat lewat `loadUserContext`.

let env: TestEnv;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const input = (over: Partial<SaveItemInput> = {}): SaveItemInput => ({
  brandId: brandIdOf('Sony'),
  businessUnitIds: ['bu-a'],
  model: 'Satu',
  isCountryLock: false,
  aliases: [],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
  ...over,
});

const linksOf = async (itemId: string): Promise<string[]> =>
  (
    (
      await env.DB.prepare('SELECT bu_id FROM item_business_units WHERE item_id = ? ORDER BY bu_id')
        .bind(itemId)
        .all<{ bu_id: string }>()
    ).results ?? []
  ).map((row) => row.bu_id.trim());

const count = async (table: string): Promise<number> =>
  Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

const updatedAtOf = async (id: string): Promise<string> =>
  (
    (await env.DB.prepare('SELECT updated_at FROM items WHERE id = ?')
      .bind(id)
      .first<{ updated_at: string }>()) as { updated_at: string }
  ).updated_at;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-08T00:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Nonaktif', status: 'inactive' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { item: 'manage' } });
  await seedBrand(env, 'Sony');
  // Editor A: edit di A saja. Editor AB: edit di A dan B. Peninjau A: lihat di A, edit di B (campuran).
  await seedUser(env, {
    id: 'u-ea',
    email: 'ea@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
  await seedUser(env, {
    id: 'u-eab',
    email: 'eab@gmail.com',
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-edit'] },
      { buId: 'bu-b', roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, {
    id: 'u-va-eb',
    email: 'vaeb@gmail.com',
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-view'] },
      { buId: 'bu-b', roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, {
    id: 'u-mab',
    email: 'mab@gmail.com',
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-manage'] },
      { buId: 'bu-b', roleIds: ['r-manage'] },
    ],
  });
  await seedUser(env, {
    id: 'u-mea',
    email: 'mea@gmail.com',
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-manage'] },
      { buId: 'bu-b', roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, { id: 'u-n', email: 'kosong@gmail.com' });
});

describe('membuat item menurut BU', () => {
  test('editor BU A membuat item di A: baris BU dan audit tercatat, BU terkembali di DTO', async () => {
    const saved = await saveItem(env, input(), await ctxOf('ea@gmail.com'));
    expect(saved.businessUnits).toEqual([{ id: 'bu-a', code: 'A', name: 'BU A' }]);
    expect(await linksOf(saved.id)).toEqual(['bu-a']);
    const audit = await env.DB.prepare(
      "SELECT `after` FROM audit_log WHERE action = 'item.create'",
    ).first<{ after: string }>();
    expect(JSON.parse(audit?.after as string).businessUnits).toEqual(['A']);
  });

  test('mass assignment/IDOR: menyebut BU di luar hak (bu-b) = FORBIDDEN, tak ada item atau baris BU', async () => {
    const user = await ctxOf('ea@gmail.com');
    for (const ids of [['bu-b'], ['bu-a', 'bu-b']]) {
      const error = await captureAppErrorAsync(() =>
        saveItem(env, input({ businessUnitIds: ids }), user),
      );
      expect(error.code).toBe('FORBIDDEN');
    }
    expect(await count('items')).toBe(0);
    expect(await count('item_business_units')).toBe(0);
  });

  test('BU tak dikenal atau nonaktif untuk item baru = VALIDATION (admin sekalipun)', async () => {
    const admin = await ctxOf('admin@gmail.com');
    for (const ids of [['tidak-ada'], ['bu-x'], ['bu-a', 'bu-x']]) {
      const error = await captureAppErrorAsync(() =>
        saveItem(env, input({ businessUnitIds: ids }), admin),
      );
      expect(error.code).toBe('VALIDATION');
      expect(error.fields?.businessUnitIds).toBe('BU tidak dikenal atau tidak aktif');
    }
    expect(await count('items')).toBe(0);
  });

  test('user tanpa penugasan BU: membuat item = FORBIDDEN, tanpa efek samping', async () => {
    const user = await ctxOf('kosong@gmail.com');
    const error = await captureAppErrorAsync(() => saveItem(env, input(), user));
    expect(error.code).toBe('FORBIDDEN');
    expect(await count('items')).toBe(0);
    expect(await count('item_business_units')).toBe(0);
    expect(await count('audit_log')).toBe(0);
  });

  test('bootstrap tanpa BU aktif: VALIDATION "buat BU dulu", tanpa item', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive'").run();
    const error = await captureAppErrorAsync(async () =>
      saveItem(env, input({ businessUnitIds: ['bu-a'] }), await ctxOf('admin@gmail.com')),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.businessUnitIds).toBe('Belum ada BU aktif; buat BU dulu');
    await env.DB.prepare('DELETE FROM business_units').run();
    const none = await captureAppErrorAsync(async () =>
      saveItem(env, input(), await ctxOf('admin@gmail.com')),
    );
    expect(none.fields?.businessUnitIds).toBe('Belum ada BU aktif; buat BU dulu');
    expect(await count('items')).toBe(0);
  });

  test('merk tidak dikenal (brandId) = VALIDATION dan tak ada baris BU yatim', async () => {
    const error = await captureAppErrorAsync(async () =>
      saveItem(env, input({ brandId: 'tidak-ada' }), await ctxOf('ea@gmail.com')),
    );
    expect(error.code).toBe('VALIDATION');
    expect(await count('item_business_units')).toBe(0);
  });
});

describe('mengubah item menurut BU', () => {
  beforeEach(async () => {
    await seedItem(env, { id: 'i-a', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i-b', brand: 'Sony', model: 'Dua', businessUnitIds: ['bu-b'] });
    await seedItem(env, {
      id: 'i-ab',
      brand: 'Sony',
      model: 'Tiga',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
  });

  test('IDOR: item di BU yang tak terlihat = NOT_FOUND (bukan FORBIDDEN), baris tak berubah', async () => {
    const user = await ctxOf('ea@gmail.com');
    const before = await updatedAtOf('i-b');
    const error = await captureAppErrorAsync(() =>
      saveItem(env, input({ id: 'i-b', model: 'Dua', businessUnitIds: ['bu-a'] }), user),
    );
    expect(error.code).toBe('NOT_FOUND');
    const missing = await captureAppErrorAsync(() =>
      saveItem(env, input({ id: 'tidak-ada', businessUnitIds: ['bu-a'] }), user),
    );
    expect(missing.message).toBe(error.message);
    expect(await updatedAtOf('i-b')).toBe(before);
    expect(await linksOf('i-b')).toEqual(['bu-b']);
    const status = await captureAppErrorAsync(() =>
      setItemStatus(env, { id: 'i-b', status: 'inactive' }, user),
    );
    expect(status.code).toBe('NOT_FOUND');
  });

  test('user tanpa penugasan BU: mengubah item mana pun = NOT_FOUND', async () => {
    const user = await ctxOf('kosong@gmail.com');
    const error = await captureAppErrorAsync(() =>
      saveItem(env, input({ id: 'i-a', model: 'Satu' }), user),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('item multi-BU, user hanya melihat salah satu BU (edit di A saja): terlihat tetapi FORBIDDEN diubah', async () => {
    const user = await ctxOf('ea@gmail.com');
    // terlihat (daftar tidak NOT_FOUND) namun hak edit tak mencakup SEMUA BU item
    const error = await captureAppErrorAsync(() =>
      saveItem(
        env,
        input({ id: 'i-ab', model: 'Tiga', businessUnitIds: ['bu-a', 'bu-b'], detail: 'x' }),
        user,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
    const status = await captureAppErrorAsync(() =>
      setItemStatus(env, { id: 'i-ab', status: 'inactive' }, user),
    );
    expect(status.code).toBe('FORBIDDEN');
    expect(await linksOf('i-ab')).toEqual(['bu-a', 'bu-b']);
  });

  test('item multi-BU: lihat di A tetapi edit di B = FORBIDDEN (butuh edit di SEMUA BU)', async () => {
    const user = await ctxOf('vaeb@gmail.com');
    const error = await captureAppErrorAsync(() =>
      saveItem(
        env,
        input({ id: 'i-ab', model: 'Tiga', businessUnitIds: ['bu-a', 'bu-b'], detail: 'y' }),
        user,
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
  });

  test('editor di semua BU item multi-BU dapat mengubahnya; BU tak berubah bila himpunan sama', async () => {
    const saved = await saveItem(
      env,
      input({ id: 'i-ab', model: 'Tiga', businessUnitIds: ['bu-b', 'bu-a'], detail: 'ok' }),
      await ctxOf('eab@gmail.com'),
    );
    expect(saved.detail).toBe('ok');
    expect(saved.businessUnits.map((bu) => bu.code)).toEqual(['A', 'B']);
    expect(await linksOf('i-ab')).toEqual(['bu-a', 'bu-b']);
  });

  test('menonaktifkan item multi-BU butuh manage di SEMUA BU; edit saja tidak cukup', async () => {
    const edit = await captureAppErrorAsync(() =>
      ctxOf('eab@gmail.com').then((u) => setItemStatus(env, { id: 'i-ab', status: 'inactive' }, u)),
    );
    expect(edit.code).toBe('FORBIDDEN');
    const mixed = await captureAppErrorAsync(() =>
      ctxOf('mea@gmail.com').then((u) => setItemStatus(env, { id: 'i-ab', status: 'inactive' }, u)),
    );
    expect(mixed.code).toBe('FORBIDDEN');
    const done = await setItemStatus(
      env,
      { id: 'i-ab', status: 'inactive' },
      await ctxOf('mab@gmail.com'),
    );
    expect(done.status).toBe('inactive');
  });

  test('menambah BU: editor di kedua BU menambah B ke item A; BU tak diedit user = FORBIDDEN', async () => {
    const added = await saveItem(
      env,
      input({ id: 'i-a', model: 'Satu', businessUnitIds: ['bu-a', 'bu-b'] }),
      await ctxOf('eab@gmail.com'),
    );
    expect(added.businessUnits.map((bu) => bu.code)).toEqual(['A', 'B']);
    expect(await linksOf('i-a')).toEqual(['bu-a', 'bu-b']);
    // editor A tidak boleh menambah B ke item miliknya (i-b tak terlihat; pakai item BU A lain)
    await seedItem(env, { id: 'i-a2', brand: 'Sony', model: 'Empat', businessUnitIds: ['bu-a'] });
    const error = await captureAppErrorAsync(async () =>
      saveItem(
        env,
        input({ id: 'i-a2', model: 'Empat', businessUnitIds: ['bu-a', 'bu-b'] }),
        await ctxOf('ea@gmail.com'),
      ),
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(await linksOf('i-a2')).toEqual(['bu-a']);
  });

  test('menambah BU nonaktif atau tak dikenal = VALIDATION; BU lama nonaktif boleh dipertahankan atau dilepas', async () => {
    const admin = await ctxOf('admin@gmail.com');
    for (const ids of [
      ['bu-a', 'bu-x'],
      ['bu-a', 'hilang'],
    ]) {
      const error = await captureAppErrorAsync(() =>
        saveItem(env, input({ id: 'i-a', model: 'Satu', businessUnitIds: ids }), admin),
      );
      expect(error.code).toBe('VALIDATION');
    }
    await seedItem(env, {
      id: 'i-x',
      brand: 'Sony',
      model: 'Lima',
      businessUnitIds: ['bu-a', 'bu-x'],
    });
    const adminAgain = await ctxOf('admin@gmail.com');
    // dipertahankan (bu-x lama, nonaktif)
    const kept = await saveItem(
      env,
      input({ id: 'i-x', model: 'Lima', businessUnitIds: ['bu-a', 'bu-x'], detail: 'tetap' }),
      adminAgain,
    );
    expect(kept.businessUnits.map((bu) => bu.code)).toEqual(['A', 'X']);
    // dilepas
    const dropped = await saveItem(
      env,
      input({ id: 'i-x', model: 'Lima', businessUnitIds: ['bu-a'] }),
      adminAgain,
    );
    expect(dropped.businessUnits.map((bu) => bu.code)).toEqual(['A']);
    expect(await linksOf('i-x')).toEqual(['bu-a']);
  });

  test('melepas BU: editor AB melepas B dari item AB; himpunan akhir tepat sesuai permintaan', async () => {
    const saved = await saveItem(
      env,
      input({ id: 'i-ab', model: 'Tiga', businessUnitIds: ['bu-a'] }),
      await ctxOf('eab@gmail.com'),
    );
    expect(saved.businessUnits.map((bu) => bu.code)).toEqual(['A']);
    expect(await linksOf('i-ab')).toEqual(['bu-a']);
  });

  test('stale: expectedUpdatedAt basi = CONFLICT dan himpunan BU tak berubah', async () => {
    const stale = await captureAppErrorAsync(async () =>
      saveItem(
        env,
        input({
          id: 'i-ab',
          model: 'Tiga',
          expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
          businessUnitIds: ['bu-a'],
        }),
        await ctxOf('eab@gmail.com'),
      ),
    );
    expect(stale.code).toBe('CONFLICT');
    expect(await linksOf('i-ab')).toEqual(['bu-a', 'bu-b']);
  });
});

describe('konkurensi pada himpunan BU', () => {
  beforeEach(async () => {
    await seedItem(env, { id: 'i-a', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-a'] });
  });

  test('Promise.all dua penyimpan dari versi yang sama dengan himpunan berbeda: satu menang, himpunan tidak bercampur', async () => {
    for (let round = 0; round < 5; round++) {
      const user = await ctxOf('eab@gmail.com');
      const expectedUpdatedAt = await updatedAtOf('i-a');
      const settled = await Promise.allSettled([
        saveItem(
          env,
          input({
            id: 'i-a',
            model: 'Satu',
            expectedUpdatedAt,
            businessUnitIds: ['bu-b'],
            detail: `b${round}`,
          }),
          user,
        ),
        saveItem(
          env,
          input({
            id: 'i-a',
            model: 'Satu',
            expectedUpdatedAt,
            businessUnitIds: ['bu-a', 'bu-b'],
            detail: `ab${round}`,
          }),
          user,
        ),
      ]);
      const winners = settled.filter((entry) => entry.status === 'fulfilled');
      const losers = settled.filter((entry) => entry.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
      const winner = (winners[0] as PromiseFulfilledResult<{ detail: string }>).value;
      const links = await linksOf('i-a');
      expect(links).toEqual(winner.detail === `b${round}` ? ['bu-b'] : ['bu-a', 'bu-b']);
      // tanpa campuran: detail tersimpan = detail pemenang
      const row = await env.DB.prepare('SELECT detail_md AS detail FROM items WHERE id = ?')
        .bind('i-a')
        .first<{ detail: string }>();
      expect(row?.detail).toBe(winner.detail);
      env.clock.advance(1000);
    }
  }, 120_000);

  test('Promise.all tanpa expectedUpdatedAt (penjaga hanya CAS baris): himpunan akhir = tepat salah satu permintaan', async () => {
    for (let round = 0; round < 5; round++) {
      const user = await ctxOf('eab@gmail.com');
      const settled = await Promise.allSettled([
        saveItem(env, input({ id: 'i-a', model: 'Satu', businessUnitIds: ['bu-b'] }), user),
        saveItem(env, input({ id: 'i-a', model: 'Satu', businessUnitIds: ['bu-a'] }), user),
        saveItem(env, input({ id: 'i-a', model: 'Satu', businessUnitIds: ['bu-a', 'bu-b'] }), user),
      ]);
      // yang gagal hanya boleh gagal karena konflik versi, bukan galat lain
      for (const entry of settled) {
        if (entry.status === 'rejected') {
          expect(entry.reason).toMatchObject({ code: 'CONFLICT' });
        }
      }
      expect(settled.some((entry) => entry.status === 'fulfilled')).toBe(true);
      const links = await linksOf('i-a');
      expect([['bu-b'], ['bu-a'], ['bu-a', 'bu-b']]).toContainEqual(links);
      env.clock.advance(1000);
    }
  }, 120_000);

  test('Promise.all membuat item identik: tepat satu berhasil, sisanya CONFLICT, satu item dan satu baris BU', async () => {
    const user = await ctxOf('ea@gmail.com');
    const settled = await Promise.allSettled(
      [1, 2, 3, 4].map(() =>
        saveItem(env, input({ model: 'Kembar', businessUnitIds: ['bu-a'] }), user),
      ),
    );
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    for (const entry of settled) {
      if (entry.status === 'rejected') expect(entry.reason).toMatchObject({ code: 'CONFLICT' });
    }
    const row = await env.DB.prepare("SELECT id FROM items WHERE model = 'Kembar'").all<{
      id: string;
    }>();
    expect(row.results).toHaveLength(1);
    expect(await linksOf((row.results[0] as { id: string }).id)).toEqual(['bu-a']);
  }, 60_000);

  test('item sama di BU berbeda: merk+tipe kembar tetap CONFLICT lintas BU (keunikan global)', async () => {
    const error = await captureAppErrorAsync(async () =>
      saveItem(
        env,
        input({ model: 'Satu', businessUnitIds: ['bu-b'] }),
        await ctxOf('eab@gmail.com'),
      ),
    );
    expect(error.code).toBe('CONFLICT');
    // pesan tidak membocorkan item BU lain
    const hidden = await captureAppErrorAsync(async () =>
      saveItem(
        env,
        input({ model: 'Satu', businessUnitIds: ['bu-b'] }),
        await ctxOf('vaeb@gmail.com'),
      ),
    );
    expect(hidden.code).toBe('CONFLICT');
  });

  test('konflik nama lain dijawab generik: tanpa merk/tipe item di BU yang tak terlihat user', async () => {
    await seedBrand(env, 'Rahasiamerk');
    await seedItem(env, {
      id: 'i-rahasia',
      brand: 'Rahasiamerk',
      model: 'Tipe-Rahasia-9',
      aliases: ['ZX-1', 'Sony ZX9'],
      businessUnitIds: ['bu-b'],
    });
    const user = await ctxOf('ea@gmail.com'); // hanya edit di BU A; item rahasia di BU B
    const text = (error: { message: string; fields?: Record<string, string> }): string =>
      [error.message, ...Object.values(error.fields ?? {})].join(' | ').toLowerCase();

    // nama lain yang user ketik bentrok dengan nama lain item BU B
    const alias = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Baru', aliases: ['ZX-1'] }), user),
    );
    expect(alias.code).toBe('CONFLICT');
    expect(alias.fields?.aliases).toBe('Nama lain "ZX-1" sudah dipakai item lain');
    expect(text(alias)).not.toContain('rahasia');

    // merk+tipe user sama dengan nama lain item BU B
    const model = await captureAppErrorAsync(() => saveItem(env, input({ model: 'ZX9' }), user));
    expect(model.code).toBe('CONFLICT');
    expect(model.fields?.model).toBe('Merk dan tipe sama dengan nama lain item lain');
    expect(text(model)).not.toContain('rahasia');

    // nama lain user sama dengan merk+tipe item BU B: hanya menggaungkan ketikan user sendiri
    const typed = 'Rahasiamerk Tipe-Rahasia-9';
    const key = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Baru2', aliases: [typed] }), user),
    );
    expect(key.code).toBe('CONFLICT');
    expect(key.fields?.aliases).toBe(`Nama lain "${typed}" sudah dipakai item lain`);
  });
});

describe('rujukan berkas item lintas BU (tanpa oracle kepemilikan)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
  const upload = async (email: string): Promise<string> =>
    (
      await uploadFile(
        env,
        { mime: 'image/png', bytes: bytesOfBase64(PNG), width: 1, height: 1 },
        await ctxOf(email),
      )
    ).id;
  const own = (fileId: string, type: string, ownerId: string) =>
    env.DB.prepare('UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ?')
      .bind(type, ownerId, fileId)
      .run();
  let fileB: string;

  beforeEach(async () => {
    await seedBrand(env, 'Rahasiamerk');
    await seedItem(env, {
      id: 'i-b',
      brand: 'Rahasiamerk',
      model: 'Tipe-Rahasia-9',
      businessUnitIds: ['bu-b'],
    });
    await seedItem(env, {
      id: 'i-ab',
      brand: 'Sony',
      model: 'Gabungan',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    fileB = await upload('eab@gmail.com');
    await own(fileB, 'item', 'i-b');
  });

  const fieldsOf = (error: { fields?: Record<string, string> }): string =>
    JSON.stringify(error.fields ?? {});

  test('berkas milik item BU lain yang tak terlihat = VALIDATION, identik dengan id tak ada, tanpa id/merk/tipe item itu', async () => {
    const user = await ctxOf('ea@gmail.com'); // hanya BU A
    const makes = [
      (id: string) => input({ model: 'Baru', attachments: [id] }),
      (id: string) => input({ model: 'Baru', stickers: [{ name: 'S', note: '', fileId: id }] }),
      (id: string) => input({ model: 'Baru', detail: `![x](qcfile:${id})` }),
    ];
    for (const make of makes) {
      const taken = await captureAppErrorAsync(() => saveItem(env, make(fileB), user));
      const unknown = await captureAppErrorAsync(() => saveItem(env, make('tidak-ada-id'), user));
      expect(taken.code).toBe('VALIDATION');
      expect(taken.message).toBe(unknown.message);
      expect(Object.keys(taken.fields ?? {})).toEqual(Object.keys(unknown.fields ?? {}));
      for (const text of [taken.message, fieldsOf(taken)].map((v) => v.toLowerCase())) {
        expect(text).not.toContain(fileB.toLowerCase());
        expect(text).not.toContain('rahasia');
      }
    }
    // berkas tak berubah pemilik, item tak tercipta
    expect(await count('items')).toBe(2);
    expect(
      (
        await env.DB.prepare('SELECT owner_id FROM files WHERE id = ?')
          .bind(fileB)
          .first<{ owner_id: string }>()
      )?.owner_id,
    ).toBe('i-b');
  });

  test('lampiran: pesan field attachments identik dengan berkas tak dikenal (VALIDATION)', async () => {
    const user = await ctxOf('ea@gmail.com');
    const taken = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Baru', attachments: [fileB] }), user),
    );
    const unknown = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Baru', attachments: ['tidak-ada-id'] }), user),
    );
    expect(taken.code).toBe('VALIDATION');
    expect(taken.message).toBe(unknown.message);
    expect(taken.fields).toEqual(unknown.fields);
    expect(fieldsOf(taken).toLowerCase()).not.toContain(fileB.toLowerCase());
  });

  test('berkas milik item yang terlihat user (BU A+B) tetap CONFLICT; berkas item sendiri tetap boleh', async () => {
    const user = await ctxOf('ea@gmail.com');
    const visibleFile = await upload('eab@gmail.com');
    await own(visibleFile, 'item', 'i-ab');
    const conflict = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Baru', attachments: [visibleFile] }), user),
    );
    expect(conflict.code).toBe('CONFLICT');
    // item sendiri: berkas yang sudah melekat pada item yang sama tetap OK
    const mine = await saveItem(env, input({ model: 'Milikku' }), user);
    const myFile = await upload('ea@gmail.com');
    await saveItem(
      env,
      input({
        id: mine.id,
        model: 'Milikku',
        attachments: [myFile],
        expectedUpdatedAt: mine.updatedAt,
      }),
      user,
    );
    const again = await saveItem(
      env,
      input({ id: mine.id, model: 'Milikku', attachments: [myFile] }),
      user,
    );
    expect(again.attachments).toEqual([myFile]);
  });
});
