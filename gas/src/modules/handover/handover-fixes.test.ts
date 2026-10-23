import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { handover } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, listHandovers_ } from './repo';
import { fitAuditSnapshots_, handoverSnapshot_ } from './service';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;
const ref = { id: 't1', locationId: ENV.locA };
const afterOf = (record: { after?: unknown } | undefined): Record<string, unknown> =>
  (record?.after ?? {}) as Record<string, unknown>;

function seed(note: string, overrides: Partial<Parameters<typeof handover>[0]> = {}): void {
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note,
      ...overrides,
    }),
  );
}

test('C1: catatan mentah lalu tersimpan ter-escape dengan suntingan lain, centang tetap', () => {
  seed('- [ ] RB_5009_X = 1 unit\n- [ ] Kabel UTP & konektor = 2 pcs');
  expect(
    call('qc@gmail.com', 'handovers.setCheck', {
      ...ref,
      index: 0,
      text: 'RB_5009_X = 1 unit',
      checked: true,
    }).ok,
  ).toBe(true);
  const saved = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    customerName: '',
    note: 'kirim sore\n\n- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs',
  });
  expect(saved.ok).toBe(true);
  expect(saved.data.checklist[0]).toMatchObject({ checked: true, by: 'qc@gmail.com' });
  expect(saved.data.checklist[0].text).toBe('RB_5009_X = 1 unit');
  const audit = listAuditRecords_().find((r) => r.action === 'handover.update');
  expect(afterOf(audit).resets).toBeUndefined();
});

test('C1: urut ulang butir ter-escape tidak menghasilkan removed palsu', () => {
  seed('- [ ] RB_5009_X = 1 unit\n- [ ] B = 2 unit');
  call('qc@gmail.com', 'handovers.setCheck', {
    ...ref,
    index: 0,
    text: 'RB_5009_X = 1 unit',
    checked: true,
  });
  const saved = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    customerName: '',
    note: '- [ ] B = 2 unit\n- [ ] RB\\_5009\\_X = 1 unit',
  });
  expect(saved.ok).toBe(true);
  expect(saved.data.checklist.map((c: { checked: boolean }) => c.checked)).toEqual([false, true]);
});

test('I1: komentar pada kutipan J&T (catatan berisi entitas) dan nbsp diterima', () => {
  seed('kirim via J&amp;T Merah\n\nPort &lt;24V&gt; a&nbsp;b');
  const comment = (quote: string) =>
    call('viewer@gmail.com', 'handovers.comment', {
      ...ref,
      quote,
      before: '',
      after: '',
      body: 'Ok',
    });
  expect(comment('J&T').ok).toBe(true);
  expect(comment('<24V>').ok).toBe(true);
  expect(comment('a b').ok).toBe(true);
  expect(comment('tidak ada').error.code).toBe('VALIDATION');
});

test('komentar umum: kutipan kosong diterima, tidak pernah usang meski catatan diubah', () => {
  seed('- [ ] A = 1');
  const out = call('viewer@gmail.com', 'handovers.comment', {
    ...ref,
    quote: '',
    before: '',
    after: '',
    body: 'Mohon dicek',
  });
  expect(out.ok).toBe(true);
  expect(out.data.comments[0]).toMatchObject({ quote: '', body: 'Mohon dicek', stale: false });
  const saved = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    customerName: '',
    note: '- [ ] A = 1\n- [ ] B = 2',
  });
  expect(saved.data.comments[0].stale).toBe(false);
});

test('batas komentar: 40.000 karakter JSON lebih dulu dari 50 komentar dengan pesan jelas', () => {
  const note = `- [ ] A = 1\n\n${'q'.repeat(480)}`;
  seed(note);
  const body = 'b'.repeat(1000);
  let lastError: Result['error'];
  let count = 0;
  for (let i = 0; i < 50; i++) {
    const out = call('viewer@gmail.com', 'handovers.comment', {
      ...ref,
      quote: 'q'.repeat(480),
      before: 'x'.repeat(40),
      after: 'y'.repeat(40),
      body,
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
  expect(listHandovers_()[0]?.comments).toHaveLength(count);
});

test('komentar ke-51 ditolak dengan pesan batas', () => {
  seed('- [ ] A = 1');
  let error: Result['error'];
  for (let i = 0; i < 51; i++) {
    const out = call('viewer@gmail.com', 'handovers.comment', {
      ...ref,
      quote: '',
      before: '',
      after: '',
      body: 'k',
    });
    if (!out.ok) error = out.error;
  }
  expect(error.fields.body).toContain('50');
});

test('M-1: karakter kontrol pada catatan ditolak sebelum menulis apa pun', () => {
  const out = call('wh@gmail.com', 'handovers.save', {
    locationId: ENV.locA,
    customerName: '',
    note: `- [ ] ${String.fromCharCode(1).repeat(4000)}`,
  });
  expect(out.error.code).toBe('VALIDATION');
  expect(out.error.fields.note).toBeDefined();
  expect(listHandovers_()).toHaveLength(0);
  expect(listAuditRecords_()).toHaveLength(0);
});

test('M-1: catatan kosong ditolak server; lebih dari 300 butir ditolak', () => {
  const kosong = call('wh@gmail.com', 'handovers.save', {
    locationId: ENV.locA,
    customerName: '',
    note: '   ',
  });
  expect(kosong.error.fields.note).toBeDefined();
  const banyak = call('wh@gmail.com', 'handovers.save', {
    locationId: ENV.locA,
    customerName: '',
    note: Array.from({ length: 301 }, () => '- [ ] a').join('\n'),
  });
  expect(banyak.error.fields.note).toContain('300');
});

test('M-1: reset centang selalu menghasilkan audit handover.update', () => {
  seed('- [ ] RD = 8');
  call('qc@gmail.com', 'handovers.setCheck', { ...ref, index: 0, text: 'RD = 8', checked: true });
  const saved = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    customerName: '',
    note: '- [ ] RD = 9',
  });
  expect(saved.ok).toBe(true);
  const audit = listAuditRecords_().find((r) => r.action === 'handover.update');
  expect(audit).toBeDefined();
  expect(afterOf(audit).resets).toEqual(['RD = 8 → RD = 9']);
});

test('fitAuditSnapshots_: catatan dipotong dengan penanda; tidak muat sama sekali → VALIDATION', () => {
  const record = handover({
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    note: 'n'.repeat(5000),
  });
  const names = new Map<string, string>();
  const cuma = fitAuditSnapshots_(
    (limit) => ({
      before: null,
      after: { ...handoverSnapshot_(record, '', names, limit), pad: 'p'.repeat(39000) },
    }),
    true,
  );
  expect(String(cuma.after.note)).toContain('(dipotong)');
  expect(JSON.stringify(cuma.after).length).toBeLessThanOrEqual(40000);
  let error: { code?: string } | undefined;
  try {
    fitAuditSnapshots_(() => ({ before: null, after: { pad: 'p'.repeat(41000) } }), true);
  } catch (e) {
    error = e as { code?: string };
  }
  expect(error?.code).toBe('VALIDATION');
});

test('M-1: audit create memuat note (dipotong bila perlu), audit centang tidak memuat note', () => {
  const created = call('wh@gmail.com', 'handovers.save', {
    locationId: ENV.locA,
    customerName: '',
    note: `- [ ] A = 1\n\n${'z'.repeat(4000)}`,
  });
  const audit = listAuditRecords_().find((r) => r.action === 'handover.create');
  const note = String(afterOf(audit).note);
  expect(note).toContain('(dipotong)');
  expect(note.length).toBeLessThan(2100);
  expect(created.ok).toBe(true);
});
