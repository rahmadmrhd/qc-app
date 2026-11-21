import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// Hapus lunak dan pulihkan task Serah Terima (fase 4d, Task 2; rancangan soft delete §4.3, keputusan pemilik 2 dan 12,
// T2 dan T8, spek §8 butir 6): keadaan baris, papan (hitungan, hasMore, filter Terhapus), hak, penolakan tulis pada task
// terhapus, antrean notifikasi, nomor ST tak dipakai ulang, kiriman ulang ber-clientId, dan notifikasi lonceng.

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = async (email: string, method: string, payload: unknown) =>
  (await callRest(env, email, method, payload)) as Result;

const WH = 'wh@gmail.com';
const QC = 'qc@gmail.com';
const VIEWER = 'viewer@gmail.com';
const WH_EDIT = 'whedit@gmail.com';
const MULTI = 'multi@gmail.com';
const NOW = '2026-10-15T03:00:00.000Z';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(NOW));
  await seedHandoverEnv(env);
});

const ref = (id: string, locationId: string = ENV.locA) => ({ id, locationId });
const remove = (id: string, email = WH, locationId: string = ENV.locA) =>
  call(email, 'handovers.remove', ref(id, locationId));
const restore = (id: string, email = WH, locationId: string = ENV.locA) =>
  call(email, 'handovers.restore', ref(id, locationId));
const board = (
  status: string,
  extra: Record<string, unknown> = {},
  email = WH,
  locationIds: string[] = [ENV.locA],
) => call(email, 'handovers.board', { locationIds, status, ...extra });
const ids = (out: Result): string[] =>
  (out.data?.items ?? []).map((item: { id: string }) => item.id);

async function create(
  note = '- [ ] A = 1\n- [ ] B = 2',
  customerName = 'PT Maju',
): Promise<string> {
  const out = await call(WH, 'handovers.save', { locationId: ENV.locA, customerName, note });
  expect(out.ok).toBe(true);
  // Jam maju: `updated_at` dipakai sebagai etag dan urutan papan; tiap perubahan berikutnya harus berbeda.
  env.clock.advance(1000);
  return out.data.id as string;
}

async function rows(sql: string, ...binds: unknown[]) {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>()
  ).results;
}
const countOf = async (sql: string, ...binds: unknown[]): Promise<number> =>
  Number((await rows(sql, ...binds))[0]?.n);
const auditCount = (action: string) =>
  countOf('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', action);
const stateOf = async (id: string) =>
  (await rows('SELECT deleted_at, deleted_by, version FROM handovers WHERE id = ?', id))[0] as {
    deleted_at: string;
    deleted_by: string;
    version: number;
  };

describe('handovers.remove (hapus lunak)', () => {
  test('menandai baris, menaikkan version, dan mencatat audit dengan targetId', async () => {
    const id = await create();
    const before = await stateOf(id);
    const out = await remove(id);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ id });
    const after = await stateOf(id);
    expect(after.deleted_at).toBe('2026-10-15T03:00:01.000Z');
    expect(after.deleted_by).toBe(WH);
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(await auditCount('handover.delete')).toBe(1);
    const [audit] = await rows(
      "SELECT target, target_id FROM audit_log WHERE action = 'handover.delete'",
    );
    expect(audit?.target_id).toBe(id);
  });

  test('hapus ulang sukses tanpa audit baru dan tanpa mengubah penanda asli', async () => {
    const id = await create();
    expect((await remove(id)).ok).toBe(true);
    const first = await stateOf(id);
    env.clock.advance(60_000);
    expect((await remove(id, MULTI)).ok).toBe(true);
    expect(await auditCount('handover.delete')).toBe(1);
    expect(await stateOf(id)).toEqual(first);
  });

  test('tanpa syarat status: task Selesai dan Dibatalkan pun dapat dihapus', async () => {
    const id = await create('- [ ] A');
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A', checked: true })).ok,
    ).toBe(true);
    const cancelled = await create('- [ ] C');
    expect((await call(WH, 'handovers.cancel', ref(cancelled))).ok).toBe(true);
    expect((await remove(id)).ok).toBe(true);
    expect((await remove(cancelled)).ok).toBe(true);
  });

  test('hak: hanya handover manage di lokasi task; lokasi salah = NOT_FOUND; tanpa hak = FORBIDDEN', async () => {
    const id = await create();
    for (const email of [WH_EDIT, VIEWER, QC]) {
      expect((await remove(id, email)).error?.code).toBe('FORBIDDEN');
      expect((await restore(id, email)).error?.code).toBe('FORBIDDEN');
    }
    // multi@ memegang manage di loc-b juga, tetapi task ada di loc-a.
    expect((await remove(id, MULTI, ENV.locB)).error?.code).toBe('NOT_FOUND');
    expect((await remove('tidak-ada')).error?.code).toBe('NOT_FOUND');
    expect((await stateOf(id)).deleted_at).toBe('');
  });

  test('membuang antrean notifikasi centang task itu dalam batch yang sama', async () => {
    const id = await create('- [ ] A\n- [ ] B');
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A', checked: true })).ok,
    ).toBe(true);
    expect(
      await countOf('SELECT COUNT(*) AS n FROM notification_pending WHERE handover_id = ?', id),
    ).toBe(1);
    expect(
      await countOf(
        'SELECT COUNT(*) AS n FROM notification_pending_items WHERE handover_id = ?',
        id,
      ),
    ).toBeGreaterThan(0);
    expect((await remove(id)).ok).toBe(true);
    expect(
      await countOf('SELECT COUNT(*) AS n FROM notification_pending WHERE handover_id = ?', id),
    ).toBe(0);
    expect(
      await countOf(
        'SELECT COUNT(*) AS n FROM notification_pending_items WHERE handover_id = ?',
        id,
      ),
    ).toBe(0);
  });

  test('nomor ST tidak dipakai ulang: task baru sesudah penghapusan mendapat nomor berikutnya', async () => {
    const first = await create();
    const firstNumber = (await rows('SELECT number FROM handovers WHERE id = ?', first))[0]
      ?.number as string;
    expect((await remove(first)).ok).toBe(true);
    const second = await create();
    const secondNumber = (await rows('SELECT number FROM handovers WHERE id = ?', second))[0]
      ?.number as string;
    expect(secondNumber).not.toBe(firstNumber);
    expect(secondNumber > firstNumber).toBe(true);
  });
});

describe('papan dan detail', () => {
  test('papan baku tak memuat task terhapus; total dan nextCursor kolom menyesuaikan', async () => {
    const a = await create('- [ ] A', 'PT A');
    const b = await create('- [ ] B', 'PT B');
    const paged = await board('new', { limit: 1 });
    expect(paged.data.total).toBe(2);
    expect(paged.data.nextCursor).not.toBeNull();
    expect((await remove(b)).ok).toBe(true);
    const after = await board('new', { limit: 1 });
    expect(after.data.total).toBe(1);
    expect(after.data.nextCursor).toBeNull();
    expect(ids(after)).toEqual([a]);
  });

  test('deleted=true (manage): menampilkan task terhapus di kolom statusnya, bertanda deleted', async () => {
    const open = await create('- [ ] A', 'PT A');
    const done = await create('- [ ] D', 'PT D');
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref(done), index: 0, text: 'D', checked: true }))
        .ok,
    ).toBe(true);
    expect((await remove(open)).ok).toBe(true);
    expect((await remove(done)).ok).toBe(true);
    const fresh = await board('new', { deleted: true });
    expect(ids(fresh)).toEqual([open]);
    expect(fresh.data.total).toBe(1);
    expect(fresh.data.items[0].deleted).toEqual({
      deletedAt: expect.any(String),
      deletedBy: WH,
    });
    expect(ids(await board('done', { deleted: true }))).toEqual([done]);
    // Papan baku tetap kosong untuk keduanya.
    expect(ids(await board('new'))).toEqual([]);
    expect(ids(await board('done'))).toEqual([]);
  });

  test('deleted=true dibatasi ke lokasi manage: non-manage FORBIDDEN, lokasi non-manage tersaring', async () => {
    const id = await create();
    expect((await remove(id)).ok).toBe(true);
    for (const email of [VIEWER, QC, WH_EDIT]) {
      expect((await board('new', { deleted: true }, email)).error?.code).toBe('FORBIDDEN');
    }
    expect(ids(await board('new', { deleted: true }, MULTI, [ENV.locA, ENV.locB]))).toEqual([id]);
  });

  test('deleted=true menghormati filter customer', async () => {
    const a = await create('- [ ] A', 'PT A');
    const b = await create('- [ ] B', 'PT B');
    expect((await remove(a)).ok).toBe(true);
    expect((await remove(b)).ok).toBe(true);
    const customerA = (await rows('SELECT customer_id FROM handovers WHERE id = ?', a))[0]
      ?.customer_id as string;
    expect(ids(await board('new', { deleted: true, customerId: customerA }))).toEqual([a]);
  });

  test('get: pembaca biasa NOT_FOUND; pemulih menerima DTO bertanda deleted', async () => {
    const id = await create();
    expect((await remove(id)).ok).toBe(true);
    const payload = { id, locationIds: [ENV.locA] };
    expect((await call(VIEWER, 'handovers.get', payload)).error?.code).toBe('NOT_FOUND');
    expect((await call(QC, 'handovers.get', payload)).error?.code).toBe('NOT_FOUND');
    expect((await call(WH_EDIT, 'handovers.get', payload)).error?.code).toBe('NOT_FOUND');
    const seen = await call(WH, 'handovers.get', payload);
    expect(seen.ok).toBe(true);
    expect(seen.data.deleted).toMatchObject({ deletedBy: WH });
  });
});

describe('tulis pada task terhapus', () => {
  test('save, setCheck, setDone, cancel, reopen, dan comment ke task terhapus = NOT_FOUND tanpa efek', async () => {
    const id = await create('- [ ] A');
    expect((await remove(id)).ok).toBe(true);
    const audits = await countOf('SELECT COUNT(*) AS n FROM audit_log');
    const results = await Promise.all([
      call(WH, 'handovers.save', {
        id,
        locationId: ENV.locA,
        customerName: 'PT Maju',
        note: '- [ ] A\n- [ ] Z',
      }),
      call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A', checked: true }),
      call(QC, 'handovers.setDone', ref(id)),
      call(WH, 'handovers.cancel', ref(id)),
      call(WH, 'handovers.reopen', ref(id)),
      call(VIEWER, 'handovers.comment', {
        ...ref(id),
        quote: '',
        before: '',
        after: '',
        body: 'Halo',
      }),
    ]);
    for (const out of results) expect(out.error?.code).toBe('NOT_FOUND');
    expect(await countOf('SELECT COUNT(*) AS n FROM audit_log')).toBe(audits);
    expect(
      await countOf('SELECT COUNT(*) AS n FROM handover_comments WHERE handover_id = ?', id),
    ).toBe(0);
  });

  test('kiriman ulang ber-clientId (saveBatch dan comment) ke task terhapus = NOT_FOUND, tanpa task atau komentar baru', async () => {
    const clientId = crypto.randomUUID();
    const batch = {
      locationId: ENV.locA,
      tasks: [{ customerName: 'PT Idem', note: '- [ ] A', clientId }],
    };
    const first = await call(WH, 'handovers.saveBatch', batch);
    expect(first.ok).toBe(true);
    const id = first.data[0].id as string;
    const commentId = crypto.randomUUID();
    const comment = {
      ...ref(id),
      quote: '',
      before: '',
      after: '',
      body: 'Halo',
      clientId: commentId,
    };
    expect((await call(VIEWER, 'handovers.comment', comment)).ok).toBe(true);
    expect((await remove(id)).ok).toBe(true);
    const tasks = await countOf('SELECT COUNT(*) AS n FROM handovers');
    const comments = await countOf('SELECT COUNT(*) AS n FROM handover_comments');
    expect((await call(WH, 'handovers.saveBatch', batch)).error?.code).toBe('NOT_FOUND');
    expect((await call(VIEWER, 'handovers.comment', comment)).error?.code).toBe('NOT_FOUND');
    expect(await countOf('SELECT COUNT(*) AS n FROM handovers')).toBe(tasks);
    expect(await countOf('SELECT COUNT(*) AS n FROM handover_comments')).toBe(comments);
    // Pelaku lain tetap mendapat CONFLICT generik, bukan NOT_FOUND (keadaan hapus tak terungkap).
    expect((await call(MULTI, 'handovers.saveBatch', batch)).error?.code).toBe('CONFLICT');
  });
});

/**
 * Menyisipkan `action` TEPAT sebelum `batch()` pertama yang memuat pernyataan berisi `marker` (mis. INSERT komentar):
 * membuat balapan "dihapus di sela baca dan tulis" deterministik, tanpa bergantung pada waktu `Promise.all`.
 */
function beforeBatchWith(marker: string, action: () => Promise<unknown>): void {
  const original = env.DB.batch.bind(env.DB);
  env.DB.batch = (async (statements: unknown[]) => {
    const hit = statements.some((s) => (s as { sql?: string }).sql?.includes(marker));
    if (!hit) return original(statements as never);
    env.DB.batch = original as typeof env.DB.batch;
    await action();
    return original(statements as never);
  }) as typeof env.DB.batch;
}

describe('konkurensi hapus vs tulis (deterministik, tanpa Promise.all)', () => {
  test('task dihapus tepat di sela baca dan tulis komentar: NOT_FOUND (bukan VALIDATION), tak ada komentar tersimpan', async () => {
    const id = await create('- [ ] A = 1');
    let removed: Result | undefined;
    beforeBatchWith('INSERT INTO handover_comments', async () => {
      removed = await remove(id);
    });
    const commented = await call(QC, 'handovers.comment', {
      ...ref(id),
      quote: '',
      before: '',
      after: '',
      body: 'Komentar sela',
    });
    expect(removed?.ok).toBe(true);
    expect(commented.ok).toBe(false);
    expect(commented.error?.code).toBe('NOT_FOUND');
    expect(
      await countOf('SELECT COUNT(*) AS n FROM handover_comments WHERE handover_id = ?', id),
    ).toBe(0);
    expect(await auditCount('handover.delete')).toBe(1);
  });
});

describe('konkurensi hapus vs tulis (Promise.all; asersi pada invarian, bukan urutan)', () => {
  test('komentar dan centang serentak dengan hapus: tak pernah VALIDATION; hapus selalu sukses; komentar tersimpan hanya bila sukses', async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = await create('- [ ] A = 1\n- [ ] B = 2', `PT Race ${round}`);
      const [removed, commented, checked] = await Promise.all([
        remove(id),
        call(QC, 'handovers.comment', {
          ...ref(id),
          quote: '',
          before: '',
          after: '',
          body: 'Komentar serentak',
        }),
        call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A = 1', checked: true }),
      ]);
      expect(removed.ok).toBe(true);
      expect((await stateOf(id)).deleted_at).not.toBe('');
      // Komentar yang kalah balapan menjawab NOT_FOUND (task sudah tak ada), bukan pesan batas komentar/dibatalkan.
      if (!commented.ok) expect(commented.error?.code).toBe('NOT_FOUND');
      if (!checked.ok) expect(['NOT_FOUND', 'CONFLICT']).toContain(checked.error?.code);
      expect(
        await countOf('SELECT COUNT(*) AS n FROM handover_comments WHERE handover_id = ?', id),
      ).toBe(commented.ok ? 1 : 0);
      // Sesudah hapus tak ada lagi tulisan yang lolos.
      const later = await call(QC, 'handovers.comment', {
        ...ref(id),
        quote: '',
        before: '',
        after: '',
        body: 'Terlambat',
      });
      expect(later.error?.code).toBe('NOT_FOUND');
    }
  });

  test('dua penghapusan serentak: keduanya sukses dan audit hanya sekali', async () => {
    const id = await create();
    const [a, b] = await Promise.all([remove(id), remove(id, MULTI)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await auditCount('handover.delete')).toBe(1);
  });
});

describe('handovers.restore (pulihkan)', () => {
  test('kembali ke kolom statusnya; tanda deleted hilang; audit sekali; pulihkan ulang sukses tanpa audit', async () => {
    const id = await create('- [ ] A');
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A', checked: true })).ok,
    ).toBe(true);
    expect(ids(await board('done'))).toEqual([id]);
    expect((await remove(id)).ok).toBe(true);
    expect(ids(await board('done'))).toEqual([]);
    env.clock.advance(1000);
    const out = await restore(id);
    expect(out.ok).toBe(true);
    expect(out.data.id).toBe(id);
    expect(out.data.deleted).toBeUndefined();
    expect(out.data.status).toBe('done');
    expect(ids(await board('done'))).toEqual([id]);
    expect(await stateOf(id)).toMatchObject({ deleted_at: '', deleted_by: '' });
    expect(await auditCount('handover.restore')).toBe(1);
    expect((await restore(id)).ok).toBe(true);
    expect(await auditCount('handover.restore')).toBe(1);
    expect((await call(VIEWER, 'handovers.get', { id, locationIds: [ENV.locA] })).ok).toBe(true);
  });

  test('komentar dan centang ikut pulih utuh, dan task dapat ditulis lagi', async () => {
    const id = await create('- [ ] A');
    expect(
      (
        await call(VIEWER, 'handovers.comment', {
          ...ref(id),
          quote: '',
          before: '',
          after: '',
          body: 'Halo',
        })
      ).ok,
    ).toBe(true);
    expect((await remove(id)).ok).toBe(true);
    const restored = await restore(id);
    expect(restored.data.comments).toHaveLength(1);
    expect(
      (await call(QC, 'handovers.setCheck', { ...ref(id), index: 0, text: 'A', checked: true })).ok,
    ).toBe(true);
  });

  test('seeder: task yang dihapus bukan oleh aplikasi tetap dapat dipulihkan lewat rute', async () => {
    const record = await seedHandover(env, {
      id: 't-seed',
      number: 'ST-20261015-050',
      locationId: ENV.locA,
      note: '- [ ] A',
    });
    await env.DB.prepare("UPDATE handovers SET deleted_at = ?, deleted_by = 'x' WHERE id = ?")
      .bind(NOW, record.id)
      .run();
    expect(ids(await board('new'))).not.toContain('t-seed');
    expect((await restore('t-seed')).ok).toBe(true);
    expect(ids(await board('new'))).toContain('t-seed');
  });
});

describe('notifikasi task terhapus', () => {
  test('lonceng menyembunyikan notifikasi task terhapus; pulihkan memunculkannya lagi', async () => {
    const id = await create('- [ ] A');
    const list = async (): Promise<string[]> =>
      ((await call(QC, 'notifications.list', {})).data.items as Array<{ handoverId: string }>).map(
        (item) => item.handoverId,
      );
    expect(await list()).toContain(id);
    expect((await remove(id)).ok).toBe(true);
    expect(await list()).not.toContain(id);
    expect((await restore(id)).ok).toBe(true);
    expect(await list()).toContain(id);
  });
});
