import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { locateAnchor, noteToPlainText } from '@shared/handover-comments';
import { ENV, rpc, seedHandover, seedHandoverEnv } from '@worker-test/handover-env';
import { seedCustomer } from '@worker-test/item-fixtures';
import { measureCpu } from '@worker-test/measure';
import { d1StatsOf } from '@worker-test/sqlite-d1';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { derivedColumns, parseChecks } from './repo';
import { fitAuditSnapshots, handoverSnapshot } from './service';

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await rpc(env, email, method, payload)) as Result;
const ref = { id: 't1', locationId: ENV.locA };
const save = (payload: Record<string, unknown>, email = 'wh@gmail.com') =>
  call(email, 'handovers.save', { locationId: ENV.locA, customerName: '', note: '', ...payload });
const setCheck = (index: number, text: string, checked: boolean, email = 'qc@gmail.com') =>
  call(email, 'handovers.setCheck', { ...ref, index, text, checked });
const setDone = (email = 'qc@gmail.com') => call(email, 'handovers.setDone', ref);
const comment = (
  quote: string,
  body = 'Catatan',
  context: { before?: string; after?: string } = {},
  email = 'viewer@gmail.com',
) =>
  call(email, 'handovers.comment', {
    ...ref,
    quote,
    before: context.before ?? '',
    after: context.after ?? '',
    body,
  });

interface AuditRow {
  action: string;
  actor: string;
  target: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
async function auditRows(): Promise<AuditRow[]> {
  const rows = await env.DB.prepare(
    'SELECT action, actor, target, "before" AS before, "after" AS after FROM audit_log ORDER BY id',
  ).all<{ action: string; actor: string; target: string; before: string; after: string }>();
  return rows.results.map((r) => ({
    action: r.action,
    actor: r.actor,
    target: r.target,
    before: JSON.parse(r.before) as Record<string, unknown> | null,
    after: JSON.parse(r.after) as Record<string, unknown> | null,
  }));
}
const audits = async () => (await auditRows()).map((r) => r.action);

interface TaskRow {
  id: string;
  number: string;
  note: string;
  checks: string;
  status: string;
  completed_at: string;
  version: number;
  updated_at: string;
  checked_count: number;
  total_count: number;
  board_status: string;
}
async function taskRows(): Promise<TaskRow[]> {
  return (await env.DB.prepare('SELECT * FROM handovers ORDER BY number').all<TaskRow>()).results;
}
async function task(id = 't1'): Promise<TaskRow> {
  const row = (await taskRows()).find((r) => r.id === id);
  if (!row) throw new Error(`task ${id} tidak ada`);
  return row;
}
const checksOf = async (id = 't1') => parseChecks((await task(id)).checks);
const commentsOf = async (id = 't1') =>
  (
    await env.DB.prepare('SELECT * FROM handover_comments WHERE handover_id = ? ORDER BY rowid')
      .bind(id)
      .all<{ body: string }>()
  ).results;

const checkA = { text: 'A', by: 'qc@gmail.com', at: '2026-10-15T02:00:00.000Z', occurrence: 0 };

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
  await seedHandoverEnv(env);
});

/** Invarian Review: kolom turunan SELALU konsisten dengan isi task, apa pun operasinya. */
afterEach(async () => {
  for (const row of await taskRows()) {
    const d = derivedColumns({
      note: row.note,
      checks: parseChecks(row.checks),
      status: row.status === 'cancelled' ? 'cancelled' : 'open',
      completedAt: row.completed_at,
    });
    expect({
      number: row.number,
      checked: row.checked_count,
      total: row.total_count,
      board: row.board_status,
    }).toEqual({
      number: row.number,
      checked: d.checkedCount,
      total: d.totalCount,
      board: d.boardStatus,
    });
  }
});

describe('simpan', () => {
  test('membuat task bernomor ST-YYYYMMDD-001 tanpa customer; catatan 5.000 karakter diterima, 5.001 ditolak', async () => {
    const ok = await save({ note: 'a'.repeat(5000) });
    expect(ok.ok).toBe(true);
    expect(ok.data).toMatchObject({
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      status: 'new',
      createdBy: 'wh@gmail.com',
    });
    expect(await audits()).toEqual(['handover.create']);
    const bad = await save({ note: 'a'.repeat(5001) });
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe('VALIDATION');
    expect(bad.error.fields.note).toBeDefined();
    expect((await save({ note: 'x' })).data.number).toBe('ST-20261015-002');
  });

  test('nomor memakai tanggal WIB (UTC+7)', async () => {
    env.clock.set(Date.parse('2026-10-15T20:00:00.000Z')); // 16 Okt 03:00 WIB
    expect((await save({ note: 'x' })).data.number).toBe('ST-20261016-001');
  });

  test('save dengan customer baru membuatnya dan mencatat audit customer.create sebelum handover.create', async () => {
    const out = await save({ customerName: 'PT Baru', note: '- [ ] A = 1' });
    expect(out.data.customerName).toBe('PT Baru');
    expect(await audits()).toEqual(['customer.create', 'handover.create']);
  });

  test('save menormalkan "- [x]" menjadi tidak tercentang', async () => {
    const out = await save({ note: '- [x] A = 1\n- [X] B = 2' });
    expect(out.data.note).toBe('- [ ] A = 1\n- [ ] B = 2');
    expect(out.data.checklist.every((c: { checked: boolean }) => !c.checked)).toBe(true);
    expect(out.data.status).toBe('new');
  });

  test('mengubah catatan: urutan ulang mempertahankan centang; edit butir tercentang mereset dan masuk audit', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A\n- [ ] B',
      checks: [checkA],
    });
    const reordered = await save({ id: 't1', note: '- [ ] B\n- [ ] A' });
    expect(reordered.ok).toBe(true);
    expect(reordered.data.checklist).toEqual([
      { index: 0, text: 'B', checked: false, by: '', at: '' },
      { index: 1, text: 'A', checked: true, by: 'qc@gmail.com', at: checkA.at },
    ]);
    env.clock.advance(1000);
    const edited = await save({ id: 't1', note: '- [ ] B\n- [ ] A2' });
    expect(edited.ok).toBe(true);
    expect(edited.data.checklist.every((c: { checked: boolean }) => !c.checked)).toBe(true);
    expect(edited.data.status).toBe('new');
    const audit = (await auditRows()).at(-1);
    expect(audit?.action).toBe('handover.update');
    expect(audit?.after).toMatchObject({ resets: ['A → A2'] });
    expect(audit?.before).toMatchObject({ checked: ['A'], note: '- [ ] B\n- [ ] A' });
  });

  test('menghapus atau mengubah butir tercentang menjadi paragraf ditolak VALIDATION', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A\n- [ ] B',
      checks: [checkA],
    });
    const removed = await save({ id: 't1', note: '- [ ] B' });
    expect(removed.error.code).toBe('VALIDATION');
    expect(removed.error.fields.note).toContain('A');
    expect((await save({ id: 't1', note: 'A\n- [ ] B' })).error.code).toBe('VALIDATION');
    expect((await task()).note).toBe('- [ ] A\n- [ ] B');
    expect(await checksOf()).toHaveLength(1);
  });

  test('butir kembar; menyunting kemunculan kedua tidak menyentuh centang pertama', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] X\n- [ ] X',
      checks: [{ ...checkA, text: 'X' }],
    });
    const out = await save({ id: 't1', note: '- [ ] X\n- [ ] Y' });
    expect(out.data.checklist.map((c: { checked: boolean }) => c.checked)).toEqual([true, false]);
  });

  test('tanpa perubahan tidak menulis audit dan tidak mengubah updatedAt/version', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A',
    });
    const out = await save({ id: 't1', note: '- [ ] A' });
    expect(out.ok).toBe(true);
    expect(out.data.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await audits()).toEqual([]);
    expect((await task()).version).toBe(1);
  });

  test('expectedUpdatedAt basi -> CONFLICT; cocok -> tersimpan', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A',
    });
    const out = await save({
      id: 't1',
      note: '- [ ] B',
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(out.error.code).toBe('CONFLICT');
    expect(
      (await save({ id: 't1', note: '- [ ] B', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })).ok,
    ).toBe(true);
  });

  test('pada task Dibatalkan ditolak; id di lokasi lain NOT_FOUND; izin', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A',
      status: 'cancelled',
    });
    expect((await save({ id: 't1', note: '- [ ] B' })).error.code).toBe('CONFLICT');
    await seedHandover(env, {
      id: 't5',
      number: 'ST-20261015-005',
      locationId: ENV.locB,
      customerId: '',
      customerName: '',
      note: '- [ ] A',
    });
    expect((await save({ id: 't5', note: 'x' })).error.code).toBe('NOT_FOUND');
    expect((await save({ note: 'x' }, 'qc@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await save({ note: 'x' }, 'viewer@gmail.com')).error.code).toBe('FORBIDDEN');
  });

  test('karakter kontrol ditolak sebelum menulis apa pun; catatan kosong dan > 300 butir ditolak', async () => {
    const control = await save({ note: `- [ ] ${String.fromCharCode(1).repeat(4000)}` });
    expect(control.error.fields.note).toBeDefined();
    expect((await save({ note: '   ' })).error.fields.note).toBeDefined();
    const many = await save({ note: Array.from({ length: 301 }, () => '- [ ] a').join('\n') });
    expect(many.error.fields.note).toContain('300');
    expect(await taskRows()).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  test('catatan mentah lalu tersimpan ter-escape dengan suntingan lain, centang tetap (C1)', async () => {
    const created = await save({ note: '- [ ] RB_5009 = 1\n- [ ] Kabel & konektor' });
    expect(created.ok).toBe(true);
    const id = created.data.id as string;
    env.clock.advance(1000);
    expect(
      (
        await call('qc@gmail.com', 'handovers.setCheck', {
          id,
          locationId: ENV.locA,
          index: 0,
          text: created.data.checklist[0].text,
          checked: true,
        })
      ).ok,
    ).toBe(true);
    env.clock.advance(1000);
    const edited = await save({
      id,
      note: '- [ ] RB_5009 = 1\n- [ ] Kabel & konektor\n- [ ] Baru',
    });
    expect(edited.ok).toBe(true);
    expect(edited.data.checklist[0].checked).toBe(true);
  });

  test('reset centang selalu menghasilkan audit handover.update', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] RD = 8',
    });
    await setCheck(0, 'RD = 8', true);
    env.clock.advance(1000);
    const saved = await save({ id: 't1', note: '- [ ] RD = 9' });
    expect(saved.ok).toBe(true);
    const audit = (await auditRows()).find((r) => r.action === 'handover.update');
    expect(audit?.after?.resets).toEqual(['RD = 8 → RD = 9']);
  });

  test('audit create memuat catatan penuh bila muat; audit centang tidak memuat note', async () => {
    const body = `- [ ] A = 1\n\n${'z'.repeat(4000)}`;
    const created = await save({ note: body });
    expect(created.ok).toBe(true);
    const rows = await auditRows();
    expect(rows.find((r) => r.action === 'handover.create')?.after?.note).toBe(body);
    env.clock.advance(1000);
    await call('qc@gmail.com', 'handovers.setCheck', {
      id: created.data.id,
      locationId: ENV.locA,
      index: 0,
      text: 'A = 1',
      checked: true,
    });
    const check = (await auditRows()).find((r) => r.action === 'handover.check');
    expect(Object.keys(check?.after ?? {})).not.toContain('note');
    expect(Object.keys(check?.before ?? {})).not.toContain('note');
  });

  test('fitAuditSnapshots: catatan dipotong dengan penanda; tidak muat sama sekali -> VALIDATION', () => {
    const record = {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: 'n'.repeat(5000),
      status: 'open' as const,
      checks: [],
      completedAt: '',
      completedBy: '',
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
      version: 1,
    };
    const names = new Map<string, string>();
    const cuma = fitAuditSnapshots(
      (limit) => ({
        before: null,
        after: { ...handoverSnapshot(record, '', names, limit), pad: 'p'.repeat(39000) },
      }),
      true,
    );
    expect(String(cuma.after.note)).toContain('(dipotong)');
    expect(JSON.stringify(cuma.after).length).toBeLessThanOrEqual(40000);
    expect(() =>
      fitAuditSnapshots(() => ({ before: null, after: { pad: 'p'.repeat(41000) } }), true),
    ).toThrow();
  });
});

describe('saveBatch', () => {
  const batch = (tasks: unknown, email = 'wh@gmail.com') =>
    call(email, 'handovers.saveBatch', { locationId: ENV.locA, tasks });

  test('menyimpan 3 task dengan nomor 001..003 dan satu customer baru untuk nama yang sama (customerKey)', async () => {
    const out = await batch([
      { customerName: 'CV. Prisma', note: '- [ ] A = 1' },
      { customerName: 'CV Prisma', note: '- [ ] B = 2' },
      { customerName: '', note: 'tanpa customer' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.data.map((t: { number: string }) => t.number)).toEqual([
      'ST-20261015-001',
      'ST-20261015-002',
      'ST-20261015-003',
    ]);
    const customers = await env.DB.prepare(
      "SELECT id FROM customers WHERE key = 'cv prisma'",
    ).all();
    expect(customers.results).toHaveLength(1);
    expect(out.data[0].customerId).toBe(out.data[1].customerId);
    expect(out.data[0].customerName).toBe('CV. Prisma');
    expect(out.data[1].customerName).toBe('CV. Prisma');
    expect(out.data[2].customerId).toBe('');
    expect(await taskRows()).toHaveLength(3);
  });

  test('satu task tidak valid -> tidak ada task, tidak ada customer baru, nomor berikutnya tetap 001', async () => {
    await seedCustomer(env, { id: 'c-off', name: 'Nonaktif', key: 'nonaktif', status: 'inactive' });
    const before = (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>()
    )?.n;
    const tooLong = await batch([
      { customerName: 'Baru Satu', note: 'ok' },
      { customerName: 'Baru Dua', note: 'a'.repeat(5001) },
    ]);
    expect(tooLong.error.code).toBe('VALIDATION');
    expect(tooLong.error.fields.tasks).toContain('Task 2');
    const inactive = await batch([
      { customerName: 'Baru Satu', note: 'ok' },
      { customerName: 'Nonaktif', note: 'ok' },
    ]);
    expect(inactive.error.fields.tasks).toContain('Task 2');
    expect(await taskRows()).toHaveLength(0);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>())?.n,
    ).toBe(before);
    expect(await audits()).toEqual([]);
    expect((await save({ note: 'x' })).data.number).toBe('ST-20261015-001');
  });

  test('kegagalan di tengah batch (D1) membatalkan semuanya: tidak ada task/customer/nomor/audit', async () => {
    // Task ke-2 melanggar CHECK status melalui nomor ganda yang sengaja dipaksa: sisipkan lebih dulu nomor 002.
    await env.DB.prepare(
      "INSERT INTO handovers (id, number, location_id) VALUES ('pre', 'ST-20261015-002', ?)",
    )
      .bind(ENV.locB)
      .run();
    await env.DB.prepare("INSERT INTO counters (key, value) VALUES ('st:20261015', 0)").run();
    const out = await batch([
      { customerName: 'PT Satu', note: 'a' },
      { customerName: 'PT Dua', note: 'b' },
      { customerName: 'PT Tiga', note: 'c' },
    ]);
    expect(out.ok).toBe(false);
    expect((await taskRows()).map((r) => r.id)).toEqual(['pre']);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>())?.n,
    ).toBe(0);
    expect(await audits()).toEqual([]);
    expect(
      (
        await env.DB.prepare("SELECT value FROM counters WHERE key = 'st:20261015'").first<{
          value: number;
        }>()
      )?.value,
    ).toBe(0);
  });

  test('melanjutkan nomor dari task yang sudah ada (mis. hasil impor tanpa penghitung)', async () => {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-007',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
    });
    const out = await batch([
      { customerName: '', note: 'a' },
      { customerName: '', note: 'b' },
    ]);
    expect(out.data.map((t: { number: string }) => t.number)).toEqual([
      'ST-20261015-008',
      'ST-20261015-009',
    ]);
  });

  test('11 task ditolak (batas Worker 10); kosong ditolak; 10 task diterima dalam satu batch; QC tanpa edit FORBIDDEN', async () => {
    const tasks = Array.from({ length: 11 }, (_, i) => ({ customerName: `PT ${i}`, note: 'x' }));
    expect((await batch(tasks)).error.code).toBe('VALIDATION');
    expect((await batch([])).error.code).toBe('VALIDATION');
    const ok = await batch(tasks.slice(0, 10));
    expect(ok.data).toHaveLength(10);
    expect(new Set(ok.data.map((t: { number: string }) => t.number)).size).toBe(10);
    expect((await batch([{ customerName: '', note: 'x' }], 'qc@gmail.com')).error.code).toBe(
      'FORBIDDEN',
    );
  });

  test('audit handover.create per task dengan target nomor', async () => {
    await batch([
      { customerName: 'PT Satu', note: '- [ ] A = 1' },
      { customerName: 'PT Dua', note: '- [ ] B = 1' },
    ]);
    const rows = await auditRows();
    expect(rows.filter((r) => r.action === 'handover.create')).toHaveLength(2);
    expect(rows.filter((r) => r.action === 'customer.create')).toHaveLength(2);
    expect(rows.filter((r) => r.action === 'handover.create').map((r) => r.target)).toEqual([
      'ST-20261015-001',
      'ST-20261015-002',
    ]);
  });

  test('CPU kasar: 10 task x 5.000 karakter di bawah anggaran', async () => {
    const note = Array.from(
      { length: 120 },
      (_, i) => `- [ ] Barang ${i} = ${i} pcs ${'x'.repeat(20)}`,
    )
      .join('\n')
      .slice(0, 5000);
    const tasks = Array.from({ length: 10 }, (_, i) => ({ customerName: `PT ${i}`, note }));
    const { result, ms } = await measureCpu(() => batch(tasks));
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThan(100);
  });
});

describe('setCheck, setDone, cancel, reopen', () => {
  async function seed(
    overrides: Parameters<typeof seedHandover>[1] extends infer T ? Partial<T> : never = {},
  ) {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A = 1\n- [ ] B = 2',
      ...overrides,
    } as Parameters<typeof seedHandover>[1]);
  }

  test('mencentang butir, menyimpan pelaku/waktu, status Baru -> Dikerjakan -> Selesai; kolom turunan ikut', async () => {
    await seed();
    const first = await setCheck(0, 'A = 1', true);
    expect(first.data.status).toBe('in_progress');
    expect(first.data.checklist[0]).toMatchObject({
      checked: true,
      by: 'qc@gmail.com',
      at: '2026-10-15T03:00:00.000Z',
    });
    expect(await task()).toMatchObject({
      checked_count: 1,
      total_count: 2,
      board_status: 'in_progress',
      version: 2,
    });
    env.clock.advance(1000);
    const second = await setCheck(1, 'B = 2', true);
    expect(second.data.status).toBe('done');
    expect(await task()).toMatchObject({ checked_count: 2, board_status: 'done', version: 3 });
    env.clock.advance(1000);
    const undone = await setCheck(0, 'A = 1', false);
    expect(undone.data.status).toBe('in_progress');
    expect(undone.data.checklist[0]).toMatchObject({ checked: false, by: '' });
    expect(await audits()).toEqual(['handover.check', 'handover.check', 'handover.uncheck']);
  });

  test('butir kembar dicentang per kemunculan', async () => {
    await seed({ note: '- [ ] X\n- [ ] X' });
    const out = await setCheck(1, 'X', true);
    expect(out.data.checklist.map((c: { checked: boolean }) => c.checked)).toEqual([false, true]);
    expect((await checksOf())[0]?.occurrence).toBe(1);
  });

  test('idempoten: checked:true dua kali tanpa audit/versi kedua; membuka yang belum tercentang tak berubah', async () => {
    await seed();
    env.clock.advance(1000);
    const first = await setCheck(0, 'A = 1', true);
    env.clock.advance(1000);
    const again = await setCheck(0, 'A = 1', true);
    expect(again.ok).toBe(true);
    expect(again.data.updatedAt).toBe(first.data.updatedAt);
    expect(await audits()).toEqual(['handover.check']);
    expect((await setCheck(1, 'B = 2', false)).ok).toBe(true);
    expect(await audits()).toEqual(['handover.check']);
    expect((await task()).version).toBe(2);
  });

  test('text tidak cocok dengan indeks -> CONFLICT tanpa menulis', async () => {
    await seed();
    expect((await setCheck(0, 'B = 2', true)).error.code).toBe('CONFLICT');
    expect((await setCheck(5, 'A = 1', true)).error.code).toBe('CONFLICT');
    expect(await checksOf()).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  test('izin: tanpa qc:edit FORBIDDEN; Dibatalkan CONFLICT; lokasi lain NOT_FOUND', async () => {
    await seed();
    expect((await setCheck(0, 'A = 1', true, 'wh@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await setCheck(0, 'A = 1', true, 'viewer@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await setCheck(0, 'A = 1', true)).ok).toBe(true);
    await seed({ id: 't9', number: 'ST-20261015-009', status: 'cancelled' });
    expect(
      (
        await call('qc@gmail.com', 'handovers.setCheck', {
          id: 't9',
          locationId: ENV.locA,
          index: 0,
          text: 'A = 1',
          checked: true,
        })
      ).error.code,
    ).toBe('CONFLICT');
    expect(
      (
        await call('qc@gmail.com', 'handovers.setCheck', {
          id: 't1',
          locationId: ENV.locB,
          index: 0,
          text: 'A = 1',
          checked: true,
        })
      ).error.code,
    ).toBe('NOT_FOUND');
  });

  test('teks butir ter-escape/berentitas cocok dengan teks kanonis', async () => {
    await seed({ note: '- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs' });
    expect((await setCheck(0, 'RB_5009_X = 1 unit', true)).ok).toBe(true);
    expect((await setCheck(0, 'RB\\_5009\\_X = 1 unit', true)).ok).toBe(true);
    expect((await setCheck(1, 'Kabel UTP & konektor = 2 pcs', true)).ok).toBe(true);
    expect((await checksOf()).map((c) => c.text)).toEqual([
      'RB_5009_X = 1 unit',
      'Kabel UTP & konektor = 2 pcs',
    ]);
  });

  test('setDone mencentang semua butir, idempoten; done:false ditolak', async () => {
    await seed({
      checks: [{ text: 'A = 1', by: 'x@gmail.com', at: '2026-10-14T00:00:00.000Z', occurrence: 0 }],
    });
    const done = await setDone();
    expect(done.data.status).toBe('done');
    expect(done.data.checklist.map((c: { by: string }) => c.by)).toEqual([
      'x@gmail.com',
      'qc@gmail.com',
    ]);
    expect((await setDone()).ok).toBe(true);
    const tolak = await call('qc@gmail.com', 'handovers.setDone', { ...ref, done: false });
    expect(tolak.error.code).toBe('VALIDATION');
    expect(tolak.error.fields.done).toBeDefined();
    expect(await checksOf()).toHaveLength(2);
    expect(await audits()).toEqual(['handover.done']);
  });

  test('setDone pada task tanpa butir mengisi completedAt; WH ditolak; Dibatalkan ditolak', async () => {
    await seed({ note: 'tanpa checklist' });
    const done = await setDone();
    expect(done.data).toMatchObject({
      status: 'done',
      completedAt: '2026-10-15T03:00:00.000Z',
      completedBy: 'qc@gmail.com',
    });
    expect(await task()).toMatchObject({ board_status: 'done', total_count: 0, checked_count: 0 });
    expect((await setDone()).ok).toBe(true);
    expect(await audits()).toEqual(['handover.done']);
    expect((await setDone('wh@gmail.com')).error.code).toBe('FORBIDDEN');
    await seed({ id: 't2', number: 'ST-20261015-002', status: 'cancelled' });
    expect(
      (await call('qc@gmail.com', 'handovers.setDone', { id: 't2', locationId: ENV.locA })).error
        .code,
    ).toBe('CONFLICT');
  });

  test('reopen: hanya Dibatalkan, centang tetap, board_status dihitung ulang, izin manage', async () => {
    await seed({
      checks: [{ text: 'A = 1', by: 'x@gmail.com', at: '2026-10-14T00:00:00.000Z', occurrence: 0 }],
      status: 'cancelled',
    });
    expect((await task()).board_status).toBe('cancelled');
    expect((await call('whedit@gmail.com', 'handovers.reopen', ref)).error.code).toBe('FORBIDDEN');
    expect((await call('qc@gmail.com', 'handovers.reopen', ref)).error.code).toBe('FORBIDDEN');
    const reopened = await call('wh@gmail.com', 'handovers.reopen', ref);
    expect(reopened.data.status).toBe('in_progress');
    expect(reopened.data.checklist[0]).toMatchObject({ checked: true, by: 'x@gmail.com' });
    expect((await task()).board_status).toBe('in_progress');
    expect(await audits()).toEqual(['handover.uncancel']);
    expect((await call('wh@gmail.com', 'handovers.reopen', ref)).error.code).toBe('CONFLICT');
    expect(
      (await call('wh@gmail.com', 'handovers.reopen', { id: 't1', locationId: ENV.locB })).error
        .code,
    ).toBe('FORBIDDEN');
  });

  test('cancel ditolak untuk Selesai; cancel oleh WH manage berhasil dan idempoten', async () => {
    await seed();
    await setDone();
    expect((await call('wh@gmail.com', 'handovers.cancel', ref)).error.code).toBe('CONFLICT');
    await seed({ id: 't2', number: 'ST-20261015-002', note: '- [ ] A = 1' });
    const t2 = { id: 't2', locationId: ENV.locA };
    expect((await call('wh@gmail.com', 'handovers.cancel', t2)).data.status).toBe('cancelled');
    expect((await task('t2')).board_status).toBe('cancelled');
    expect((await call('wh@gmail.com', 'handovers.cancel', t2)).ok).toBe(true);
    expect((await auditRows()).filter((a) => a.action === 'handover.cancel')).toHaveLength(1);
    expect((await call('whedit@gmail.com', 'handovers.cancel', ref)).error.code).toBe('FORBIDDEN');
  });

  test('semua mutasi menulis audit dengan pelaku; audit non-catatan tanpa note', async () => {
    await seed({ note: `- [ ] A = 1\n\n${'x'.repeat(2000)}` });
    await setCheck(0, 'A = 1', true);
    env.clock.advance(1000);
    await setCheck(0, 'A = 1', false);
    env.clock.advance(1000);
    await call('wh@gmail.com', 'handovers.cancel', ref);
    env.clock.advance(1000);
    await call('wh@gmail.com', 'handovers.reopen', ref);
    env.clock.advance(1000);
    await setDone();
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual([
      'handover.check',
      'handover.uncheck',
      'handover.cancel',
      'handover.uncancel',
      'handover.done',
    ]);
    expect(rows.map((r) => r.actor)).toEqual([
      'qc@gmail.com',
      'qc@gmail.com',
      'wh@gmail.com',
      'wh@gmail.com',
      'qc@gmail.com',
    ]);
    expect(rows.every((r) => r.target === 'ST-20261015-001')).toBe(true);
    for (const row of rows) {
      expect(JSON.stringify(row.after)).not.toContain('xxxxxxxxxx');
      expect(Object.keys(row.after ?? {})).not.toContain('note');
    }
  });
});

describe('komentar', () => {
  async function seed(note = '- [ ] A = 1\n\nkirim sore. kirim sore.', overrides = {}) {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note,
      ...overrides,
    });
  }

  test('oleh pengguna hanya-lihat berhasil; tanpa izin FORBIDDEN', async () => {
    await seed();
    const out = await comment('A = 1', 'Mohon cek');
    expect(out.ok).toBe(true);
    expect(out.data.comments[0]).toMatchObject({
      quote: 'A = 1',
      body: 'Mohon cek',
      author: 'viewer@gmail.com',
      at: '2026-10-15T03:00:00.000Z',
      stale: false,
    });
    expect(out.data.comments[0].id).toBeTruthy();
    expect((await comment('A = 1', 'QC', {}, 'qc@gmail.com')).ok).toBe(true);
    expect((await comment('A = 1', 'x', {}, 'noaccess@gmail.com')).error.code).toBe('FORBIDDEN');
  });

  test('kutipan yang tidak ada ditolak; Dibatalkan ditolak', async () => {
    await seed();
    const out = await comment('tidak ada');
    expect(out.error.code).toBe('VALIDATION');
    expect(out.error.fields.quote).toBeDefined();
    expect(await commentsOf()).toEqual([]);
    await seed('x', { id: 't9', number: 'ST-20261015-009', status: 'cancelled' });
    expect(
      (
        await call('viewer@gmail.com', 'handovers.comment', {
          id: 't9',
          locationId: ENV.locA,
          quote: '',
          before: '',
          after: '',
          body: 'b',
        })
      ).error.code,
    ).toBe('CONFLICT');
  });

  test('kutipan berulang menyimpan konteks yang benar', async () => {
    await seed();
    const out = await comment('kirim sore', 'Yang kedua', { before: 'kirim sore. ', after: '.' });
    const stored = out.data.comments[0];
    expect(stored).toMatchObject({ before: 'kirim sore. ', after: '.' });
    const plain = noteToPlainText(out.data.note);
    expect(locateAnchor(plain, stored)?.start).toBe(plain.lastIndexOf('kirim sore'));
  });

  test('stale:true setelah catatan diedit sehingga kutipan hilang; komentar umum tidak pernah usang', async () => {
    await seed();
    await comment('kirim sore', 'x', { before: 'kirim sore. ', after: '.' });
    await comment('A = 1', 'y');
    await comment('', 'umum');
    env.clock.advance(1000);
    const edited = await call('wh@gmail.com', 'handovers.save', {
      ...ref,
      customerName: '',
      note: '- [ ] A = 1\n\nkirim pagi',
    });
    expect(edited.ok).toBe(true);
    expect(edited.data.comments.map((c: { stale: boolean }) => c.stale)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('isi berisi <script> dikembalikan apa adanya; komentar umum menyimpan before/after kosong', async () => {
    await seed();
    const body = '<script>alert(1)</script> & "x"';
    const out = await comment('A = 1', body);
    expect(out.data.comments[0].body).toBe(body);
    const general = await call('viewer@gmail.com', 'handovers.comment', {
      ...ref,
      quote: '',
      before: 'sisa',
      after: 'sisa',
      body: 'umum',
    });
    expect(general.data.comments[1]).toMatchObject({ quote: '', before: '', after: '' });
  });

  test('menulis audit handover.comment dengan pelaku dan tidak menaikkan updatedAt/version', async () => {
    await seed();
    const before = await task();
    await comment('A = 1', 'Halo');
    const record = (await auditRows()).at(-1);
    expect(record).toMatchObject({
      action: 'handover.comment',
      actor: 'viewer@gmail.com',
      target: 'ST-20261015-001',
    });
    const after = await task();
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.version).toBe(before.version);
  });

  test('komentar ke-51 ditolak dengan pesan batas', async () => {
    await seed('- [ ] A = 1');
    let error: Result['error'];
    for (let i = 0; i < 51; i++) {
      const out = await comment('', 'k');
      if (!out.ok) error = out.error;
    }
    expect(error.fields.body).toContain('50');
    expect(await commentsOf()).toHaveLength(50);
  });

  test('batas 40.000 karakter JSON lebih dulu dari 50 komentar dengan pesan jelas', async () => {
    await seed(`- [ ] A = 1\n\n${'q'.repeat(480)}`);
    let count = 0;
    let lastError: Result['error'];
    for (let i = 0; i < 50; i++) {
      const out = await comment('q'.repeat(480), 'b'.repeat(1000), {
        before: 'x'.repeat(40),
        after: 'y'.repeat(40),
      });
      if (!out.ok) {
        lastError = out.error;
        break;
      }
      count++;
    }
    expect(count).toBeLessThan(50);
    expect(lastError.code).toBe('VALIDATION');
    expect(lastError.fields.body).toContain('40.000');
    expect(await commentsOf()).toHaveLength(count);
  });

  test('komentar serentak 60: tepat 50 tersimpan, tanpa melewati batas', async () => {
    await seed('- [ ] A = 1');
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => comment('', `k${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect(await commentsOf()).toHaveLength(50);
    expect((await auditRows()).filter((r) => r.action === 'handover.comment')).toHaveLength(50);
  });
});

describe('baca: board per kolom, get, options', () => {
  beforeEach(async () => {
    await seedCustomer(env, { id: 'cust-pt-maju', name: 'PT Maju', key: 'pt maju' });
    await seedCustomer(env, { id: 'cust-budi', name: 'Budi', key: 'budi' });
    const base = { customerId: '', customerName: '' };
    const one = {
      text: 'A = 1',
      by: 'qc@gmail.com',
      at: '2026-10-15T02:10:00.000Z',
      occurrence: 0,
    };
    await seedHandover(env, {
      ...base,
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      note: '- [ ] A = 1\n- [ ] B = 2',
      createdAt: '2026-10-15T01:00:00.000Z',
      updatedAt: '2026-10-15T01:00:00.000Z',
    });
    await seedHandover(
      env,
      {
        id: 't2',
        number: 'ST-20261015-002',
        locationId: ENV.locA,
        customerId: 'cust-budi',
        customerName: 'Budi lama',
        note: '- [ ] A = 1\n- [ ] B = 2\n\nkirim sore',
        checks: [one],
        createdAt: '2026-10-15T02:00:00.000Z',
        updatedAt: '2026-10-15T02:00:00.000Z',
      },
      [
        {
          id: 'c1',
          quote: 'kirim sore',
          before: '',
          after: '',
          body: 'ok',
          author: 'qc@gmail.com',
          at: '2026-10-15T02:01:00.000Z',
        },
        {
          id: 'c2',
          quote: 'hilang',
          before: '',
          after: '',
          body: 'usang',
          author: 'qc@gmail.com',
          at: '2026-10-15T02:02:00.000Z',
        },
      ],
    );
    await seedHandover(env, {
      ...base,
      id: 't3',
      number: 'ST-20261015-003',
      locationId: ENV.locA,
      note: '- [ ] A = 1',
      checks: [one],
      createdAt: '2026-10-15T02:20:00.000Z',
      updatedAt: '2026-10-15T02:20:00.000Z',
    });
    await seedHandover(env, {
      ...base,
      id: 't4',
      number: 'ST-20261015-004',
      locationId: ENV.locA,
      note: '- [ ] A = 1',
      status: 'cancelled',
      createdAt: '2026-10-15T02:25:00.000Z',
      updatedAt: '2026-10-15T02:25:00.000Z',
    });
    await seedHandover(env, {
      ...base,
      id: 't5',
      number: 'ST-20261015-005',
      locationId: ENV.locB,
      note: '- [ ] Z = 1',
      createdAt: '2026-10-15T02:30:00.000Z',
      updatedAt: '2026-10-15T02:30:00.000Z',
    });
    await seedHandover(env, {
      ...base,
      id: 't6',
      number: 'ST-20261015-006',
      locationId: ENV.locA,
      note: 'tanpa checklist',
      completedAt: '2026-10-15T02:40:00.000Z',
      completedBy: 'qc@gmail.com',
      createdAt: '2026-10-15T02:40:00.000Z',
      updatedAt: '2026-10-15T02:40:00.000Z',
    });
  });

  const board = (
    status: string,
    extra: Record<string, unknown> = {},
    email = 'wh@gmail.com',
    locationIds = [ENV.locA],
  ) => call(email, 'handovers.board', { locationIds, status, ...extra });

  test('satu kolom per panggilan dengan total; urutan terbaru dahulu', async () => {
    const done = await board('done');
    expect(done.ok).toBe(true);
    expect(done.data.items.map((t: { id: string }) => t.id)).toEqual(['t6', 't3']);
    expect(done.data.total).toBe(2);
    expect(done.data.nextCursor).toBeNull();
    const fresh = await board('new');
    expect(fresh.data.items.map((t: { id: string }) => t.id)).toEqual(['t1']);
    expect((await board('cancelled')).data.items.map((t: { id: string }) => t.id)).toEqual(['t4']);
    expect((await board('in_progress')).data.items.map((t: { id: string }) => t.id)).toEqual([
      't2',
    ]);
  });

  test('jumlah kolom (COUNT) hanya dihitung bila tak dapat disimpulkan dari halaman; round trip board <= 2', async () => {
    const stats = d1StatsOf(env.DB);
    const countsOf = async (extra: Record<string, unknown>) => {
      stats.log = [];
      const trips = stats.trips;
      const result = await board('done', extra);
      const log = stats.log;
      stats.log = null;
      return {
        result,
        count: log.filter((sql) => sql.includes('COUNT(*)')).length,
        trips: stats.trips - trips,
      };
    };
    // halaman pertama yang tidak penuh: total = jumlah baris, tanpa COUNT
    const first = await countsOf({});
    expect(first.result.data.total).toBe(2);
    expect(first.count).toBe(0);
    expect(first.trips).toBeLessThanOrEqual(3); // konteks akses (cache mati di tes) + halaman + komentar
    // halaman penuh (limit 1 dari 2): COUNT diperlukan, tetap satu round trip bersama komentar
    const full = await countsOf({ limit: 1 });
    expect(full.result.data.total).toBe(2);
    expect(full.result.data.nextCursor).not.toBeNull();
    expect(full.count).toBe(1);
    // halaman berkursor: COUNT diperlukan walau halaman tidak penuh
    const next = await countsOf({ limit: 1, cursor: full.result.data.nextCursor });
    expect(next.result.data.total).toBe(2);
    expect(next.count).toBe(1);
  });

  test('board menolak lokasi terlarang (FORBIDDEN) dan tidak membocorkan task lokasi lain; multi lokasi', async () => {
    const denied = await board('done', {}, 'wh@gmail.com', [ENV.locA, ENV.locB]);
    expect(denied.error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(denied)).not.toContain('ST-20261015-003');
    expect((await board('new', {}, 'noaccess@gmail.com')).error.code).toBe('FORBIDDEN');
    const both = await board('new', {}, 'multi@gmail.com', [ENV.locA, ENV.locB]);
    expect(both.data.items.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't5']);
    expect(both.data.total).toBe(2);
    expect(
      (await board('new', {}, 'multi@gmail.com', [ENV.locB])).data.items.map(
        (t: { id: string }) => t.id,
      ),
    ).toEqual(['t5']);
  });

  test('DTO board: checklist, status turunan, customer terkini, komentar dengan stale', async () => {
    const inProgress = (await board('in_progress', {}, 'qc@gmail.com')).data.items[0];
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.checklist[0]).toMatchObject({ checked: true, by: 'qc@gmail.com' });
    expect(inProgress.customerName).toBe('Budi');
    expect(inProgress.comments.map((c: { id: string; stale: boolean }) => [c.id, c.stale])).toEqual(
      [
        ['c1', false],
        ['c2', true],
      ],
    );
    const doneItems = (await board('done', {}, 'qc@gmail.com')).data.items;
    expect(doneItems.find((t: { id: string }) => t.id === 't6').checklist).toEqual([]);
    expect(doneItems.find((t: { id: string }) => t.id === 't6').status).toBe('done');
  });

  test('halaman berkursor per kolom tanpa duplikat/lompatan; batas default 3; total konsisten', async () => {
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 45; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO handovers (id, number, location_id, note, updated_at, board_status, total_count) VALUES (?, ?, ?, '- [ ] a', ?, 'new', 1)",
        ).bind(
          `n${i}`,
          `ST-20261016-${String(i + 1).padStart(3, '0')}`,
          ENV.locA,
          `2026-10-16T00:00:${String(i % 20).padStart(2, '0')}.000Z`,
        ),
      );
    }
    await env.DB.batch(statements);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let total = 0;
    do {
      const page = await board('new', { limit: 3, ...(cursor ? { cursor } : {}) });
      expect(page.ok).toBe(true);
      seen.push(...page.data.items.map((t: { id: string }) => t.id));
      total = page.data.total;
      cursor = page.data.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(16); // 46 task / 3 per halaman
    expect(total).toBe(46);
    expect(new Set(seen).size).toBe(46);
    expect((await board('new')).data.items).toHaveLength(3);
    // urutan menurun menurut (updated_at, number)
    const rows = await env.DB.prepare(
      "SELECT id FROM handovers WHERE board_status = 'new' AND location_id = ? ORDER BY updated_at DESC, number DESC",
    )
      .bind(ENV.locA)
      .all<{ id: string }>();
    expect(seen).toEqual(rows.results.map((r) => r.id));
  });

  test('kolom Dikerjakan: progres lebih kecil di atas, lalu terbaru; berkursor', async () => {
    const mk = (id: string, checked: number, total: number, updated: string) =>
      seedHandover(env, {
        id,
        number: `ST-20261017-${id}`,
        locationId: ENV.locA,
        customerId: '',
        customerName: '',
        note: Array.from({ length: total }, (_, i) => `- [ ] i${i}`).join('\n'),
        checks: Array.from({ length: checked }, (_, i) => ({
          text: `i${i}`,
          by: 'qc@gmail.com',
          at: updated,
          occurrence: 0,
        })),
        updatedAt: updated,
      });
    await mk('p9', 9, 10, '2026-10-17T00:00:05.000Z');
    await mk('p1a', 1, 10, '2026-10-17T00:00:01.000Z');
    await mk('p1b', 1, 10, '2026-10-17T00:00:02.000Z');
    await mk('p5', 5, 10, '2026-10-17T00:00:03.000Z');
    const pageAll: string[] = [];
    let first: string | undefined;
    do {
      const page = await board('in_progress', { limit: 3, ...(first ? { cursor: first } : {}) });
      pageAll.push(...page.data.items.map((t: { id: string }) => t.id));
      first = page.data.nextCursor ?? undefined;
    } while (first);
    const all = pageAll;
    // t2 (1/2 = 500) setara p5 (500); progres 100 dahulu; terbaru dahulu pada progres sama
    expect(all).toEqual(['p1b', 'p1a', 'p5', 't2', 'p9']);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await board('in_progress', { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.data.items.map((t: { id: string }) => t.id));
      cursor = page.data.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all);
  });

  test('get: task lokasi lain NOT_FOUND; options berisi customer aktif dan nama nonaktif', async () => {
    expect(
      (await call('wh@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locA] })).error
        .code,
    ).toBe('NOT_FOUND');
    const got = await call('qc@gmail.com', 'handovers.get', { id: 't2', locationIds: [ENV.locA] });
    expect(got.data.comments.map((c: { id: string; stale: boolean }) => [c.id, c.stale])).toEqual([
      ['c1', false],
      ['c2', true],
    ]);
    await seedCustomer(env, { id: 'c-off', name: 'Lama', key: 'lama', status: 'inactive' });
    const out = await call('wh@gmail.com', 'handovers.options', { locationIds: [ENV.locA] });
    expect(out.data.customers.map((c: { name: string }) => c.name)).toEqual(['Budi', 'PT Maju']);
    expect(out.data.inactiveCustomerNames).toEqual(['Lama']);
  });

  test('board_status berindeks: kueri board tidak memindai tabel', async () => {
    const plan = await env.DB.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM handovers h WHERE h.location_id IN (?, ?) AND h.board_status = ? ORDER BY h.updated_at DESC, h.number DESC LIMIT 21',
    )
      .bind(ENV.locA, ENV.locB, 'new')
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join('\n')).toMatch(/handovers_board/);
  });

  test('CPU kasar: halaman board (maks. 3 task) dari kolom 21 task di bawah anggaran', async () => {
    const note = Array.from({ length: 60 }, (_, i) => `- [ ] Barang ${i} = ${i} pcs`).join('\n');
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 20; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO handovers (id, number, location_id, note, updated_at, board_status, total_count) VALUES (?, ?, ?, ?, ?, 'new', 60)",
        ).bind(
          `b${i}`,
          `ST-20261020-${String(i + 1).padStart(3, '0')}`,
          ENV.locA,
          note,
          `2026-10-20T00:00:${String(i).padStart(2, '0')}.000Z`,
        ),
      );
    }
    await env.DB.batch(stmts);
    const { result, ms } = await measureCpu(() => board('new', { limit: 3 }, 'qc@gmail.com'));
    expect(result.data.items).toHaveLength(3);
    expect(result.data.total).toBe(21); // 20 + task contoh
    expect(ms).toBeLessThan(50);
  });
});

describe('konkurensi (Review Focus 3)', () => {
  async function seedTwo() {
    await seedHandover(env, {
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A\n- [ ] B\n- [ ] C',
    });
  }

  test('dua QC mencentang butir berbeda bersamaan: kedua centang tersimpan (CAS + ulang)', async () => {
    await seedTwo();
    const [a, b] = await Promise.all([
      setCheck(0, 'A', true),
      setCheck(1, 'B', true, 'qc@gmail.com'),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect((await checksOf()).map((c) => c.text).sort()).toEqual(['A', 'B']);
    expect(await task()).toMatchObject({
      checked_count: 2,
      board_status: 'in_progress',
      version: 3,
    });
    expect((await audits()).filter((x) => x === 'handover.check')).toHaveLength(2);
  });

  test('tiga pencentang serentak: semua tersimpan', async () => {
    await seedTwo();
    const results = await Promise.all([
      setCheck(0, 'A', true),
      setCheck(1, 'B', true),
      setCheck(2, 'C', true),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await checksOf()).map((c) => c.text).sort()).toEqual(['A', 'B', 'C']);
    expect((await task()).board_status).toBe('done');
  });

  test('centang yang sama serentak: satu audit, hasil idempoten', async () => {
    await seedTwo();
    const [x, y] = await Promise.all([setCheck(0, 'A', true), setCheck(0, 'A', true)]);
    expect(x.ok && y.ok).toBe(true);
    expect(await checksOf()).toHaveLength(1);
    expect((await audits()).filter((a) => a === 'handover.check')).toHaveLength(1);
  });

  test('centang bersamaan dengan WH menyimpan catatan: centang tidak hilang dan catatan tersimpan', async () => {
    await seedTwo();
    const [check, saved] = await Promise.all([
      setCheck(0, 'A', true),
      save({ id: 't1', note: '- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D' }),
    ]);
    expect(check.ok).toBe(true);
    expect(saved.ok).toBe(true);
    expect((await task()).note).toBe('- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D');
    expect((await checksOf()).map((c) => c.text)).toEqual(['A']);
    expect(await task()).toMatchObject({ checked_count: 1, total_count: 4 });
  });

  test('dua save task baru bersamaan: nomor unik dan berurutan, tanpa duplikat', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => save({ note: `task ${i}` })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = results.map((r) => r.data.number as string).sort();
    expect(numbers).toEqual(
      Array.from({ length: 6 }, (_, i) => `ST-20261015-${String(i + 1).padStart(3, '0')}`),
    );
    expect(new Set((await taskRows()).map((r) => r.number)).size).toBe(6);
  });

  test('saveBatch bersamaan dengan save: tidak ada nomor ganda, customer sama dibuat sekali', async () => {
    const [b1, b2, s] = await Promise.all([
      call('wh@gmail.com', 'handovers.saveBatch', {
        locationId: ENV.locA,
        tasks: Array.from({ length: 5 }, () => ({ customerName: 'PT Sama', note: 'a' })),
      }),
      call('wh@gmail.com', 'handovers.saveBatch', {
        locationId: ENV.locA,
        tasks: Array.from({ length: 5 }, () => ({ customerName: 'pt sama', note: 'b' })),
      }),
      save({ note: 'c', customerName: 'PT Sama' }),
    ]);
    expect(b1.ok && b2.ok && s.ok).toBe(true);
    const numbers = (await taskRows()).map((r) => r.number);
    expect(numbers).toHaveLength(11);
    expect(new Set(numbers).size).toBe(11);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM customers WHERE key = 'pt sama'").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    expect((await audits()).filter((a) => a === 'customer.create')).toHaveLength(1);
  });

  test('batch banyak: setiap pernyataan di bawah 100 parameter terikat (adaptor menolak bila lebih)', async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      customerName: `Cust ${i}`,
      note: `- [ ] x${i}`,
    }));
    expect(
      (await call('wh@gmail.com', 'handovers.saveBatch', { locationId: ENV.locA, tasks })).ok,
    ).toBe(true);
  });
});
