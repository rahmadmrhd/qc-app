import { callRoute, handleRpc, readCookie, rpcResponse } from '@worker/core/router';
import { SESSION_COOKIE } from '@worker/core/session';
import { type AppBindings, csrfGuard, securityHeaders } from '@worker/http/security';
import { authApp } from '@worker/modules/auth/routes';
import { getRoutes } from '@worker/routes';
import { Hono } from 'hono';

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

export default { fetch: app.fetch };
export { app };
