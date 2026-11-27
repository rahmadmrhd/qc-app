import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeAudit } from '@server/core/audit';
import { insertReportStmt } from '@server/modules/dashboard/report/repo';
import { insertShareStmt } from '@server/modules/dashboard/share-repo';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { ENV as HANDOVER_ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { seedBrand, seedCustomer, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { seedQrDesign, seedQrPreset } from '@server-test/qrcode-env';
import { restCall } from '@server-test/rest-call';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { ACTIVITY_KINDS, type ActivityKind } from '@shared/audit';
import { changedFieldsOf } from './service';

// Riwayat aktivitas satu record (`activity.list`): entri audit ber-`target_id` record itu, terbaru dahulu, TANPA nilai
// sebelum/sesudah, dengan izin baca yang sama dengan rute `get` tiap model (record tak terbaca = NOT_FOUND seragam).

let env: TestEnv;
const realError = console.error;

const ADMIN = 'admin@gmail.com';
const ITEM_VIEWER = 'itemview@gmail.com';
const ITEM_VIEWER_BU_B = 'itemview-bub@gmail.com';
const ITEM_MANAGER = 'itemmanage@gmail.com';
const NOBODY = 'nobody@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

async function call(email: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, email, 'activity.list', input)) as CallOut;
}

async function audit(
  kind: ActivityKind,
  targetId: string,
  action: string,
  options: { before?: unknown; after?: unknown; ts?: string; actor?: string } = {},
): Promise<void> {
  await writeAudit(env.DB, {
    actor: options.actor ?? 'seed@gmail.com',
    action,
    target: `${kind}:${targetId}`,
    targetId,
    ...(options.ts ? { ts: options.ts } : {}),
    before: options.before ?? null,
    after: options.after ?? null,
  }).run();
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-22T03:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'BBB' });
  await seedRole(env, { id: 'r-iv', name: 'Item view', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-im', name: 'Item manage', permissions: { item: 'manage' } });
  await seedRole(env, { id: 'r-sv', name: 'Sticker view', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-qv', name: 'QR view', permissions: { qrcode: 'view' } });
  await seedRole(env, { id: 'r-av', name: 'Access view', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u-iv', email: ITEM_VIEWER, roleIds: ['r-iv'] });
  await seedUser(env, {
    id: 'u-ivb',
    email: ITEM_VIEWER_BU_B,
    assignments: [{ locationId: null, roleIds: ['r-iv'] }],
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-iv'] }],
  });
  await seedUser(env, { id: 'u-im', email: ITEM_MANAGER, roleIds: ['r-im'] });
  await seedUser(env, { id: 'u-nobody', email: NOBODY });
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400', businessUnitIds: ['bu-a'] });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

describe('activity.list: bentuk keluaran', () => {
  test('terbaru dahulu, DTO tanpa before/after, changedFields hanya NAMA field yang berubah', async () => {
    await audit('item', 'i1', 'item.create', {
      ts: '2026-11-21T01:00:00.000Z',
      after: { model: 'M5-400', brand: 'PBE', secret: 'RAHASIA-BARU' },
    });
    await audit('item', 'i1', 'item.update', {
      ts: '2026-11-21T02:00:00.000Z',
      actor: 'editor@gmail.com',
      before: { model: 'M5-400', brand: 'PBE', secret: 'RAHASIA-LAMA' },
      after: { model: 'M5-401', brand: 'PBE', secret: 'RAHASIA-BARU' },
    });
    const result = await call(ITEM_VIEWER, { kind: 'item', id: 'i1' });
    expect(result.ok).toBe(true);
    const page = result.data as Json;
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.entries.map((entry: Json) => entry.action)).toEqual(['item.update', 'item.create']);
    const [update, create] = page.entries as Json[];
    expect(update.actor).toBe('editor@gmail.com');
    expect(update.ts).toBe('2026-11-21T02:00:00.000Z');
    expect(update.changedFields).toEqual(['model', 'secret']);
    expect(create.changedFields).toEqual(['model', 'brand', 'secret']);
    for (const entry of page.entries as Json[]) {
      expect(Object.keys(entry).sort()).not.toContain('before');
      expect(Object.keys(entry).sort()).not.toContain('after');
      expect(Object.keys(entry).sort()).not.toContain('target');
    }
    const text = JSON.stringify(page);
    expect(text).not.toContain('RAHASIA');
    expect(text).not.toContain('M5-401');
  });

  test('kursor halaman (limit 2 dari 3 entri) bersambung tanpa tumpang tindih; hasMore menyala', async () => {
    for (const [index, action] of ['item.create', 'item.update', 'item.deactivate'].entries()) {
      await audit('item', 'i1', action, { ts: `2026-11-21T0${index + 1}:00:00.000Z` });
    }
    const first = (await call(ITEM_VIEWER, { kind: 'item', id: 'i1', limit: 2 })).data as Json;
    expect(first.entries.map((e: Json) => e.action)).toEqual(['item.deactivate', 'item.update']);
    expect(first.hasMore).toBe(true);
    expect(typeof first.nextCursor).toBe('string');
    const second = (
      await call(ITEM_VIEWER, { kind: 'item', id: 'i1', limit: 2, cursor: first.nextCursor })
    ).data as Json;
    expect(second.entries.map((e: Json) => e.action)).toEqual(['item.create']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  test('limit bawaan 10; entri record lain dan kind lain dengan id sama tidak ikut', async () => {
    for (let index = 0; index < 12; index += 1) {
      await audit('item', 'i1', 'item.update', {
        ts: `2026-11-21T00:${String(index).padStart(2, '0')}:00.000Z`,
      });
    }
    await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200', businessUnitIds: ['bu-a'] });
    await audit('item', 'i2', 'item.update', { after: { model: 'LAIN' } });
    // Aksi berjenis lain dengan target_id yang sama (bukan entitas ini) dilewati.
    await audit('brand', 'i1', 'brand.update', { after: { name: 'BRAND-LAIN' } });
    const page = (await call(ITEM_VIEWER, { kind: 'item', id: 'i1' })).data as Json;
    expect(page.entries).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(JSON.stringify(page)).not.toContain('brand.update');
    const all = (await call(ITEM_VIEWER, { kind: 'item', id: 'i1', limit: 50 })).data as Json;
    expect(all.entries).toHaveLength(12);
    expect(all.hasMore).toBe(false);
  });

  test('entri lama tanpa target_id tidak punya riwayat; record tanpa entri = halaman kosong', async () => {
    await writeAudit(env.DB, {
      actor: 'seed@gmail.com',
      action: 'item.update',
      target: 'PBE M5-400',
      before: { model: 'a' },
      after: { model: 'b' },
    }).run();
    const page = (await call(ITEM_VIEWER, { kind: 'item', id: 'i1' })).data as Json;
    expect(page).toEqual({ entries: [], nextCursor: null, hasMore: false });
  });
});

describe('changedFieldsOf', () => {
  test('create dan delete = semua kunci sisi yang ada; sama = tiada; rusak/null = tiada', () => {
    expect(changedFieldsOf('null', '{"a":1,"b":2}')).toEqual(['a', 'b']);
    expect(changedFieldsOf('{"a":1,"b":2}', 'null')).toEqual(['a', 'b']);
    expect(changedFieldsOf('{"a":1,"b":[1,2]}', '{"a":1,"b":[1,2]}')).toBeUndefined();
    expect(changedFieldsOf('{"a":1,"b":[1,2]}', '{"a":1,"b":[1,3]}')).toEqual(['b']);
    expect(changedFieldsOf('{"a":1}', '{"a":1,"c":0}')).toEqual(['c']);
    expect(changedFieldsOf('null', 'null')).toBeUndefined();
    expect(changedFieldsOf('bukan json', '{broken')).toBeUndefined();
    expect(changedFieldsOf('[1,2]', '"teks"')).toBeUndefined();
    expect(changedFieldsOf('bukan json', '{"a":1}')).toEqual(['a']);
  });
});

describe('activity.list: validasi', () => {
  test('kind serial, kind tak dikenal, kind/id kosong, limit dan kursor tak sah = VALIDATION', async () => {
    const bad: unknown[] = [
      { kind: 'serial', id: 'i1' },
      { kind: 'bogus', id: 'i1' },
      { id: 'i1' },
      { kind: 'item' },
      { kind: 'item', id: '' },
      { kind: 'item', id: 'i1', limit: 0 },
      { kind: 'item', id: 'i1', limit: 51 },
      { kind: 'item', id: 'i1', cursor: 'tanpa-pemisah' },
    ];
    for (const input of bad) {
      const result = await call(ADMIN, input);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION');
    }
  });
});

describe('activity.list: otorisasi item', () => {
  beforeEach(async () => {
    await audit('item', 'i1', 'item.update', { before: { model: 'a' }, after: { model: 'b' } });
  });

  test('pembaca BU item dan admin sah; BU lain dan id tak dikenal = NOT_FOUND dengan pesan sama; tanpa izin = FORBIDDEN', async () => {
    expect((await call(ITEM_VIEWER, { kind: 'item', id: 'i1' })).ok).toBe(true);
    expect((await call(ADMIN, { kind: 'item', id: 'i1' })).ok).toBe(true);
    const otherBu = await call(ITEM_VIEWER_BU_B, { kind: 'item', id: 'i1' });
    const unknown = await call(ITEM_VIEWER, { kind: 'item', id: 'tak-ada' });
    expect(otherBu.ok).toBe(false);
    expect(otherBu.error.code).toBe('NOT_FOUND');
    expect(unknown.error.code).toBe('NOT_FOUND');
    expect(otherBu.error.message).toBe(unknown.error.message);
    const nobody = await call(NOBODY, { kind: 'item', id: 'i1' });
    expect(nobody.error.code).toBe('FORBIDDEN');
  });

  test('item terhapus hanya bagi item manage; item multi-BU terbaca bila beririsan dengan BU terlihat', async () => {
    await env.DB.prepare("UPDATE items SET deleted_at = ?, deleted_by = 'x' WHERE id = 'i1'")
      .bind('2026-11-22T01:00:00.000Z')
      .run();
    expect((await call(ITEM_VIEWER, { kind: 'item', id: 'i1' })).error.code).toBe('NOT_FOUND');
    expect((await call(ITEM_MANAGER, { kind: 'item', id: 'i1' })).ok).toBe(true);
    await seedItem(env, {
      id: 'i-multi',
      brand: 'PBE',
      model: 'MULTI',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    await audit('item', 'i-multi', 'item.update', { after: { model: 'x' } });
    expect((await call(ITEM_VIEWER_BU_B, { kind: 'item', id: 'i-multi' })).ok).toBe(true);
  });
});

describe('activity.list: tiap kind memakai gerbang baca model-nya', () => {
  const READ_ROLES: Record<string, string> = {
    'sticker-view': 'stickerview@gmail.com',
    'qr-view': 'qrview@gmail.com',
    'access-view': 'accessview@gmail.com',
    'dashboard-manage': 'dashmanage@gmail.com',
  };

  /** Record uji per kind: id, aksi audit, dan pembaca sah (selain admin). */
  let records: Array<{ kind: ActivityKind; id: string; action: string; reader: string }>;

  beforeEach(async () => {
    await seedUser(env, {
      id: 'u-sv',
      email: READ_ROLES['sticker-view'] as string,
      roleIds: ['r-sv'],
    });
    await seedUser(env, { id: 'u-qv', email: READ_ROLES['qr-view'] as string, roleIds: ['r-qv'] });
    await seedUser(env, {
      id: 'u-av',
      email: READ_ROLES['access-view'] as string,
      roleIds: ['r-av'],
    });
    await seedRole(env, {
      id: 'r-dm',
      name: 'Dashboard manage',
      permissions: { dashboard: 'manage' },
    });
    await seedUser(env, {
      id: 'u-dm',
      email: READ_ROLES['dashboard-manage'] as string,
      roleIds: ['r-dm'],
    });
    await insertShareStmt(env.DB, {
      id: 'ds1',
      title: 'Ringkasan',
      created_by: ADMIN,
      created_at: '2026-11-22T01:00:00.000Z',
      expires_at: '2026-12-22T01:00:00.000Z',
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: '',
    }).run();
    await insertReportStmt(env.DB, {
      id: 'dr1',
      name: 'Laporan mingguan',
      owner: ADMIN,
      enabled: 1,
      schedule: '{"frequency":"weekly","hour":8,"weekday":1,"monthDay":1}',
      period: 'lastWeek',
      scope: '{}',
      recipients: '[]',
      cc: '[]',
      bcc: '[]',
      link_days: 14,
      last_run_key: '',
      last_run_at: '',
      last_status: '',
      last_note: '',
      created_at: '2026-11-22T01:00:00.000Z',
      updated_at: '2026-11-22T01:00:00.000Z',
      version: 1,
    }).run();
    await seedCustomer(env, { id: 'c1', name: 'PT Maju' });
    await seedStickerType(env, { id: 'st1' });
    await seedSticker(env, { id: 'sk1', typeId: 'st1', buIds: ['bu-a'] });
    await seedQrPreset(env, { id: 'qp1' });
    await seedQrDesign(env, { id: 'qd1' });
    const postelId = await seedPostel(env, { id: 'po1', numbers: [] });
    await seedHandoverEnv(env);
    await seedHandover(env, { id: 'h1', number: 'ST-20261122-001', locationId: HANDOVER_ENV.locA });
    await seedLocation(env, { id: 'l-x', code: 'LX' });
    records = [
      { kind: 'brand', id: 'brand-pbe', action: 'brand.update', reader: ITEM_VIEWER },
      { kind: 'customer', id: 'c1', action: 'customer.rename', reader: ITEM_VIEWER },
      {
        kind: 'stickerType',
        id: 'st1',
        action: 'stickerType.update',
        reader: READ_ROLES['sticker-view'] as string,
      },
      {
        kind: 'sticker',
        id: 'sk1',
        action: 'sticker.update',
        reader: READ_ROLES['sticker-view'] as string,
      },
      {
        kind: 'qrPreset',
        id: 'qp1',
        action: 'qrcode.preset_update',
        reader: READ_ROLES['qr-view'] as string,
      },
      {
        kind: 'qrDesign',
        id: 'qd1',
        action: 'qrcode.update',
        reader: READ_ROLES['qr-view'] as string,
      },
      {
        kind: 'postel',
        id: postelId,
        action: 'postel.update',
        reader: READ_ROLES['sticker-view'] as string,
      },
      {
        kind: 'user',
        id: 'u-iv',
        action: 'user.update',
        reader: READ_ROLES['access-view'] as string,
      },
      {
        kind: 'role',
        id: 'r-iv',
        action: 'role.update',
        reader: READ_ROLES['access-view'] as string,
      },
      {
        kind: 'location',
        id: 'l-x',
        action: 'location.update',
        reader: READ_ROLES['access-view'] as string,
      },
      {
        kind: 'businessUnit',
        id: 'bu-a',
        action: 'businessunit.update',
        reader: READ_ROLES['access-view'] as string,
      },
      { kind: 'handover', id: 'h1', action: 'handover.check', reader: 'viewer@gmail.com' },
      {
        kind: 'dashboardShare',
        id: 'ds1',
        action: 'dashboard.share_create',
        reader: READ_ROLES['dashboard-manage'] as string,
      },
      {
        kind: 'dashboardReport',
        id: 'dr1',
        action: 'dashboard.report_update',
        reader: READ_ROLES['dashboard-manage'] as string,
      },
    ];
    for (const record of records) {
      await audit(record.kind, record.id, record.action, { after: { name: 'baru' } });
    }
  });

  test('semua kind selain item tercakup tabel uji', () => {
    // `warehouseOrder` diuji di serialwh/orders.test.ts (gerbangnya = BU SO ber-`serialwh: view`, bukan izin modul).
    const covered = new Set<ActivityKind>([
      'item',
      'warehouseOrder',
      ...records.map((record) => record.kind),
    ]);
    expect([...covered].sort()).toEqual([...ACTIVITY_KINDS].sort());
  });

  test('pembaca sah dan admin lolos; pengguna tanpa izin ditolak; id tak dikenal NOT_FOUND', async () => {
    for (const record of records) {
      const label = `${record.kind}`;
      const admin = await call(ADMIN, { kind: record.kind, id: record.id });
      expect([label, admin.ok]).toEqual([label, true]);
      expect([label, admin.data.entries.length]).toEqual([label, 1]);
      const reader = await call(record.reader, { kind: record.kind, id: record.id });
      expect([label, reader.ok]).toEqual([label, true]);
      const denied = await call(NOBODY, { kind: record.kind, id: record.id });
      expect([label, denied.ok]).toEqual([label, false]);
      expect(['FORBIDDEN', 'NOT_FOUND']).toContain(denied.error.code);
      const missing = await call(record.reader, { kind: record.kind, id: 'tak-ada' });
      expect([label, missing.error?.code]).toEqual([label, 'NOT_FOUND']);
    }
  });

  test('handover: lokasi lain dan peran tanpa izin baca = NOT_FOUND; terhapus hanya bagi handover manage lokasi itu', async () => {
    // noaccess@ hanya item view; qc@ (qc edit) boleh membaca di loc-a; wh@ manage di loc-a.
    expect((await call('noaccess@gmail.com', { kind: 'handover', id: 'h1' })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call('qc@gmail.com', { kind: 'handover', id: 'h1' })).ok).toBe(true);
    await seedHandover(env, {
      id: 'h-b',
      number: 'ST-20261122-002',
      locationId: HANDOVER_ENV.locB,
    });
    await audit('handover', 'h-b', 'handover.check', { after: { x: 1 } });
    // viewer@ hanya di loc-a: task di loc-b seperti tak ada.
    expect((await call('viewer@gmail.com', { kind: 'handover', id: 'h-b' })).error.code).toBe(
      'NOT_FOUND',
    );
    await env.DB.prepare("UPDATE handovers SET deleted_at = ?, deleted_by = 'x' WHERE id = 'h1'")
      .bind('2026-11-22T01:00:00.000Z')
      .run();
    expect((await call('viewer@gmail.com', { kind: 'handover', id: 'h1' })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call('wh@gmail.com', { kind: 'handover', id: 'h1' })).ok).toBe(true);
  });

  test('record terhapus (mis. pengguna) hanya terbaca bagi access manage; selain itu NOT_FOUND', async () => {
    await env.DB.prepare("UPDATE users SET deleted_at = ?, deleted_by = 'x' WHERE id = 'u-iv'")
      .bind('2026-11-22T01:00:00.000Z')
      .run();
    expect(
      (await call(READ_ROLES['access-view'] as string, { kind: 'user', id: 'u-iv' })).error.code,
    ).toBe('NOT_FOUND');
    expect((await call(ADMIN, { kind: 'user', id: 'u-iv' })).ok).toBe(true);
  });

  test('DTO tiap kind tidak memuat before/after/target', async () => {
    for (const record of records) {
      const page = (await call(ADMIN, { kind: record.kind, id: record.id })).data as Json;
      const entry = page.entries[0] as Json;
      expect(Object.keys(entry).sort()).toEqual(['action', 'actor', 'changedFields', 'id', 'ts']);
      expect(entry.changedFields).toEqual(['name']);
    }
  });
});
