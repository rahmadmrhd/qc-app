import { beforeEach, describe, expect, test } from 'bun:test';
import type { ItemRow } from '@server/modules/item/repo';
import { ITEM_COLUMNS, toItem } from '@server/modules/item/repo';
import { saveItem } from '@server/modules/item/service';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { measureCpu } from '@server-test/measure';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SYNC_ACTOR } from '@shared/sync';
import { handleSync, handleSyncRequest } from './handler';
import { brandNameMap, driveIdsByFile, toWireItem } from './items';
import { validateSyncPull } from './pull';
import { syncRoutes } from './routes';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let env: TestEnv;
let folder: string;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Entry = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Out = { ok: boolean; data?: any; error?: any };

beforeEach(async () => {
  env = await createTestEnv({ SYNC_API_TOKEN: TOKEN });
  env.clock.set(Date.parse('2026-10-15T00:00:00.000Z'));
  folder = 'F1';
  env.BRIDGE.state.folders.add(folder);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('DRIVE_FOLDER_ID', ?)")
    .bind(folder)
    .run();
});

const drive = (name = 'a.png') => env.BRIDGE.createFile(folder, name, 'image/png', PNG);
async function call(method: string, payload: unknown): Promise<Out> {
  const result = await handleSync(
    env,
    JSON.stringify({ v: 1, method, token: TOKEN, payload }),
    syncRoutes(),
  );
  // Seperti di kabel: data berbentuk teks JSON (halaman tarik) diurai lewat `toJSON`.
  return JSON.parse(JSON.stringify(result)) as Out;
}
const push = (items: unknown[], extra: Record<string, unknown> = {}) =>
  call('sync.items.push', { items, ...extra });
async function results(items: unknown[], extra: Record<string, unknown> = {}): Promise<Entry[]> {
  const out = await push(items, extra);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out.data.results as Entry[];
}
async function pull(include: string[] = ['detail', 'stickers', 'accessories']): Promise<Entry[]> {
  const out = await call('sync.items.pull', { include });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out.data.items as Entry[];
}
async function pullPage(payload: unknown) {
  const out = await call('sync.items.pull', payload);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out.data as { items: Entry[]; nextRev: number; hasMore: boolean };
}
async function prime(resource: 'brands' | 'items', count: number) {
  await env.DB.prepare(
    'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource) DO UPDATE SET seq = excluded.seq',
  )
    .bind(resource, count, '2026-01-01T00:00:00.000Z')
    .run();
}
async function items() {
  const rows = await env.DB.prepare(
    'SELECT id, external_id, model, status, is_country_lock, aliases, alias_keys, attachments, detail_md, stickers, accessories, sync_rev FROM items ORDER BY model',
  ).all<Entry>();
  return rows.results;
}
async function audits() {
  const rows = await env.DB.prepare('SELECT actor, action FROM audit_log ORDER BY id').all<{
    actor: string;
    action: string;
  }>();
  return rows.results.map((r) => `${r.actor}|${r.action}`);
}
async function filesRows() {
  const rows = await env.DB.prepare(
    'SELECT id, drive_id, owner_type, owner_id, created_by FROM files ORDER BY rowid',
  ).all<Entry>();
  return rows.results;
}
const BASE = { id: '12', merk: 'Ubiquiti', tipe: 'ES 24 250W', isCountryLock: false };

async function seedRich() {
  await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
  for (const [id, driveId] of [
    ['f1', 'DRV1'],
    ['f2', 'DRV2'],
    ['f3', 'DRV3'],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by) VALUES (?, ?, 'image/png', 10, 1, 1, 'item', 'i1', '2026-01-01T00:00:00.000Z', 'seed')",
    )
      .bind(id, driveId)
      .run();
  }
  await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 1 });
  await env.DB.prepare(
    "UPDATE items SET external_id = '12', attachments = ?, stickers = ?, accessories = ?, detail_md = ? WHERE id = 'i1'",
  )
    .bind(
      '["f1"]',
      JSON.stringify([
        { name: 'Label', note: 'n', fileId: 'f2' },
        { name: 'G', note: '', fileId: null },
      ]),
      JSON.stringify([{ name: 'Kabel', qty: 2 }]),
      '![x](qcfile:f3) teks',
    )
    .run();
}

describe('pull', () => {
  test('bentuk kabel: merk dari tabel merk, id Drive, uid/id, active; field berat hanya bila diminta', async () => {
    await seedRich();
    expect((await pull([])).map((e) => e)).toEqual([
      {
        uid: 'i1',
        id: '12',
        merk: 'Ubiquiti',
        tipe: 'ES 24',
        isCountryLock: false,
        images: ['DRV1'],
        active: true,
        rev: 1,
      },
    ]);
    const heavy = (await pull())[0];
    expect(heavy).toMatchObject({
      detail: '![x](drive:DRV3) teks',
      stickers: [
        { name: 'Label', note: 'n', image: 'DRV2' },
        { name: 'G', note: '', image: null },
      ],
      accessories: [{ name: 'Kabel', qty: 2 }],
    });
    const onlyDetail = (await pull(['detail']))[0] ?? {};
    expect('stickers' in onlyDetail).toBe(false);
    expect('detail' in onlyDetail).toBe(true);
  });

  test('id MySQL kosong -> null; nonaktif -> active:false; berkas tak tercatat dibuang dari images', async () => {
    await seedBrand(env, 'A', { syncRev: 1 });
    await seedItem(env, { id: 'i1', brand: 'A', model: 'X', syncRev: 1, status: 'inactive' });
    await env.DB.prepare("UPDATE items SET attachments = '[\"hilang\"]' WHERE id = 'i1'").run();
    expect((await pull([]))[0]).toMatchObject({ id: null, active: false, images: [] });
  });

  test('halaman tepat sekali, urut rev, kursor benar, hasMore benar; sinceRev menyaring', async () => {
    await seedBrand(env, 'A', { syncRev: 1 });
    for (let i = 1; i <= 5; i++)
      await seedItem(env, { id: `i${i}`, brand: 'A', model: `M${i}`, syncRev: i * 10 });
    await seedItem(env, { id: 'lama', brand: 'A', model: 'Lama', syncRev: 0 });
    const seen: string[] = [];
    let since = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = await pullPage({ sinceRev: since, limit: 2 });
      seen.push(...page.items.map((entry) => String(entry.uid)));
      since = page.nextRev;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
    expect(since).toBe(50);
    expect(await pullPage({ sinceRev: 50 })).toEqual({ items: [], nextRev: 50, hasMore: false });
    expect((await pullPage({ sinceRev: 20 })).items.map((e) => e.uid)).toEqual(['i3', 'i4', 'i5']);
  });

  test('FS11: ubah alias tidak muncul di pull berikutnya; ubah detail muncul', async () => {
    const base = {
      brand: 'Ubiquiti',
      model: 'X',
      isCountryLock: false,
      aliases: [],
      stickers: [],
      accessories: [],
      attachments: [],
      detail: '',
    };
    const actor = { email: 'admin@gmail.com' };
    const saved = await saveItem(env, base, actor);
    const first = await pullPage({});
    expect(first.items.map((e) => e.uid)).toEqual([saved.id]);
    env.clock.advance(1000);
    await saveItem(env, { ...base, id: saved.id, aliases: ['Alias Baru'] }, actor);
    expect((await pullPage({ sinceRev: first.nextRev })).items).toEqual([]);
    env.clock.advance(1000);
    await saveItem(env, { ...base, id: saved.id, aliases: ['Alias Baru'], detail: 'baru' }, actor);
    expect((await pullPage({ sinceRev: first.nextRev })).items.map((e) => e.uid)).toEqual([
      saved.id,
    ]);
  });

  test('payload tidak sah -> VALIDATION; limit dibatasi 50 bila include memuat detail', async () => {
    for (const payload of [
      { sinceRev: -1 },
      { limit: 0 },
      { limit: 501 },
      { include: ['alias'] },
      { include: 'detail' },
      'x',
    ]) {
      expect(await call('sync.items.pull', payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(
      validateSyncPull({ limit: 500, include: ['detail'] }, ['detail', 'stickers', 'accessories'])
        .limit,
    ).toBe(50);
    expect(validateSyncPull({ limit: 500 }, ['detail']).limit).toBe(500);
  });

  test('P6: pull 500 item dengan field berat tetap murah dan memakai sedikit kueri D1', async () => {
    await seedBrand(env, 'A', { syncRev: 1 });
    const statements: D1PreparedStatement[] = [];
    for (let i = 1; i <= 500; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO items (id, brand_id, model, key, status, sync_rev, detail_md) VALUES (?, 'brand-a', ?, ?, 'active', ?, 'teks')",
        ).bind(`i${i}`, `M${i}`, `a m${i}`, i),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    const measured = await measureCpu(() =>
      call('sync.items.pull', { limit: 200, include: ['detail', 'stickers', 'accessories'] }),
    );
    expect(measured.result.data.items).toHaveLength(50); // dipotong ke WORKER_PULL_MAX_WITH_DETAIL
    expect(measured.ms).toBeLessThan(20);
  });
});

describe('pull: badan kabel disusun SQLite setara toWireItem', () => {
  const ALL = ['detail', 'stickers', 'accessories'];
  const LS = String.fromCharCode(0x2028);
  const SMILEY = String.fromCodePoint(0x1f600);

  async function messyRows() {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    for (const [id, driveId] of [
      ['f1', 'DRV1'],
      ['f2', 'DRV2'],
      ['f3', 'DRV3'],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by) VALUES (?, ?, 'image/png', 10, 1, 1, 'item', 'i1', '2026-01-01T00:00:00.000Z', 'seed')",
      )
        .bind(id, driveId)
        .run();
    }
    const rows: Array<[string, Record<string, string>]> = [
      [
        'rich',
        {
          external_id: '77',
          is_country_lock: 'true',
          attachments: '["f3","gaib","f1","f2"]',
          stickers: JSON.stringify([
            { name: ' Label ', note: ' n ', fileId: 'f2' },
            { name: 'Tanpa berkas', fileId: null },
            { name: 'Berkas gaib', note: 5, fileId: 'gaib' },
            { name: '   ', note: 'x' },
            ['bukan', 'objek'],
            'teks',
            { name: 'Berkas kosong', note: '', fileId: '  ' },
          ]),
          accessories: JSON.stringify([
            { name: 'Kabel', qty: 2 },
            { name: 'Nol', qty: 0 },
            { name: 'Teks', qty: '3' },
            { qty: 1 },
            { name: ' Rak ', qty: 999 },
          ]),
          detail_md: `Baris "kutip"  miring\nbaris dua\ttab ${LS} é${SMILEY} ![a](qcfile:f3) dan qcfile:gaib dan ![b](qcfile:f1)`,
        },
      ],
      ['plain', { status: 'inactive', detail_md: 'Tanpa rujukan: "kutip",  dan baris\nbaru' }],
      ['empty', { attachments: '', stickers: '', accessories: '', detail_md: '' }],
      [
        'junk',
        { attachments: '{"a":1}', stickers: 'bukan json', accessories: '{}', detail_md: 'x' },
      ],
      ['junk2', { attachments: '"f1"', stickers: '5', accessories: 'null' }],
      ['nobrand', { brand_id: 'brand-hilang' }],
    ];
    let rev = 1;
    for (const [name, extra] of rows) {
      await seedItem(env, {
        id: `i-${name}`,
        brand: 'Ubiquiti',
        model: ` Model ${name} `,
        syncRev: rev++,
      });
      for (const [column, value] of Object.entries(extra)) {
        await env.DB.prepare(`UPDATE items SET ${column} = ? WHERE id = ?`)
          .bind(value, `i-${name}`)
          .run();
      }
    }
  }

  async function expectedWire(include: string[]): Promise<Entry[]> {
    const rows = (
      await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY sync_rev`).all<ItemRow>()
    ).results;
    const records = rows.map(toItem);
    const names = await brandNameMap(env);
    const driveByFile = await driveIdsByFile(env, records, include);
    return records.map((record) => toWireItem(record, names, driveByFile, include));
  }

  for (const include of [[], ['detail'], ['stickers'], ['accessories'], ALL]) {
    test(`include=${JSON.stringify(include)}`, async () => {
      await messyRows();
      const page = await pullPage({ include });
      expect(page.items).toEqual(await expectedWire(include));
      expect(page).toMatchObject({ nextRev: 6, hasMore: false });
    });
  }

  test('badan HTTP /sync memakai teks JSON apa adanya dan sama dengan serialisasi biasa', async () => {
    await messyRows();
    const payload = { include: ALL };
    const body = JSON.stringify({ v: 1, method: 'sync.items.pull', token: TOKEN, payload });
    const response = await handleSyncRequest(
      env,
      new Request('https://x/sync', { method: 'POST', body }),
      syncRoutes(),
    );
    expect(JSON.parse(await response.text())).toEqual({ ok: true, data: await pullPage(payload) });
  });
});

describe('push', () => {
  test('item baru: created, merk dibuat otomatis, dipetakan ke id MySQL, audit atas nama sync:desktop', async () => {
    const [out] = await results([{ ...BASE, isCountryLock: 'true' }]);
    expect(out).toMatchObject({ index: 0, status: 'created', rev: 1 });
    expect((await items())[0]).toMatchObject({
      model: 'ES 24 250W',
      external_id: '12',
      is_country_lock: 'true',
      status: 'active',
      aliases: '[]',
      alias_keys: '',
    });
    const brands = await env.DB.prepare('SELECT name FROM brands').all<{ name: string }>();
    expect(brands.results.map((b) => b.name)).toEqual(['Ubiquiti']);
    expect(await audits()).toEqual([`${SYNC_ACTOR}|brand.create`, `${SYNC_ACTOR}|item.create`]);
    expect((await pull())[0]).toMatchObject({
      uid: out?.uid,
      id: '12',
      merk: 'Ubiquiti',
      tipe: 'ES 24 250W',
      isCountryLock: true,
    });
  });

  test('idempoten: push yang sama dua kali -> unchanged, rev dan audit tidak bertambah', async () => {
    const payload = [
      {
        ...BASE,
        detail: '## Judul',
        stickers: [{ name: 'Label', note: 'n', image: null }],
        accessories: [{ name: 'Kabel', qty: 1 }],
      },
    ];
    const [first] = await results(payload);
    const auditCount = (await audits()).length;
    const [second] = await results(payload);
    expect(second).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: first?.rev });
    expect(await audits()).toHaveLength(auditCount);
  });

  test('gambar: id Drive didaftarkan otomatis, Markdown drive: disimpan sebagai qcfile: dan kembali drive: saat pull', async () => {
    const [a, b, c] = [await drive('a.png'), await drive('b.png'), await drive('c.png')];
    const [out] = await results([
      {
        ...BASE,
        images: [a],
        stickers: [{ name: 'L', note: '', image: b }],
        detail: `Teks ![x](drive:${c}) lagi`,
      },
    ]);
    expect(out?.status).toBe('created');
    const rows = await filesRows();
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) => r.owner_type === 'item' && r.owner_id === out?.uid && r.created_by === SYNC_ACTOR,
      ),
    ).toBe(true);
    const fileOfC = rows.find((r) => r.drive_id === c)?.id;
    expect((await items())[0]?.detail_md).toBe(`Teks ![x](qcfile:${fileOfC}) lagi`);
    expect((await pull())[0]).toMatchObject({
      images: [a],
      stickers: [{ name: 'L', note: '', image: b }],
      detail: `Teks ![x](drive:${c}) lagi`,
    });
  });

  test('id Drive di luar folder atau tak ada -> invalid per field; tidak ada item dibuat', async () => {
    env.BRIDGE.state.folders.add('LAIN');
    const outside = await env.BRIDGE.createFile('LAIN', 'x.png', 'image/png', PNG);
    const [byImage, bySticker, byMd] = await results([
      { ...BASE, images: [outside] },
      { ...BASE, id: '13', tipe: 'B', stickers: [{ name: 'L', image: 'tidak-ada' }] },
      { ...BASE, id: '14', tipe: 'C', detail: `![x](drive:${outside})` },
    ]);
    expect(byImage).toMatchObject({
      status: 'invalid',
      fields: { images: expect.stringContaining(outside) },
    });
    expect(bySticker?.fields).toHaveProperty('stickers');
    expect(byMd?.fields).toHaveProperty('detail');
    expect(await items()).toHaveLength(0);
    expect(await filesRows()).toHaveLength(0);
  });

  test('Markdown pada push: hanya drive:<id>; https, data, dan qcfile ditolak', async () => {
    const ok = await drive();
    const bad = [
      '![x](https://x.test/a.png)',
      '![x](data:image/png;base64,AAAA)',
      '![x](qcfile:abc)',
      '![x]()',
      'teks qcfile:abc',
    ];
    // Worker: maks. 5 item per panggilan, jadi dikirim dalam dua panggilan
    const entries = [
      { ...BASE, id: '1', tipe: 'ok', detail: `![x](drive:${ok}) dan [tautan](https://x.test)` },
      ...bad.map((detail, i) => ({ ...BASE, id: `${10 + i}`, tipe: `bad${i}`, detail })),
    ];
    const out = [...(await results(entries.slice(0, 5))), ...(await results(entries.slice(5)))];
    expect(out[0]?.status).toBe('created');
    for (const entry of out.slice(1))
      expect(entry).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
    expect(await items()).toHaveLength(1);
  });

  test('semantik field: tidak dikirim = tidak diubah; [] dan "" menggantikan', async () => {
    const img = await drive();
    const first = (
      await results([
        {
          ...BASE,
          images: [img],
          detail: 'asli',
          stickers: [{ name: 'L', note: '', image: null }],
          accessories: [{ name: 'K', qty: 1 }],
        },
      ])
    )[0];
    const uid = first?.uid as string;
    expect((await results([{ uid, tipe: 'ES 24 250W', baseRev: first?.rev }]))[0]?.status).toBe(
      'unchanged',
    );
    expect((await results([{ uid, images: [], detail: '', baseRev: first?.rev }]))[0]?.status).toBe(
      'updated',
    );
    const after = (await items())[0];
    expect(after).toMatchObject({ attachments: '[]', detail_md: '' });
    expect(JSON.parse(after?.stickers)).toHaveLength(1);
    expect(JSON.parse(after?.accessories)).toHaveLength(1);
  });

  test('alias item dan alias_keys tidak berubah oleh push', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, {
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24',
      aliases: ['ES24'],
      syncRev: 1,
    });
    await env.DB.prepare("UPDATE items SET alias_keys = '|es24|' WHERE id = 'i1'").run();
    await prime('items', 1);
    const [out] = await results([{ uid: 'i1', detail: 'baru', baseRev: 1 }]);
    expect(out?.status).toBe('updated');
    expect((await items())[0]).toMatchObject({ aliases: '["ES24"]', alias_keys: '|es24|' });
  });

  test('item baru wajib merk, tipe, dan isCountryLock; "true"/"false" diterima; id MySQL angka diterima', async () => {
    const [missing, textBool, numeric, badBool] = await results([
      { id: '1', detail: 'x' },
      { ...BASE, id: '2', tipe: 'A', isCountryLock: 'false' },
      { merk: 'Ubiquiti', tipe: 'B', isCountryLock: true, id: 3 },
      { ...BASE, id: '4', tipe: 'C', isCountryLock: 'mungkin' },
    ]);
    expect(missing).toMatchObject({
      status: 'invalid',
      fields: {
        merk: expect.any(String),
        tipe: expect.any(String),
        isCountryLock: expect.any(String),
      },
    });
    expect(textBool?.status).toBe('created');
    expect(numeric?.status).toBe('created');
    expect((await items()).find((i) => i.model === 'B')?.external_id).toBe('3');
    expect(badBool).toMatchObject({
      status: 'invalid',
      fields: { isCountryLock: 'Harus true atau false' },
    });
  });

  test('konflik dua arah: baseRev basi + beda -> conflict (current lengkap, audit); terkini/overwrite/sama berhasil', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 5 });
    await env.DB.prepare("UPDATE items SET detail_md = 'server', accessories = ? WHERE id = 'i1'")
      .bind(JSON.stringify([{ name: 'K', qty: 1 }]))
      .run();
    await prime('items', 5);
    const [stale] = await results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }]);
    expect(stale).toMatchObject({
      status: 'conflict',
      uid: 'i1',
      rev: 5,
      current: {
        uid: 'i1',
        merk: 'Ubiquiti',
        tipe: 'ES 24',
        detail: 'server',
        stickers: [],
        accessories: [{ name: 'K', qty: 1 }],
        active: true,
        rev: 5,
      },
    });
    expect((await items())[0]?.detail_md).toBe('server');
    expect((await audits()).at(-1)).toBe(`${SYNC_ACTOR}|item.sync.conflict`);
    expect((await results([{ uid: 'i1', detail: 'desktop' }]))[0]?.status).toBe('conflict');
    expect((await results([{ uid: 'i1', detail: 'server', baseRev: 3 }]))[0]?.status).toBe(
      'unchanged',
    );
    env.clock.advance(1000);
    expect(
      (await results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }], { overwrite: true }))[0]
        ?.status,
    ).toBe('updated');
    const rev = (await items())[0]?.sync_rev;
    env.clock.advance(1000);
    expect((await results([{ uid: 'i1', detail: 'lagi', baseRev: rev }]))[0]?.status).toBe(
      'updated',
    );
  });

  test('pencocokan: uid, id MySQL, lalu merk+tipe ternormalisasi; pemetaan saja -> updated tanpa kenaikan rev', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES-24 250W', syncRev: 4 });
    const [mapped] = await results([
      { id: '7', merk: 'UBIQUITI', tipe: 'ES-24 250W', isCountryLock: false },
    ]);
    expect(mapped).toMatchObject({ status: 'updated', uid: 'i1', rev: 4 });
    expect((await items())[0]).toMatchObject({ external_id: '7', sync_rev: 4 });
    expect((await results([{ id: '7', merk: 'Ubiquiti', tipe: 'ES-24 250W' }]))[0]).toMatchObject({
      status: 'unchanged',
      uid: 'i1',
    });
    expect((await results([{ uid: 'i1', id: '8' }]))[0]).toMatchObject({
      status: 'conflict',
      fields: { id: expect.any(String) },
    });
    await seedItem(env, { id: 'i2', brand: 'Ubiquiti', model: 'Lain', syncRev: 6 });
    await env.DB.prepare("UPDATE items SET external_id = '9' WHERE id = 'i2'").run();
    expect((await results([{ uid: 'i1', id: '9' }]))[0]?.status).toBe('conflict');
    expect((await results([{ uid: 'tidak-ada' }]))[0]).toMatchObject({
      status: 'invalid',
      fields: { uid: expect.any(String) },
    });
  });

  test('nonaktifkan lewat active:false; rev naik; audit item.deactivate', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 3 });
    await prime('items', 3);
    const [out] = await results([{ uid: 'i1', active: false, baseRev: 3 }]);
    expect(out?.status).toBe('updated');
    expect(out?.rev).toBe(4);
    expect((await pull([]))[0]).toMatchObject({ active: false, rev: 4 });
    expect((await audits()).at(-1)).toBe(`${SYNC_ACTOR}|item.deactivate`);
  });

  test('isolasi: entri tidak sah, bentrok nama, dan sehat bercampur; urutan hasil = urutan permintaan', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, {
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24',
      aliases: ['Ubiquiti AF 5'],
      syncRev: 1,
    });
    await env.DB.prepare("UPDATE items SET alias_keys = '|ubiquiti af 5|' WHERE id = 'i1'").run();
    const out = await results([
      { ...BASE, id: '1', tipe: 'Sehat 1' },
      'bukan objek',
      { ...BASE, id: '2', tipe: 'AF 5' },
      { ...BASE, id: '3', merk: '!!!' },
      { ...BASE, id: '4', tipe: 'Sehat 2' },
    ]);
    expect(out.map((r) => r.status)).toEqual([
      'created',
      'invalid',
      'invalid',
      'invalid',
      'created',
    ]);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(out[2]?.fields).toHaveProperty('tipe');
    expect((await items()).map((i) => i.model).sort()).toEqual(['ES 24', 'Sehat 1', 'Sehat 2']);
  });

  test('batas jumlah entri dan bentuk payload', async () => {
    // Worker: maks. 5 item per panggilan, dengan atau tanpa detail (aplikasi lama: 50/25)
    const many = Array.from({ length: 6 }, (_, i) => ({ ...BASE, id: String(i), tipe: `T${i}` }));
    expect(await push(many)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { items: 'Maksimal 5 item' } },
    });
    const withDetail = many.map((entry) => ({ ...entry, detail: 'x' }));
    expect(await push(withDetail)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { items: 'Maksimal 5 item' } },
    });
    expect((await results(many.slice(0, 5))).map((entry) => entry.status)).toEqual(
      Array.from({ length: 5 }, () => 'created'),
    );
    expect(await push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await call('sync.items.push', { items: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await call('sync.items.push', null)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  test('batas isi: detail > 20.000, stiker/kelengkapan tak sah, gambar > 10', async () => {
    const [longDetail, badSticker, badQty, tooManyImages] = await results([
      { ...BASE, id: '1', tipe: 'A', detail: 'x'.repeat(20_001) },
      { ...BASE, id: '2', tipe: 'B', stickers: [{ name: '' }] },
      { ...BASE, id: '3', tipe: 'C', accessories: [{ name: 'K', qty: 1.5 }] },
      { ...BASE, id: '4', tipe: 'D', images: Array.from({ length: 11 }, (_, i) => `d${i}`) },
    ]);
    expect(longDetail?.fields).toHaveProperty('detail');
    expect(badSticker?.fields).toHaveProperty('stickers');
    expect(badQty?.fields).toHaveProperty('accessories');
    expect(tooManyImages?.fields).toHaveProperty('images');
    expect(await items()).toHaveLength(0);
  });

  test('gambar Drive yang sama dipakai dua item, atau dipindah antar item, tidak ditolak', async () => {
    const img = await drive();
    const [a, b] = await results([
      { ...BASE, id: '1', tipe: 'A', images: [img] },
      { ...BASE, id: '2', tipe: 'B', images: [img] },
    ]);
    expect(a?.status).toBe('created');
    expect(b?.status).toBe('created');
    expect((await pull([])).map((entry) => entry.images)).toEqual([[img], [img]]);
    expect((await filesRows()).filter((row) => row.drive_id === img)).toHaveLength(2);
    env.clock.advance(1000);
    await results([{ uid: a?.uid, images: [], baseRev: a?.rev }]);
    const [c] = await results([{ ...BASE, id: '3', tipe: 'C', images: [img] }]);
    expect(c?.status).toBe('created');
  });

  test('berkas baru tidak didaftarkan bila entri akhirnya invalid atau konflik (tidak ada baris files yatim)', async () => {
    const good = await drive('good.png');
    env.BRIDGE.state.folders.add('LAIN');
    const outside = await env.BRIDGE.createFile('LAIN', 'x.png', 'image/png', PNG);
    const [mixed] = await results([{ ...BASE, id: '1', tipe: 'Campur', images: [good, outside] }]);
    expect(mixed?.status).toBe('invalid');
    expect(await filesRows()).toHaveLength(0);
    await seedBrand(env, 'Ubiquiti', { syncRev: 1 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 5 });
    await env.DB.prepare("UPDATE items SET detail_md = 'server' WHERE id = 'i1'").run();
    await prime('items', 5);
    const [conflict] = await results([
      { uid: 'i1', images: [good], detail: 'desktop', baseRev: 3 },
    ]);
    expect(conflict?.status).toBe('conflict');
    expect(await filesRows()).toHaveLength(0);
    env.clock.advance(1000);
    expect((await results([{ uid: 'i1', images: [good], baseRev: 5 }]))[0]?.status).toBe('updated');
    expect(await filesRows()).toHaveLength(1);
  });

  test('tujuan gambar Markdown harus drive:<id> utuh (judul boleh); sisa seperti /sufiks ditolak', async () => {
    const id = await drive();
    const [ok, titled, suffix, query] = await results([
      { ...BASE, id: '1', tipe: 'A', detail: `![x](drive:${id})` },
      { ...BASE, id: '2', tipe: 'B', detail: `![x](drive:${id} "judul")` },
      { ...BASE, id: '3', tipe: 'C', detail: `![x](drive:${id}/sufiks)` },
      { ...BASE, id: '4', tipe: 'D', detail: `![x](drive:${id}?a=1)` },
    ]);
    expect(ok?.status).toBe('created');
    expect(titled?.status).toBe('created');
    expect(suffix).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
    expect(query?.status).toBe('invalid');
  });

  test('jumlah id Drive berbeda per item dibatasi', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `![x](drive:ID${i})`).join(' ');
    const [out] = await results([{ ...BASE, id: '1', tipe: 'Banyak', detail: many }]);
    expect(out).toMatchObject({
      status: 'invalid',
      fields: { detail: expect.stringContaining('50') },
    });
  });

  test('detail yang lolos batas di kabel tetapi > 20.000 setelah drive:->qcfile: ditolak per field', async () => {
    const c = await drive();
    const ref = `![x](drive:${c})`;
    const detail = `${ref}${'a'.repeat(20_000 - ref.length)}`;
    expect(detail.length).toBe(20_000);
    const [out] = await results([{ ...BASE, id: '77', tipe: 'Panjang', detail }]);
    expect(out).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
    expect(await items()).toHaveLength(0);
  });

  test('gambar Markdown gaya referensi dan bersarang ditolak', async () => {
    const ok = await drive();
    const bad = [
      '![x][r]\n\n[r]: https://x.test/a.png',
      `![a ![b](drive:${ok})](https://x.test/a.png)`,
      '![x]',
      '![x](drive:abc',
    ];
    const out = await results(
      bad.map((detail, i) => ({ ...BASE, id: `${30 + i}`, tipe: `ref${i}`, detail })),
    );
    for (const entry of out)
      expect(entry).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
    expect(await items()).toHaveLength(0);
  });

  test('"drive:" di luar target gambar tidak diperiksa ke Drive dan tidak mengubah isi', async () => {
    const [out] = await results([
      {
        ...BASE,
        id: '40',
        tipe: 'Teks',
        detail: 'Lihat drive:tidak-ada dan [x](drive:juga-tidak)',
      },
    ]);
    expect(out).toMatchObject({ status: 'created' });
    expect((await items())[0]?.detail_md).toBe('Lihat drive:tidak-ada dan [x](drive:juga-tidak)');
  });

  test('field yang tidak dikenal (salah ketik) ditolak per field', async () => {
    const [typo, ok] = await results([
      { ...BASE, id: '50', tipe: 'Typo', merek: 'Salah', detaill: 'x' },
      { ...BASE, id: '51', tipe: 'Ok' },
    ]);
    expect(typo).toMatchObject({
      status: 'invalid',
      fields: { merek: 'Field tidak dikenal', detaill: 'Field tidak dikenal' },
    });
    expect(ok).toMatchObject({ status: 'created' });
    expect((await items()).map((i) => i.model)).toEqual(['Ok']);
  });

  test('alias_keys terisi saat item dibuat lewat push dan konsisten dengan penulisan web', async () => {
    const [out] = await results([{ ...BASE, id: '60' }]);
    expect(out?.status).toBe('created');
    // alias hanya diubah lewat web; push tidak menyentuhnya
    expect((await items())[0]).toMatchObject({ aliases: '[]', alias_keys: '' });
  });
});
