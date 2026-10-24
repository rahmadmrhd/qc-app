import { nowOf } from '@worker/core/env';
import { SESSION_TTL_MS, signSessionToken } from '@worker/core/session';
import {
  type AppBindings,
  errorEnvelope,
  OAUTH_COOKIE,
  SESSION_COOKIE,
} from '@worker/http/security';
import { loadUserContext } from '@worker/modules/access/context';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createLogin, exchangeCodeForEmail, OAUTH_STATE_TTL_MS, verifyLoginState } from './oauth';

/** Rute `/auth/*` (dipasang di `app.route('/auth', authApp)`). */
export const authApp = new Hono<AppBindings>();

authApp.get('/login', async (c) => {
  const { url, stateCookie } = await createLogin(c.env, c.req.raw);
  setCookie(c, OAUTH_COOKIE, stateCookie, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/auth',
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
  return c.redirect(url, 302);
});

authApp.get('/callback', async (c) => {
  const stateOk = await verifyLoginState(c.env, getCookie(c, OAUTH_COOKIE), c.req.query('state'));
  // Cookie state sekali pakai: selalu dihapus, berhasil maupun gagal.
  deleteCookie(c, OAUTH_COOKIE, { path: '/auth', secure: true });
  if (!stateOk) {
    return c.json(
      errorEnvelope('UNAUTHENTICATED', 'Login tidak valid atau sudah kedaluwarsa'),
      400,
    );
  }
  const code = c.req.query('code');
  if (c.req.query('error') || !code) return c.redirect('/?authError=LOGIN_FAILED', 302);

  const result = await exchangeCodeForEmail(c.env, c.req.raw, code);
  if (!result.ok) {
    console.error(`Login gagal: ${result.reason}`);
    return c.redirect('/?authError=LOGIN_FAILED', 302);
  }
  if (!(await loadUserContext(c.env, result.email))) {
    return c.redirect('/?authError=NOT_WHITELISTED', 302);
  }
  setCookie(c, SESSION_COOKIE, await signSessionToken(c.env, result.email, nowOf(c.env)), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect('/', 302);
});

authApp.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});
