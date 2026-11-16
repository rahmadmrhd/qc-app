import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { signDesktopToken, signSessionToken, verifyDesktopToken } from '@server/core/session';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { HANDOFF_TICKET_TTL_MS, issueHandoffTicket } from './handoff';

setDefaultTimeout(60_000);

let env: TestEnv;

const CL = 'cl@gmail.com';
const PLAIN = 'plain@gmail.com';
const URL_HANDOFF = 'https://qc.test/auth/desktop/handoff';

beforeEach(async () => {
  env = await createTestEnv();
  await seedRole(env, {
    id: 'role-cl',
    name: 'Country Lock',
    permissions: { countrylock: 'view' },
  });
  await seedRole(env, { id: 'role-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-cl', email: CL, roleIds: ['role-cl'] });
  await seedUser(env, { id: 'u-plain', email: PLAIN, roleIds: ['role-item'] });
});

async function mint(email: string) {
  return restCall(env, email, 'desktop.handoff', {});
}

function exchange(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      URL_HANDOFF,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'qc', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      },
      env,
    ),
  );
}

describe('desktop.handoff (pencetak tiket)', () => {
  test('pengguna berizin countrylock mendapat tiket dan emailnya', async () => {
    const result = await mint(CL);
    expect(result.ok).toBe(true);
    const data = (result as { data: { ticket: string; email: string } }).data;
    expect(data.email).toBe(CL);
    expect(data.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(data.ticket.length).toBeLessThan(1024);
  });

  test('tanpa izin countrylock -> FORBIDDEN; tanpa sesi -> 401', async () => {
    const denied = await mint(PLAIN);
    expect(denied.ok).toBe(false);
    expect((denied as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const anon = await app.request(
      'https://qc.test/api/v1/desktop/handoff',
      { method: 'POST', headers: { 'x-requested-with': 'qc' } },
      env,
    );
    expect(anon.status).toBe(401);
  });

  test('super admin tetap boleh (admin@ dari ADMIN_EMAIL)', async () => {
    expect((await mint('admin@gmail.com')).ok).toBe(true);
  });
});

describe('POST /auth/desktop/handoff (penukaran tiket)', () => {
  test('tiket sah ditukar jadi token Bearer desktop untuk akun yang sama', async () => {
    const { ticket } = ((await mint(CL)) as { data: { ticket: string } }).data;
    const response = await exchange({ ticket });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { token: string; email: string; expiresAt: number };
    expect(body.email).toBe(CL);
    expect(body.expiresAt).toBeGreaterThan(env.clock.now());
    expect((await verifyDesktopToken(env, body.token, env.clock.now()))?.email).toBe(CL);
  });

  test('tiket sekali pakai: penukaran kedua ditolak seragam', async () => {
    const { ticket } = ((await mint(CL)) as { data: { ticket: string } }).data;
    expect((await exchange({ ticket })).status).toBe(200);
    const second = await exchange({ ticket });
    expect(second.status).toBe(401);
    const body = (await second.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Tiket tidak valid atau kedaluwarsa');
  });

  test('tiket kedaluwarsa setelah 60 detik', async () => {
    const { ticket } = ((await mint(CL)) as { data: { ticket: string } }).data;
    env.clock.advance(HANDOFF_TICKET_TTL_MS + 1);
    expect((await exchange({ ticket })).status).toBe(401);
  });

  test('izin dicabut atau akun dinonaktifkan setelah tiket terbit: ditolak dan tiket tidak habis', async () => {
    const { ticket } = ((await mint(CL)) as { data: { ticket: string } }).data;
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?').bind('[]', CL).run();
    expect((await exchange({ ticket })).status).toBe(401);
    // Izin dipulihkan dalam masa berlaku: tiket yang tadi ditolak belum dihabiskan.
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: null, roleIds: ['role-cl'] }]), CL)
      .run();
    expect((await exchange({ ticket })).status).toBe(200);
    const second = (await mint(CL)) as { data: { ticket: string } };
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(CL).run();
    expect((await exchange({ ticket: second.data.ticket })).status).toBe(401);
  });

  test('bukan tiket serah-terima: token sesi web, token desktop, dan kode login ditolak', async () => {
    const session = await signSessionToken(env, CL, env.clock.now());
    const desktop = await signDesktopToken(env, CL, env.clock.now());
    for (const ticket of [session, desktop, 'x.y', 'bukan-tiket']) {
      expect((await exchange({ ticket })).status, ticket.slice(0, 12)).toBe(401);
    }
  });

  test('tiket yang dipalsukan (isi diubah) ditolak', async () => {
    const ticket = await issueHandoffTicket(env, CL);
    const [body, sig] = ticket.split('.');
    const forged = `${Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body ?? '', 'base64url').toString()),
        email: 'admin@gmail.com',
      }),
    ).toString('base64url')}.${sig}`;
    expect((await exchange({ ticket: forged })).status).toBe(401);
  });

  test('badan salah bentuk -> 400; tanpa header CSRF -> 403', async () => {
    for (const body of ['', 'bukan json', '[]', '{}', '{"ticket":""}', '{"ticket":5}']) {
      expect((await exchange(body)).status, body).toBe(400);
    }
    expect((await exchange({ ticket: 'a'.repeat(2000) })).status).toBe(400);
    const noCsrf = await app.request(
      URL_HANDOFF,
      { method: 'POST', body: JSON.stringify({ ticket: 'x' }) },
      env,
    );
    expect(noCsrf.status).toBe(403);
  });
});
