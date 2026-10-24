import { type AppBindings, csrfGuard, securityHeaders } from '@worker/http/security';
import { authApp } from '@worker/modules/auth/routes';
import { Hono } from 'hono';

const app = new Hono<AppBindings>();

app.use('*', securityHeaders);
app.use('/api/*', csrfGuard);
app.use('/auth/*', csrfGuard);

app.get('/api/ping', (c) => c.json({ ok: true }));
app.route('/auth', authApp);

export default { fetch: app.fetch };
export { app };
