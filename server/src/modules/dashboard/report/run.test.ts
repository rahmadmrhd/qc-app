import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Db, DbStatement } from '@server/core/db';
import type { MailMessage } from '@server/core/mail';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedSerial } from '@server-test/dashboard-seed';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveDashboardReportInput } from '@shared/dashboard-report';
import { listSharesOfReport } from '../share-repo';
import { loadReport } from './repo';
import { checkDashboardReports, runReport } from './run';
import { removeDashboardReport, saveDashboardReport, setDashboardReportEnabled } from './service';

setDefaultTimeout(60_000);

const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // Senin 23 Nov 2026 12:00 WIB
const OWNER = 'owner@gmail.com';
const RECIPIENT = 'penerima@contoh.id';

let env: TestEnv;
let sent: MailMessage[];
let failWith: Error | null;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  sent = [];
  failWith = null;
  env.MAILER = {
    send: async (message) => {
      if (failWith !== null) throw failWith;
      sent.push(message);
    },
  };
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-dash-edit', name: 'DashEdit', permissions: { dashboard: 'edit' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-owner',
    email: OWNER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  // Tiga serial dicatat di minggu lalu (16-22 Nov 2026).
  for (const id of ['s1', 's2', 's3']) {
    await seedSerial(env, { id, buId: 'bu-x', createdAt: '2026-11-18T05:00:00.000Z' });
  }
});

const BODY: SaveDashboardReportInput = {
  name: 'Ringkasan mingguan',
  schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
  period: 'lastWeek',
  filter: { from: '', to: '' },
  widgets: [{ id: 'sn.recorded', filters: {} }],
  offers: [],
  recipients: [RECIPIENT],
  linkDays: 14,
};

/** Laporan jatuh tempo: dibuat lalu `last_run_key` dikosongkan (laporan baru sengaja tak langsung terkirim). */
async function dueReport(overrides: Partial<SaveDashboardReportInput> = {}): Promise<string> {
  const owner = await loadUserContext(env, OWNER);
  if (!owner) throw new Error('pemilik tidak ditemukan');
  const dto = await saveDashboardReport(env, owner, { ...BODY, ...overrides });
  await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
    .bind(dto.id)
    .run();
  return dto.id;
}

const reportOf = async (id: string) => {
  const row = await loadReport(env.DB, id);
  if (!row) throw new Error('laporan hilang');
  return row;
};

describe('checkDashboardReports', () => {
  test('mengirim SATU surel bcc dengan tombol ke tautan terbitan; periode berikutnya tak dikirim ulang', async () => {
    const id = await dueReport();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(sent).toHaveLength(1);
    const mail = sent[0] as MailMessage;
    expect(mail.to).toEqual([]);
    expect(mail.bcc).toEqual([RECIPIENT]);
    expect(mail.subject).toBe('[QC] Ringkasan mingguan, Minggu lalu (16 Nov 2026 - 22 Nov 2026)');
    expect(mail.html).toContain('https://qc.test/dashboard-publik/v1.');
    expect(mail.text).toContain('https://qc.test/dashboard-publik/v1.');
    // Alamat penerima tak ikut ke badan surel.
    expect(mail.html).not.toContain(RECIPIENT);
    expect(mail.text).not.toContain(RECIPIENT);

    const row = await reportOf(id);
    expect(row.last_run_key).toBe('2026-W48');
    expect(row.last_status).toBe('ok');
    const links = await listSharesOfReport(env.DB, id, 10);
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link?.created_by).toBe(OWNER);
    expect(link?.expires_at).toBe(new Date(NOW + 14 * 86_400_000).toISOString());
    expect(JSON.parse(link?.scope ?? '{}').range).toEqual({
      mode: 'fixed',
      from: '2026-11-16',
      to: '2026-11-22',
    });

    env.clock.advance(5 * 60_000);
    expect(await checkDashboardReports(env, NOW + 5 * 60_000)).toEqual({
      sent: 0,
      skipped: 0,
      errors: 0,
    });
    expect(sent).toHaveLength(1);
  });

  test('dua pemeriksaan serentak = satu surel', async () => {
    const id = await dueReport();
    await Promise.all([checkDashboardReports(env, NOW), checkDashboardReports(env, NOW)]);
    expect(sent).toHaveLength(1);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(1);
  });

  test('sebelum jam jadwal, dan hari lain, tidak dikirim', async () => {
    await dueReport();
    const early = Date.parse('2026-11-23T00:30:00.000Z'); // 07:30 WIB
    expect((await checkDashboardReports(env, early)).sent).toBe(0);
    const tuesday = Date.parse('2026-11-24T05:00:00.000Z');
    expect((await checkDashboardReports(env, tuesday)).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('pengiriman gagal: klaim dipulihkan, tautan dihapus, catatan tanpa alamat; pemeriksaan berikutnya mencoba lagi', async () => {
    const id = await dueReport();
    failWith = new Error(`SMTP menolak ${RECIPIENT}`);
    const summary = await checkDashboardReports(env, NOW);
    expect(summary).toEqual({ sent: 0, skipped: 0, errors: 1 });
    const row = await reportOf(id);
    expect(row.last_run_key).toBe('');
    expect(row.last_status).toBe('error');
    expect(row.last_note).not.toContain(RECIPIENT);
    expect(row.last_note).toContain('Gagal');
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);

    failWith = null;
    const retry = await checkDashboardReports(env, NOW + 5 * 60_000);
    expect(retry.sent).toBe(1);
    expect((await reportOf(id)).last_run_key).toBe('2026-W48');
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(1);
  });

  test('dijeda tidak dikirim', async () => {
    const id = await dueReport();
    await env.DB.prepare('UPDATE dashboard_reports SET enabled = 0 WHERE id = ?').bind(id).run();
    expect((await checkDashboardReports(env, NOW)).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('tanpa MAILER tidak berbuat apa pun', async () => {
    const id = await dueReport();
    env.MAILER = undefined;
    expect(await checkDashboardReports(env, NOW)).toEqual({ sent: 0, skipped: 0, errors: 0 });
    const row = await reportOf(id);
    expect(row.last_run_key).toBe('');
    expect(row.last_status).toBe('');
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
  });

  test('pemilik nonaktif dilewati tanpa mengisi last_run_key, lalu terkirim begitu aktif lagi', async () => {
    const id = await dueReport();
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(OWNER).run();
    const first = await checkDashboardReports(env, NOW);
    expect(first).toEqual({ sent: 0, skipped: 1, errors: 0 });
    let row = await reportOf(id);
    expect(row.last_run_key).toBe('');
    expect(row.last_status).toBe('skipped');
    expect(row.last_note).toBe('Pemilik tidak aktif');
    expect(sent).toHaveLength(0);

    await env.DB.prepare("UPDATE users SET status = 'active' WHERE email = ?").bind(OWNER).run();
    expect((await checkDashboardReports(env, NOW + 5 * 60_000)).sent).toBe(1);
    row = await reportOf(id);
    expect(row.last_status).toBe('ok');
  });

  test('pemilik turun ke dashboard: edit tetap terkirim (syarat kirim = minimal edit)', async () => {
    const id = await dueReport();
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: null, roleIds: ['r-dash-edit'] }]), OWNER)
      .run();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(1);
    expect((await reportOf(id)).last_status).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  test('pemilik kehilangan izin dashboard sama sekali dilewati', async () => {
    const id = await dueReport();
    await env.DB.prepare("UPDATE users SET assignments = '[]' WHERE email = ?").bind(OWNER).run();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.skipped).toBe(1);
    const row = await reportOf(id);
    expect(row.last_note).toBe('Pemilik tidak lagi berhak membagikan');
    expect(row.last_run_key).toBe('');
    expect(sent).toHaveLength(0);
  });

  test('pemilik kehilangan izin widget: tak ada widget tersisa dilewati', async () => {
    const id = await dueReport();
    await env.DB.prepare("UPDATE users SET bu_assignments = '[]' WHERE email = ?")
      .bind(OWNER)
      .run();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.skipped).toBe(1);
    expect((await reportOf(id)).last_note).toBe('Tidak ada widget yang dapat ditampilkan');
    expect(sent).toHaveLength(0);
  });

  test('kehilangan sebagian widget: yang tersisa tetap terkirim, yang hilang tak tampil', async () => {
    await seedLocation(env, { id: 'loc-a', code: 'A' });
    await seedRole(env, { id: 'r-ho', name: 'HO', permissions: { handover: 'view' } });
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { locationId: null, roleIds: ['r-dash'] },
          { locationId: 'loc-a', roleIds: ['r-ho'] },
        ]),
        OWNER,
      )
      .run();
    const id = await dueReport({
      widgets: [
        { id: 'sn.recorded', filters: {} },
        { id: 'hs.created', filters: {} },
      ],
    });
    // Hak Serah Terima dicabut sesudah laporan disimpan: widget itu hilang, Serial tetap.
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: null, roleIds: ['r-dash'] }]), OWNER)
      .run();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(1);
    expect(sent[0]?.html).toContain('Serial dicatat');
    expect(sent[0]?.html).not.toContain('Task dibuat');
    const link = (await listSharesOfReport(env.DB, id, 10))[0];
    expect(JSON.parse(link?.scope ?? '{}').widgets.map((w: { id: string }) => w.id)).toEqual([
      'sn.recorded',
    ]);
  });

  test('laporan lain tak terpengaruh oleh laporan yang dilewati', async () => {
    const skippedId = await dueReport({ name: 'Laporan A' });
    await env.DB.prepare(
      'UPDATE dashboard_reports SET recipients = \'["bukan-surel"]\' WHERE id = ?',
    )
      .bind(skippedId)
      .run();
    const okId = await dueReport({ name: 'Laporan B' });
    const summary = await checkDashboardReports(env, NOW);
    expect(summary).toEqual({ sent: 1, skipped: 1, errors: 0 });
    expect((await reportOf(skippedId)).last_note).toBe('Tidak ada penerima yang sah');
    expect((await reportOf(okId)).last_status).toBe('ok');
    expect(sent[0]?.subject).toContain('Laporan B');
  });

  test('konfigurasi rusak tercatat error tanpa mengirim', async () => {
    const id = await dueReport();
    await env.DB.prepare("UPDATE dashboard_reports SET schedule = 'rusak' WHERE id = ?")
      .bind(id)
      .run();
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.errors).toBe(1);
    expect((await reportOf(id)).last_note).toBe('Konfigurasi laporan tidak terbaca');
    expect(sent).toHaveLength(0);
  });
});

describe('runReport mode uji dan pratinjau', () => {
  test('test: hanya ke pemilik, awalan [UJI], tanpa klaim dan tanpa mengubah status terakhir', async () => {
    const id = await dueReport();
    const outcome = await runReport(env, await reportOf(id), NOW, 'test');
    expect(outcome.status).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.bcc).toEqual([OWNER]);
    expect(sent[0]?.subject.startsWith('[UJI] [QC] ')).toBe(true);
    const row = await reportOf(id);
    expect(row.last_run_key).toBe('');
    expect(row.last_status).toBe('');
  });

  test('preview: merender dengan tautan contoh, tanpa tautan terbitan dan tanpa kirim', async () => {
    const id = await dueReport();
    const outcome = await runReport(env, await reportOf(id), NOW, 'preview');
    expect(outcome.status).toBe('ok');
    expect(outcome.rendered?.html).toContain('https://qc.test/dashboard-publik/contoh');
    expect(sent).toHaveLength(0);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
  });

  test('preview tak butuh MAILER', async () => {
    const id = await dueReport();
    env.MAILER = undefined;
    const outcome = await runReport(env, await reportOf(id), NOW, 'preview');
    expect(outcome.status).toBe('ok');
  });
});

/**
 * Menyisipkan `action` di antara dua langkah pengirim (sekali saja): `claim` = tepat sebelum `UPDATE ... last_run_key`
 * (klaim), `link-before` dan `link-after` = sebelum/sesudah `batch()` yang menyisipkan tautan terbitan.
 */
function interleave(point: 'claim' | 'link-before' | 'link-after', action: () => Promise<void>) {
  const db = env.DB as Db;
  const realPrepare = db.prepare.bind(db);
  const realBatch = db.batch.bind(db);
  let fired = false;
  const fire = async () => {
    if (fired) return;
    fired = true;
    await action();
  };
  const wrap = (statement: DbStatement): DbStatement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: () => statement.first(),
    all: () => statement.all(),
    run: async () => {
      await fire();
      return statement.run();
    },
  });
  if (point === 'claim') {
    db.prepare = (sql: string) => {
      const statement = realPrepare(sql);
      return sql.startsWith(
        'UPDATE dashboard_reports SET last_run_key = ? WHERE id = ? AND enabled',
      )
        ? wrap(statement)
        : statement;
    };
    return;
  }
  const isLink = (statements: DbStatement[]) =>
    statements.some((statement) =>
      /INSERT INTO dashboard_shares/.test((statement as unknown as { sql: string }).sql),
    );
  db.batch = (async (statements: DbStatement[]) => {
    const linking = isLink(statements);
    if (linking && point === 'link-before') await fire();
    const result = await realBatch(statements);
    if (linking && point === 'link-after') await fire();
    return result;
  }) as Db['batch'];
}

const activeLinks = async (id: string) =>
  (await listSharesOfReport(env.DB, id, 10)).filter((share) => share.revoked_at === '');

describe('keadaan laporan TERKINI saat klaim dan kirim (I2, M2)', () => {
  const asOwner = async () => {
    const owner = await loadUserContext(env, OWNER);
    if (!owner) throw new Error('pemilik tidak ditemukan');
    return owner;
  };
  const changeRecipients = async (id: string) => {
    const row = await reportOf(id);
    await saveDashboardReport(env, await asOwner(), {
      ...BODY,
      id,
      expectedUpdatedAt: row.updated_at,
      recipients: ['baru@contoh.id'],
    });
  };

  test('penerima diubah SEBELUM klaim: tak ada surel ke daftar lama; putaran berikutnya memakai daftar baru', async () => {
    const id = await dueReport();
    interleave('claim', () => changeRecipients(id));
    const first = await checkDashboardReports(env, NOW);
    expect(first.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);

    const second = await checkDashboardReports(env, NOW + 5 * 60_000);
    expect(second.sent).toBe(1);
    expect(sent[0]?.bcc).toEqual(['baru@contoh.id']);
  });

  test('penerima diubah SETELAH klaim, sebelum tautan terbit: tidak terkirim, tak ada tautan, klaim tidak dilepas', async () => {
    const id = await dueReport();
    interleave('link-before', () => changeRecipients(id));
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
    // Periode itu dilewati (klaim tetap) agar tak mengirim ke daftar yang tak lagi dikehendaki pemilik.
    expect((await reportOf(id)).last_run_key).toBe('2026-W48');
  });

  test('penerima diubah SETELAH tautan terbit, sebelum kirim: tidak terkirim dan tautan dihapus', async () => {
    const id = await dueReport();
    interleave('link-after', () => changeRecipients(id));
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
  });

  test('laporan dihapus sesudah klaim: tak ada surel dan tak ada tautan yatim', async () => {
    const id = await dueReport();
    interleave('link-before', async () => {
      await removeDashboardReport(env, await asOwner(), id);
    });
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await loadReport(env.DB, id)).toBeNull();
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
  });

  test('laporan dihapus setelah tautan terbit, sebelum kirim: tak ada surel, tautan tak tersisa', async () => {
    const id = await dueReport();
    interleave('link-after', async () => {
      await removeDashboardReport(env, await asOwner(), id);
    });
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await activeLinks(id)).toHaveLength(0);
  });

  test('dijeda sesudah klaim: tidak terkirim dan tak ada tautan', async () => {
    const id = await dueReport();
    interleave('link-before', async () => {
      await setDashboardReportEnabled(env, await asOwner(), { id, enabled: false });
    });
    const summary = await checkDashboardReports(env, NOW);
    expect(summary.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await listSharesOfReport(env.DB, id, 10)).toHaveLength(0);
    expect((await reportOf(id)).enabled).toBe(0);
  });

  test('M2: jadwal diubah selama pengiriman gagal tidak menimpa kunci reset pemilik', async () => {
    const id = await dueReport();
    const row = await reportOf(id);
    failWith = new Error('SMTP menolak');
    interleave('link-before', async () => {
      // Jam 09.00 sudah lewat pukul 12.00 WIB: kunci reset = kunci periode berjalan (sama dengan klaim).
      await saveDashboardReport(env, await asOwner(), {
        ...BODY,
        id,
        expectedUpdatedAt: row.updated_at,
        schedule: { frequency: 'weekly', hour: 9, weekday: 1, monthDay: 1 },
      });
    });
    await checkDashboardReports(env, NOW);
    expect(sent).toHaveLength(0);
    expect((await reportOf(id)).last_run_key).toBe('2026-W48');
    // Pemeriksaan berikutnya tak langsung mengirim (dijadwal ulang mulai dari jadwal berikutnya).
    failWith = null;
    expect((await checkDashboardReports(env, NOW + 5 * 60_000)).sent).toBe(0);
  });

  test('serentak dengan penghapusan: laporan hilang tidak meninggalkan tautan aktif', async () => {
    const id = await dueReport();
    await Promise.all([
      checkDashboardReports(env, NOW),
      asOwner().then((owner) => removeDashboardReport(env, owner, id)),
    ]);
    expect(await loadReport(env.DB, id)).toBeNull();
    expect(await activeLinks(id)).toHaveLength(0);
  });
});

describe('nama lokasi di kepala surel mengikuti hak pemilik saat kirim (M4)', () => {
  test('lokasi yang haknya sudah dicabut tidak tampil di kepala surel', async () => {
    await seedRole(env, { id: 'r-ho', name: 'HO', permissions: { handover: 'view' } });
    await seedLocation(env, { id: 'loc-a', code: 'LA', name: 'Gudang Alfa' });
    await seedLocation(env, { id: 'loc-b', code: 'LB', name: 'Gudang Beta' });
    const assign = async (locationIds: string[]) => {
      await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
        .bind(
          JSON.stringify([
            { locationId: null, roleIds: ['r-dash'] },
            ...locationIds.map((locationId) => ({ locationId, roleIds: ['r-ho'] })),
          ]),
          OWNER,
        )
        .run();
    };
    await assign(['loc-a', 'loc-b']);
    const id = await dueReport({
      widgets: [{ id: 'hs.created', filters: {} }],
      filter: { from: '', to: '', locationIds: ['loc-a', 'loc-b'] },
    });
    // Hak Gudang Beta dicabut sesudah laporan disimpan (cakupan beku masih memuat keduanya).
    await assign(['loc-a']);
    await checkDashboardReports(env, NOW);
    expect(sent).toHaveLength(1);
    const mail = sent[0] as MailMessage;
    expect(mail.text).toContain('Gudang Alfa');
    expect(mail.text).not.toContain('Gudang Beta');
    expect(mail.html).not.toContain('Gudang Beta');
    expect((await reportOf(id)).last_status).toBe('ok');
  });
});
