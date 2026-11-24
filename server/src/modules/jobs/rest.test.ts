import { afterEach, beforeEach, expect, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-admin', name: 'Admin', permissions: { access: 'manage' } });
  await seedRole(env, { id: 'r-view', name: 'Lihat akses', permissions: { access: 'view' } });
  await seedRole(env, { id: 'r-qv', name: 'QR view', permissions: { qrcode: 'view' } });
  await seedUser(env, { id: 'u-admin', email: 'admin2@gmail.com', roleIds: ['r-admin'] });
  await seedUser(env, { id: 'u-view', email: 'akses@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-qv', email: 'qrview@gmail.com', roleIds: ['r-qv'] });
  await seedUser(env, { id: 'u-none', email: 'polos@gmail.com' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

test('POST /exports/sheets -> 202 + Location /api/v1/jobs/{jobId}; hanya access:manage', async () => {
  const denied = await rest.post('/exports/sheets', { email: 'akses@gmail.com', body: {} });
  expect(denied.status).toBe(403);
  const unauthenticated = await rest.post('/exports/sheets', { email: null, body: {} });
  expect(unauthenticated.status).toBe(401);
  const accepted = await rest.post('/exports/sheets', { email: 'admin2@gmail.com', body: {} });
  expect(accepted.status).toBe(202);
  const { jobId } = (await jsonOf(accepted)) as { jobId: string };
  expect(accepted.headers.get('location')).toBe(`/api/v1/jobs/${jobId}`);
  // badan kosong sama dengan semua tabel; tabel terlarang ditolak 422
  const forbidden = await rest.post('/exports/sheets', {
    email: 'admin2@gmail.com',
    body: { tables: ['rate_limits'] },
  });
  expect(forbidden.status).toBe(422);
  expect((await rest.post('/exports/sheets', { email: 'admin2@gmail.com' })).status).toBe(202);
});

test('GET /jobs/{id}: pembuat boleh, pemegang qrcode view hanya job QR, orang lain 404 (disamarkan), id tak dikenal 404', async () => {
  const accepted = await rest.post('/exports/sheets', { email: 'admin2@gmail.com', body: {} });
  const { jobId } = (await jsonOf(accepted)) as { jobId: string };
  const own = await rest.get(`/jobs/${jobId}`, { email: 'admin2@gmail.com' });
  expect(own.status).toBe(200);
  expect(await jsonOf(own)).toMatchObject({ id: jobId, kind: 'sheets_export', status: 'queued' });
  // pemegang qrcode view hanya boleh membaca job `qr_export` (bukan ekspor Sheets)
  expect((await rest.get(`/jobs/${jobId}`, { email: 'qrview@gmail.com' })).status).toBe(404);
  const other = await rest.get(`/jobs/${jobId}`, { email: 'polos@gmail.com' });
  expect(other.status).toBe(404);
  expect(await jsonOf(other)).toMatchObject({ code: 'NOT_FOUND' });
  expect((await rest.get('/jobs/tidak-ada', { email: 'admin2@gmail.com' })).status).toBe(404);
  expect((await rest.get(`/jobs/${jobId}`, { email: null })).status).toBe(401);
  await runPendingJobs(env);
  const done = await rest.get(`/jobs/${jobId}`, { email: 'admin2@gmail.com' });
  expect(await jsonOf(done)).toMatchObject({ status: 'done', progress: 100 });
});
