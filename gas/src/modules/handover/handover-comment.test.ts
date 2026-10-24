import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { handover } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { locateAnchor, noteToPlainText } from '@shared/handover-comments';
import { insertHandover_, listHandovers_ } from './repo';

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

function seed(overrides: Partial<Parameters<typeof handover>[0]> = {}): void {
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A = 1\n\nkirim sore. kirim sore.',
      ...overrides,
    }),
  );
}

test('comment oleh pengguna hanya-lihat (handover:view) berhasil', () => {
  seed();
  const out = comment('A = 1', 'Mohon cek');
  expect(out.ok).toBe(true);
  expect(out.data.comments).toHaveLength(1);
  expect(out.data.comments[0]).toMatchObject({
    quote: 'A = 1',
    body: 'Mohon cek',
    author: 'viewer@gmail.com',
    at: '2026-10-15T03:00:00.000Z',
    stale: false,
  });
  expect(out.data.comments[0].id).toBeTruthy();
  expect(comment('A = 1', 'QC', {}, 'qc@gmail.com').ok).toBe(true);
  expect(comment('A = 1', 'x', {}, 'noaccess@gmail.com').error.code).toBe('FORBIDDEN');
});

test('comment dengan kutipan yang tidak ada ditolak', () => {
  seed();
  const out = comment('tidak ada');
  expect(out.error.code).toBe('VALIDATION');
  expect(out.error.fields.quote).toBeDefined();
  expect(listHandovers_()[0]?.comments).toEqual([]);
});

test('comment ke-51 ditolak', () => {
  seed();
  for (let i = 0; i < 50; i++) expect(comment('A = 1', `k${i}`).ok).toBe(true);
  const out = comment('A = 1', 'ke-51');
  expect(out.error.code).toBe('VALIDATION');
  expect(listHandovers_()[0]?.comments).toHaveLength(50);
});

test('comment pada task Dibatalkan ditolak', () => {
  seed({ status: 'cancelled' });
  expect(comment('A = 1').error.code).toBe('CONFLICT');
});

test('comment pada kutipan berulang menyimpan konteks yang benar', () => {
  seed();
  const out = comment('kirim sore', 'Yang kedua', { before: 'kirim sore. ', after: '.' });
  const stored = out.data.comments[0];
  expect(stored).toMatchObject({ before: 'kirim sore. ', after: '.' });
  const plain = noteToPlainText(out.data.note);
  const range = locateAnchor(plain, stored);
  expect(range?.start).toBe(plain.lastIndexOf('kirim sore'));
});

test('komentar menjadi stale:true setelah catatan diedit sehingga kutipan hilang', () => {
  seed();
  comment('kirim sore', 'x', { before: 'kirim sore. ', after: '.' });
  comment('A = 1', 'y');
  const edited = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    locationId: ENV.locA,
    customerName: '',
    note: '- [ ] A = 1\n\nkirim pagi',
  });
  expect(edited.ok).toBe(true);
  expect(edited.data.comments.map((c: { stale: boolean }) => c.stale)).toEqual([true, false]);
});

test('isi komentar berisi <script> dikembalikan apa adanya sebagai teks (tanpa penafsiran)', () => {
  seed();
  const body = '<script>alert(1)</script> & "x"';
  const out = comment('A = 1', body);
  expect(out.data.comments[0].body).toBe(body);
  expect(listHandovers_()[0]?.comments[0]?.body).toBe(body);
});

test('comment menulis audit handover.comment dengan pelaku dan tidak menaikkan updatedAt', () => {
  seed();
  const before = listHandovers_()[0]?.updatedAt;
  comment('A = 1', 'Halo');
  const record = listAuditRecords_().at(-1);
  expect(record).toMatchObject({
    action: 'handover.comment',
    actor: 'viewer@gmail.com',
    target: 'ST-20261015-001',
  });
  expect(listHandovers_()[0]?.updatedAt).toBe(before);
});
