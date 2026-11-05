import { callRoute, handleRpc, readCookie, rpcResponse } from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import { type AppBindings, csrfGuard, securityHeaders } from '@server/http/security';
import { authApp } from '@server/modules/auth/routes';
import { handleQueue } from '@server/modules/jobs/consumer';
import { handleSyncRequest } from '@server/modules/sync/handler';
import { syncRoutes } from '@server/modules/sync/routes';
import { getRoutes } from '@server/routes';
import { scheduled } from '@server/scheduled';
import { Hono } from 'hono/tiny';

const app = new Hono<AppBindings>();

app.use('*', securityHeaders);
app.use('/api/*', csrfGuard);
app.use('/auth/*', csrfGuard);

app.get('/api/ping', (c) => c.json({ ok: true }));
app.post('/api/rpc', (c) => handleRpc(c.env, c.req.raw, getRoutes()));
// Data awal klien: alias `auth.me` (sesi dari cookie); tanpa sesi -> 401 UNAUTHENTICATED.
app.get('/api/boot', async (c) =>
  rpcResponse(
    await callRoute(c.env, readCookie(c.req.raw, SESSION_COOKIE), 'auth.me', null, getRoutes()),
  ),
);
app.route('/auth', authApp);
// QC Desktop: token di badan, tanpa cookie (bukan permukaan CSRF); amplop sama dengan era Apps Script.
app.post('/sync', (c) => handleSyncRequest(c.env, c.req.raw, syncRoutes()));

export default { fetch: app.fetch, queue: handleQueue, scheduled };
export { app };
