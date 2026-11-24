import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadConfig } from '@server/config';
import type { MailMessage } from '@server/core/mail';
import { startDashboardReportLoop } from '@server/jobs/runner';
import { loadUserContext } from '@server/modules/access/context';
import { createServer } from '@server/server';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedSerial } from '@server-test/dashboard-seed';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { loadReport } from './repo';
import { saveDashboardReport } from './service';

setDefaultTimeout(60_000);

const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // Senin 23 Nov 2026 12:00 WIB
const OWNER = 'owner@gmail.com';

let env: TestEnv;
let reportId: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await sleep(15);
  }
  throw new Error('waitFor: batas waktu habis');
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-owner',
    email: OWNER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  await seedSerial(env, { id: 's1', buId: 'bu-x', createdAt: '2026-11-18T05:00:00.000Z' });
  const owner = await loadUserContext(env, OWNER);
  if (!owner) throw new Error('pemilik tidak ditemukan');
  const dto = await saveDashboardReport(env, owner, {
    name: 'Ringkasan mingguan',
    schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
    period: 'lastWeek',
    filter: { from: '', to: '' },
    widgets: [{ id: 'sn.recorded', filters: {} }],
    offers: [],
    recipients: ['penerima@contoh.id'],
    linkDays: 14,
  });
  reportId = dto.id;
  await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
    .bind(reportId)
    .run();
});

describe('startDashboardReportLoop', () => {
  test('berdetak berkala tetapi mengirim satu surel untuk satu periode', async () => {
    const sent: MailMessage[] = [];
    env.MAILER = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const stop = startDashboardReportLoop(env, { intervalMs: 10 });
    try {
      await waitFor(() => sent.length === 1);
      await sleep(150); // banyak detak berlalu
      expect(sent).toHaveLength(1);
    } finally {
      await stop();
    }
  });

  test('putaran tak pernah tumpang tindih: detak berikutnya menunggu putaran yang berjalan, dan stop menunggunya', async () => {
    let running = 0;
    let peak = 0;
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.MAILER = {
      send: async () => {
        calls += 1;
        running += 1;
        peak = Math.max(peak, running);
        await gate;
        running -= 1;
      },
    };
    const stop = startDashboardReportLoop(env, { intervalMs: 5 });
    await waitFor(() => calls === 1);
    await sleep(120); // putaran tertahan: detak lain tidak boleh memulai pengiriman kedua
    expect(running).toBe(1);
    const stopping = stop();
    release();
    await stopping;
    expect(peak).toBe(1);
    expect(calls).toBe(1);
    expect(running).toBe(0);
    // Sesudah berhenti tak ada putaran baru.
    await sleep(60);
    expect(calls).toBe(1);
  });
});

describe('kabel createServer', () => {
  const config = loadConfig({
    DATABASE_URL: 'mysql://tidak-dipakai:x@127.0.0.1:1/tidak_ada',
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    ADMIN_EMAIL: 'admin@gmail.com',
  });

  test('dengan MAILER loop terpasang dan mengirim; tanpa MAILER tidak berbuat apa pun', async () => {
    const sent: MailMessage[] = [];
    const withMailer = createServer(config, {
      db: env.DB,
      background: true,
      env: {
        NOW: env.NOW,
        APP_ORIGIN: 'https://qc.test',
        MAILER: {
          send: async (message) => {
            sent.push(message);
          },
        },
      },
    });
    try {
      await waitFor(() => sent.length === 1);
    } finally {
      await withMailer.stop();
    }

    await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
      .bind(reportId)
      .run();
    const without = createServer(config, {
      db: env.DB,
      background: true,
      env: { NOW: env.NOW, APP_ORIGIN: 'https://qc.test' },
    });
    try {
      await without.ready;
      await sleep(400);
    } finally {
      await without.stop();
    }
    const row = await loadReport(env.DB, reportId);
    expect(row?.last_run_key).toBe('');
    expect(sent).toHaveLength(1);
  });
});
