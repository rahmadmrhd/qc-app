import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ensureSerialUniqueIndex } from '@server/modules/serial/bu-history';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { applyPlan, loadTargetState, resolvePlan } from './apply';
import { miniDump } from './fixture';
import { buildPlan } from './plan';

setDefaultTimeout(60_000);

const NOW = '2026-11-17T16:00:00.000Z';
const VIEWER = 'pelihat-semua-bu@gmail.com';

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk respons beragam, diperiksa per tes
type Json = any;

const plan = () => buildPlan(miniDump(), { itemBu: 'brand+serials', now: NOW });

/** Tujuan TIDAK kosong: BU Spectrum, lokasi Surabaya, merk Ubiquiti dan satu item yang sudah ada (+ nama lain). */
beforeEach(async () => {
  env = await createTestEnv();
  await ensureSerialBuTable();
  await seedBusinessUnit(env, { id: 'bu-spc', code: 'SPC', name: 'Spectrum' });
  await seedLocation(env, { id: 'loc-sby', code: 'SBY', name: 'Surabaya' });
  await seedBrand(env, 'Ubiquiti', { id: 'brand-ubnt' });
  await seedItem(env, {
    id: 'it-existing',
    brand: 'Ubiquiti',
    brandId: 'brand-ubnt',
    model: 'UAP AC Lite',
    // Nama lain berada di ruang kunci yang sama dengan `items.key` (merk + tipe), jadi ditulis lengkap dengan merk.
    // Tipe lama 2 ("Ubiquiti UAP AC LR") harus cocok lewat nama lain ini, bukan dibuat sebagai item baru.
    aliases: ['Ubiquiti UAP AC LR'],
    businessUnitIds: ['bu-spc'],
  });
  // Dua item Country Lock yang sudah ada: satu firmware masih kosong (akan diisi), satu sudah berisi (tak boleh ditimpa).
  await seedItem(env, {
    id: 'it-nano',
    brand: 'Ubiquiti',
    brandId: 'brand-ubnt',
    model: 'NanoStation',
    businessUnitIds: ['bu-spc'],
  });
  await seedItem(env, {
    id: 'it-loco',
    brand: 'Ubiquiti',
    brandId: 'brand-ubnt',
    model: 'NanoStation Loco',
    businessUnitIds: ['bu-spc'],
  });
  await env.DB.prepare(
    "UPDATE items SET is_country_lock = 'true' WHERE id IN ('it-nano', 'it-loco')",
  ).run();
  await env.DB.prepare("UPDATE items SET firmware = 'XM' WHERE id = 'it-loco'").run();
  await seedRole(env, { id: 'r-view', name: 'Serial view', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-v',
    email: VIEWER,
    buAssignments: [{ buId: null, roleIds: ['r-view'] }],
  });
});

/**
 * Tabel riwayat BU (migrasi 0026, spek serial unik se-sistem §4.1) sudah ada di templat skema tes; `CREATE TABLE IF NOT
 * EXISTS` hanya jaring pengaman bila skema tes lama dipakai. Definisi sama dengan migrasi.
 */
async function ensureSerialBuTable(): Promise<void> {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS serial_business_units (serial_id VARCHAR(100) NOT NULL, bu_id VARCHAR(100) NOT NULL, first_at VARCHAR(40) NOT NULL DEFAULT '', left_at VARCHAR(40) NOT NULL DEFAULT '', PRIMARY KEY (serial_id, bu_id), KEY serial_bu_by_bu (bu_id, left_at, serial_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin",
  ).run();
  await env.DB.prepare('TRUNCATE TABLE serial_business_units').run();
}

const count = async (table: string): Promise<number> =>
  Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

describe('resolvePlan terhadap tujuan yang tidak kosong', () => {
  test('mencocokkan BU/lokasi/merk menurut nama dan item menurut kunci lalu nama lain; hanya yang belum ada dibuat', async () => {
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(resolved.blockers).toEqual([]);
    expect(resolved.createBus.map((bu) => bu.name).sort()).toEqual(['IJW', 'Teakwave']);
    expect(resolved.createLocations.map((l) => l.name)).toEqual(['Jakarta']);
    expect(resolved.createBrands.map((b) => b.name).sort()).toEqual(['Mikrotik', 'VSOL']);
    const byLegacy = new Map(resolved.itemResolutions.map((r) => [r.legacyId, r]));
    expect(byLegacy.get(1)).toMatchObject({ action: 'match-key', itemId: 'it-existing' });
    expect(byLegacy.get(2)).toMatchObject({ action: 'match-alias', itemId: 'it-existing' });
    expect(byLegacy.get(3)?.action).toBe('create');
    // Item yang sudah ada tidak ditimpa: hanya tautan BU yang kurang (Teakwave, karena ada serial di sana).
    expect(resolved.createItems.map((i) => i.legacyId)).toEqual([3, 4, 5, 7, 10, 11]);
    // Firmware: item baru membawa kolomnya; item tujuan yang kosong diisi; yang sudah berisi dibiarkan.
    expect(byLegacy.get(3)).toMatchObject({ firmware: 'AC', firmwareAction: 'new' });
    expect(byLegacy.get(8)).toMatchObject({
      action: 'match-key',
      firmware: 'M',
      firmwareAction: 'fill',
    });
    expect(byLegacy.get(9)).toMatchObject({
      action: 'match-key',
      firmware: 'WA',
      firmwareAction: 'keep',
    });
    expect(byLegacy.get(10)?.firmwareAction).toBe('none');
    expect(resolved.firmwareFills).toEqual([{ itemId: 'it-nano', firmware: 'M' }]);
    expect(resolved.serials).toHaveLength(7);
    expect(resolved.alreadyMigrated).toBe(0);
  });

  test('BU yang namanya beda tetapi kodenya sama dengan kode usulan dicocokkan, tidak dibuat ganda', async () => {
    await seedBusinessUnit(env, { id: 'bu-tkw', code: 'tkw', name: 'Teakwave Indonesia' });
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(resolved.blockers).toEqual([]);
    expect(resolved.createBus.map((bu) => bu.name)).not.toContain('Teakwave');
    await applyPlan(env.DB, resolved, NOW);
    const rows = await env.DB.prepare(
      "SELECT DISTINCT bu_id FROM serial_business_units WHERE bu_id = 'bu-tkw'",
    ).all<{ bu_id: string }>();
    expect(rows.results).toHaveLength(1);
    expect(await count('business_units')).toBe(3);
  });

  test('nama yang sama diutamakan atas kode: BU bernama Teakwave dipakai walau BU lain berkode TKW', async () => {
    await seedBusinessUnit(env, { id: 'bu-nama', code: 'TKX', name: 'Teakwave' });
    await seedBusinessUnit(env, { id: 'bu-kode', code: 'tkw', name: 'Lain' });
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(resolved.blockers).toEqual([]);
    expect(resolved.createBus.map((bu) => bu.name)).not.toContain('Teakwave');
    await applyPlan(env.DB, resolved, NOW);
    const used = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serial_business_units WHERE bu_id = 'bu-nama'",
    ).first<{ n: number | string }>();
    expect(Number(used?.n)).toBeGreaterThan(0);
    const other = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serial_business_units WHERE bu_id = 'bu-kode'",
    ).first<{ n: number | string }>();
    expect(Number(other?.n)).toBe(0);
  });

  test('serial yang sudah ada di tujuan (serial sama, di BU mana pun) dilaporkan sebagai bentrok, bukan ditulis', async () => {
    await env.DB.prepare(
      "INSERT INTO serials (id, client_id, bu_id, serial, item_id) VALUES ('s-ada', 'c-ada', 'bu-spc', 'F5BC0F1E4059', 'it-existing')",
    ).run();
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(resolved.conflicts).toEqual([
      {
        legacyId: 100,
        serial: 'F5BC0F1E4059',
        buName: 'Spectrum',
        reason: 'sudah ada di tujuan (serial sama, di BU mana pun)',
      },
    ]);
    expect(resolved.serials.map((s) => s.legacyId)).not.toContain(100);
    await applyPlan(env.DB, resolved, NOW);
    expect(await count('serials')).toBe(1 + 6);
  });
});

describe('applyPlan', () => {
  test('menulis master dan serial; hasil terbaca lewat serials.get; item yang ada tidak diubah', async () => {
    const before = await env.DB.prepare(
      'SELECT model, detail_md, updated_by FROM items WHERE id = ?',
    )
      .bind('it-existing')
      .first<{ model: string; detail_md: string; updated_by: string }>();
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    const result = await applyPlan(env.DB, resolved, NOW);
    expect(result).toMatchObject({
      createdBus: 2,
      createdLocations: 1,
      createdBrands: 2,
      createdItems: 6,
      filledFirmware: 1,
      insertedSerials: 7,
      insertedBuLinks: 8,
    });

    // Firmware: item baru lewat kolom (Mikrotik AC), kode tak sah tidak masuk kolom; item yang ada hanya diisi bila kosong.
    const firmware = async (id: string): Promise<string> =>
      String(
        (
          await env.DB.prepare('SELECT firmware FROM items WHERE id = ?')
            .bind(id)
            .first<{ firmware: string }>()
        )?.firmware,
      ).trim();
    const newItem = async (legacyId: number): Promise<string> =>
      String(resolved.createItems.find((i) => i.legacyId === legacyId)?.id);
    expect(await firmware(await newItem(3))).toBe('AC');
    expect(await firmware(await newItem(10))).toBe('');
    expect(await firmware(await newItem(11))).toBe('');
    expect(await firmware('it-nano')).toBe('M');
    expect(await firmware('it-loco')).toBe('XM');
    expect(await firmware('it-existing')).toBe('');

    expect(await count('serials')).toBe(7);
    expect(await count('serial_events')).toBe(result.insertedEvents);
    // Pencatatan stok TIDAK dipicu: tanpa stiker dan tanpa entri stok.
    expect(await count('serial_stickers')).toBe(0);
    expect(await count('sticker_stock_entries')).toBe(0);

    // Item yang sudah ada tidak berubah, tetapi tertaut ke BU Teakwave (ada serial Ubiquiti di sana).
    const after = await env.DB.prepare(
      'SELECT model, detail_md, updated_by FROM items WHERE id = ?',
    )
      .bind('it-existing')
      .first<{ model: string; detail_md: string; updated_by: string }>();
    expect(after).toEqual(before);
    const links = await env.DB.prepare(
      'SELECT bu_id FROM item_business_units WHERE item_id = ? ORDER BY bu_id',
    )
      .bind('it-existing')
      .all<{ bu_id: string }>();
    expect(links.results.map((r) => r.bu_id)).toHaveLength(2);

    // Merk baru: penghitung item dan BU bawaan terisi seperti jalur aplikasi.
    const mikrotik = await env.DB.prepare('SELECT id, item_count FROM brands WHERE `key` = ?')
      .bind('mikrotik')
      .first<{ id: string; item_count: number }>();
    expect(Number(mikrotik?.item_count)).toBe(2);
    const defaults = await env.DB.prepare(
      'SELECT b.name FROM brand_default_business_units d JOIN business_units b ON b.id = d.bu_id WHERE d.brand_id = ?',
    )
      .bind(mikrotik?.id)
      .all<{ name: string }>();
    expect(defaults.results.map((r) => r.name)).toEqual(['Teakwave']);

    // Serial 104 (hasil lipatan) terbaca lewat rute aplikasi dengan riwayat lama -> baru.
    const planned = plan().serials.find((s) => s.legacyId === 104);
    const got = (await restCall(env, VIEWER, 'serials.get', { id: planned?.id })) as {
      ok: boolean;
      data?: Json;
    };
    expect(got.ok).toBe(true);
    expect(got.data.serial).toMatchObject({
      serial: 'DUP12345X',
      buCode: 'SPC',
      locationName: 'Jakarta',
      itemLabel: 'Ubiquiti UAP AC Lite',
      status: 'good',
      custody: 'qc',
      createdBy: 'Johanes Desmon',
    });
    expect(got.data.events.map((e: Json) => e.type).sort()).toEqual([
      'note',
      'note',
      'note',
      'recorded',
    ]);
    expect(got.data.events.at(-1)).toMatchObject({
      seq: 1,
      type: 'recorded',
      actorName: 'Johanes Desmon',
    });

    // Serial dengan perubahan data: changes berlabel terbaca.
    const edited = plan().serials.find((s) => s.legacyId === 100);
    const detail = (await restCall(env, VIEWER, 'serials.get', { id: edited?.id })) as {
      data: Json;
    };
    const changed = detail.data.events.find((e: Json) => e.type === 'data_changed');
    expect(changed.changes[0]).toEqual({
      field: 'item',
      from: 'Ubiquiti UAP AC LR',
      to: 'Ubiquiti UAP AC Lite',
    });

    // Jejak audit migrasi.
    const audit = await env.DB.prepare(
      "SELECT actor FROM audit_log WHERE action = 'legacy.migration'",
    ).all<{ actor: string }>();
    expect(audit.results).toEqual([{ actor: 'migrasi-qc-lama' }]);
  });

  test('idempoten: putaran kedua tidak menulis apa pun (client_id deterministik)', async () => {
    await applyPlan(env.DB, resolvePlan(plan(), await loadTargetState(env.DB)), NOW);
    const serialsBefore = await count('serials');
    const eventsBefore = await count('serial_events');
    const itemsBefore = await count('items');
    const second = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(second.serials).toHaveLength(0);
    expect(second.alreadyMigrated).toBe(7);
    expect(second.createItems).toHaveLength(0);
    expect(second.firmwareFills).toHaveLength(0);
    expect(second.createBus).toHaveLength(0);
    await applyPlan(env.DB, second, NOW);
    expect(await count('serials')).toBe(serialsBefore);
    expect(await count('serial_events')).toBe(eventsBefore);
    expect(await count('items')).toBe(itemsBefore);
  });

  test('potongan besar: banyak serial dalam beberapa transaksi tetap utuh', async () => {
    const dump = miniDump();
    const rows = [];
    for (let i = 0; i < 400; i++) {
      rows.push([1000 + i, '2024-07-01', 3, `BULK${String(i).padStart(8, '0')}`, 0, '', 2, 2, 0]);
    }
    dump.dataqc = [...(dump.dataqc ?? []), ...rows];
    const big = buildPlan(dump, { itemBu: 'brand+serials', now: NOW });
    const resolved = resolvePlan(big, await loadTargetState(env.DB));
    const progress: number[] = [];
    await applyPlan(env.DB, resolved, NOW, (done) => progress.push(done));
    expect(await count('serials')).toBe(7 + 400);
    expect(progress.at(-1)).toBe(407);
    expect(progress.length).toBeGreaterThan(1);
    // Setiap serial punya tepat satu kejadian recorded sebagai seq 1.
    const bad = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serials s WHERE NOT EXISTS (SELECT 1 FROM serial_events e WHERE e.serial_id = s.id AND e.seq = 1 AND e.type = 'recorded')",
    ).first<{ n: number }>();
    expect(Number(bad?.n)).toBe(0);
  });
});

describe('serial unik se-sistem (riwayat BU)', () => {
  test('serial yang sama di dua BU lama ditulis SEKALI; kedua BU masuk serial_business_units', async () => {
    await applyPlan(env.DB, resolvePlan(plan(), await loadTargetState(env.DB)), NOW);
    const planned = plan().serials.find((s) => s.legacyId === 111);
    const rows = await env.DB.prepare(
      'SELECT s.bu_id AS current_bu, b.name AS bu, l.first_at, l.left_at FROM serials s JOIN serial_business_units l ON l.serial_id = s.id JOIN business_units b ON b.id = l.bu_id WHERE s.serial = ? ORDER BY l.first_at',
    )
      .bind('XBU123456789')
      .all<{ current_bu: string; bu: string; first_at: string; left_at: string }>();
    expect(rows.results.map((r) => [r.bu, r.first_at, r.left_at])).toEqual([
      ['Spectrum', '2024-02-01T01:00:00.000Z', '2024-06-01T02:00:00.000Z'],
      ['Teakwave', '2024-06-01T02:00:00.000Z', ''],
    ]);
    // BU saat ini (serials.bu_id) = BU baris tanpa left_at.
    const teakwave = await env.DB.prepare('SELECT id FROM business_units WHERE name = ?')
      .bind('Teakwave')
      .first<{ id: string }>();
    expect(rows.results[0]?.current_bu.trim()).toBe(teakwave?.id.trim());
    expect(planned?.buName).toBe('Teakwave');
  });

  test('tidak ada serial ganda di seluruh sistem dan tiap serial punya tepat satu baris BU saat ini', async () => {
    await applyPlan(env.DB, resolvePlan(plan(), await loadTargetState(env.DB)), NOW);
    const duplicates = await env.DB.prepare(
      'SELECT serial FROM serials GROUP BY serial HAVING COUNT(*) > 1',
    ).all();
    expect(duplicates.results).toEqual([]);
    const bad = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serials s WHERE (SELECT COUNT(*) FROM serial_business_units l WHERE l.serial_id = s.id AND l.left_at = '') <> 1 OR NOT EXISTS (SELECT 1 FROM serial_business_units l WHERE l.serial_id = s.id AND l.bu_id = s.bu_id AND l.left_at = '')",
    ).first<{ n: number }>();
    expect(Number(bad?.n)).toBe(0);
  });

  test('hasil akhir lolos ensureSerialUniqueIndex pada tujuan yang belum punya indeks unik', async () => {
    // Keadaan tujuan sebelum rilis unik: tanpa indeks, supaya tes menguji isi hasil (bukan penjaga indeks).
    await env.DB.prepare('DROP INDEX IF EXISTS serials_serial ON serials').run();
    await applyPlan(env.DB, resolvePlan(plan(), await loadTargetState(env.DB)), NOW);
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
  });

  test('serial yang sudah ada di tujuan di BU LAIN juga bentrok (bukan hanya BU yang sama)', async () => {
    // XBU123456789 sudah dicatat pengguna di Spectrum; rencana menempatkannya di Teakwave (BU catatan terbaru).
    await env.DB.prepare(
      "INSERT INTO serials (id, client_id, bu_id, serial, item_id) VALUES ('s-ada', 'c-ada', 'bu-spc', 'XBU123456789', 'it-existing')",
    ).run();
    const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
    expect(resolved.conflicts.map((c) => c.serial)).toEqual(['XBU123456789']);
    expect(resolved.serials.map((s) => s.legacyId)).not.toContain(111);
    await applyPlan(env.DB, resolved, NOW);
    expect(await count('serials')).toBe(1 + 6);
  });

  test('tanpa tabel serial_business_units di tujuan: hambatan, penerapan ditolak, tidak menulis apa pun', async () => {
    // Diganti nama (bukan dihapus) lalu dikembalikan: skema tes dipakai bersama berkas lain di proses yang sama, jadi
    // definisi tabel dari migrasi 0026 tak boleh berubah.
    await env.DB.prepare('RENAME TABLE serial_business_units TO serial_business_units_off').run();
    try {
      const resolved = resolvePlan(plan(), await loadTargetState(env.DB));
      expect(resolved.blockers.join('\n')).toContain('serial_business_units belum ada');
      await expect(applyPlan(env.DB, resolved, NOW)).rejects.toThrow('Penerapan dibatalkan');
      expect(await count('serials')).toBe(0);
      expect(await count('business_units')).toBe(1);
      // Rencana tanpa serial tak membutuhkan tabel itu.
      const dump = miniDump();
      dump.dataqc = [];
      const withoutSerials = resolvePlan(
        buildPlan(dump, { itemBu: 'brand', now: NOW }),
        await loadTargetState(env.DB),
      );
      expect(withoutSerials.blockers).toEqual([]);
    } finally {
      await env.DB.prepare('RENAME TABLE serial_business_units_off TO serial_business_units').run();
    }
  });
});
